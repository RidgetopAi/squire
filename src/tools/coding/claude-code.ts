/**
 * Claude Code Tool
 *
 * Execute coding tasks via Claude Code headless mode on VPS.
 * Uses Max subscription for inference, maintains session continuity.
 *
 * Architecture:
 * - Squire (Sonnet 4.6 API) = Orchestrator + Chat + Memory
 * - Claude Code (Max sub) = Coding Worker with full tooling
 */

import { exec, type ChildProcess } from 'child_process';
import { existsSync, writeFileSync, unlinkSync } from 'fs';
import type { ToolHandler, ToolSpec } from '../types.js';
import type { ClaudeCodeArgs, ClaudeCodeResult } from './types.js';

// UUID validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Track active Claude Code child processes for cleanup on disconnect
const activeProcesses = new Map<string, ChildProcess>();

/**
 * Kill all active Claude Code child processes.
 * Called when a socket disconnects to prevent orphan processes.
 */
export function killActiveClaudeCodeProcesses(): void {
  for (const [sessionId, proc] of activeProcesses) {
    console.log(`[claude_code] Killing orphan process: ${sessionId} (pid: ${proc.pid})`);
    proc.kill('SIGTERM');
    activeProcesses.delete(sessionId);
  }
}

// Default configuration
const DEFAULTS = {
  workingDir: '/opt/projects',
  model: 'sonnet',
  timeout: 900000, // 15 minutes
  vpsUser: 'ridgetop',
  sshHost: 'hetzner',
};

/**
 * Check if we're running on the VPS (no need to SSH)
 */
function isRunningOnVPS(): boolean {
  // Check for VPS-specific indicators
  const hostname = process.env.HOSTNAME || '';
  const hasSquireDir = existsSync('/opt/squire');
  const hasVPSMarker = existsSync('/etc/systemd/system/squire.service');

  return hostname.includes('ubuntu') || hasSquireDir || hasVPSMarker;
}

/**
 * Validate and get session ID
 * Always generates fresh UUIDs to avoid session collision issues
 */
function getSessionId(providedId?: string): string {
  // If provided ID is a valid UUID, use it (allows explicit resume)
  if (providedId && UUID_REGEX.test(providedId)) {
    return providedId;
  }

  // Always generate fresh UUID to avoid session collisions
  // (Claude Code rejects session IDs that are in use by other processes)
  return crypto.randomUUID();
}

/**
 * Parse Claude Code JSON output
 */
function parseClaudeCodeOutput(output: string): ClaudeCodeResult {
  try {
    const json = JSON.parse(output);

    if (json.type === 'result') {
      return {
        result: json.result || '',
        sessionId: json.session_id || '',
        success: !json.is_error,
        durationMs: json.duration_ms,
        error: json.is_error ? json.result : undefined,
      };
    }

    // Unexpected format
    return {
      result: output,
      sessionId: '',
      success: true,
    };
  } catch {
    // Not JSON - return raw output (text mode fallback)
    return {
      result: output,
      sessionId: '',
      success: true,
    };
  }
}

/**
 * Execute Claude Code on VPS
 */
async function claudeCode(args: ClaudeCodeArgs): Promise<string> {
  const { prompt, workingDir, sessionId: providedSessionId, model, timeout } = args;

  if (!prompt) {
    return 'Error: prompt is required';
  }

  const effectiveWorkingDir = workingDir || DEFAULTS.workingDir;
  const effectiveModel = model || DEFAULTS.model;
  const effectiveTimeout = Math.min(timeout || DEFAULTS.timeout, 900000);
  const sessionId = getSessionId(providedSessionId);

  // Write prompt to temp file to avoid shell escaping issues with quotes/apostrophes.
  // Node's writeFileSync handles all characters safely — no shell involvement.
  const tmpPromptFile = `/tmp/squire-prompt-${sessionId}`;
  writeFileSync(tmpPromptFile, prompt, { mode: 0o644 });

  // Build the Claude Code command (prompt fed via stdin redirection from temp file)
  const claudeCommand = [
    'claude',
    '-p',
    '--dangerously-skip-permissions',
    '--output-format json',
    `--session-id ${sessionId}`,
    `--model ${effectiveModel}`,
  ].join(' ');

  // Determine if we're on VPS or need to SSH
  const onVPS = isRunningOnVPS();
  let command: string;

  if (onVPS) {
    // Running on VPS - execute directly as ridgetop user
    // Use 'script' to provide a PTY (Claude Code needs TTY for output)
    // No single quotes in innerCommand so no escaping needed
    const innerCommand = `cd ${effectiveWorkingDir} && ${claudeCommand} < ${tmpPromptFile}`;
    command = `script -q -c "sudo -u ${DEFAULTS.vpsUser} bash -c '${innerCommand}'" /dev/null`;
    console.log(`[claude_code] Executing LOCALLY on VPS: ${effectiveWorkingDir}`);
  } else {
    // Running remotely - copy prompt file to VPS first, then execute
    await new Promise<void>((resolve, reject) => {
      exec(`scp ${tmpPromptFile} ${DEFAULTS.sshHost}:${tmpPromptFile}`, (err) => err ? reject(err) : resolve());
    });
    command = `ssh ${DEFAULTS.sshHost} 'sudo -u ${DEFAULTS.vpsUser} bash -c "cd ${effectiveWorkingDir} && ${claudeCommand} < ${tmpPromptFile} ; rm -f ${tmpPromptFile}"'`;
    console.log(`[claude_code] Executing via SSH to VPS: ${effectiveWorkingDir}`);
  }

  console.log(`[claude_code] Session: ${sessionId}`);
  console.log(`[claude_code] Model: ${effectiveModel}`);

  // Heartbeat timer for long-running CC processes
  const startTime = Date.now();
  const heartbeat = setInterval(() => {
    console.log(`[claude_code] Still running: ${sessionId} (${Math.round((Date.now() - startTime) / 1000)}s)`);
  }, 30000);

  try {
    // Use raw exec (not promisified) to get ChildProcess reference for kill-on-disconnect
    const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      const proc = exec(command, {
        timeout: effectiveTimeout,
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large outputs
        env: {
          ...process.env,
          // Ensure SSH doesn't hang on prompts
          SSH_ASKPASS: '',
          GIT_ASKPASS: '',
        },
      }, (error, stdout, stderr) => {
        activeProcesses.delete(sessionId);
        if (error) {
          reject(Object.assign(error, {
            stdout: stdout?.toString() || '',
            stderr: stderr?.toString() || '',
          }));
        } else {
          resolve({
            stdout: stdout?.toString() || '',
            stderr: stderr?.toString() || '',
          });
        }
      });
      activeProcesses.set(sessionId, proc);
    });

    // Debug logging
    console.log(`[claude_code] stdout length: ${stdout.length}`);
    console.log(`[claude_code] stdout preview: ${stdout.substring(0, 200)}`);
    if (stderr) {
      console.log(`[claude_code] stderr: ${stderr.substring(0, 500)}`);
    }

    // Parse the JSON output
    const result = parseClaudeCodeOutput(stdout.trim());

    if (!result.success) {
      return `Claude Code Error: ${result.error || 'Unknown error'}\n\nSession: ${sessionId}`;
    }

    // Format successful response
    const response = [
      result.result,
      '',
      '---',
      `Session: ${result.sessionId || sessionId}`,
      result.durationMs ? `Duration: ${(result.durationMs / 1000).toFixed(1)}s` : '',
    ]
      .filter(Boolean)
      .join('\n');

    return response;
  } catch (error: unknown) {
    const execError = error as {
      code?: number | string;
      killed?: boolean;
      signal?: string;
      stdout?: string;
      stderr?: string;
      message?: string;
    };

    // Handle timeout
    if (execError.killed && execError.signal === 'SIGTERM') {
      return `Error: Claude Code timed out after ${effectiveTimeout / 1000}s\n\nSession: ${sessionId}\n\nPartial output:\n${execError.stdout || '(none)'}`;
    }

    // Handle SSH/execution errors
    const errorMessage = execError.message || String(error);
    const stderr = execError.stderr || '';

    return `Error executing Claude Code: ${errorMessage}\n\n${stderr ? `stderr: ${stderr}\n\n` : ''}Session: ${sessionId}`;
  } finally {
    clearInterval(heartbeat);
    activeProcesses.delete(sessionId);
    // Clean up temp prompt file
    try {
      unlinkSync(tmpPromptFile);
    } catch {
      // Ignore cleanup errors
    }
  }
}

// === TOOL DEFINITION ===

export const tools: ToolSpec[] = [{
  name: 'claude_code',
  description: `Execute coding tasks using Claude Code on VPS.

This tool dispatches complex coding work to Claude Code running on the VPS with:
- Full file system access
- Git operations
- Code editing and creation
- Test execution
- Build commands

Use this for:
- Implementing features across multiple files
- Refactoring code
- Debugging complex issues
- Running tests and builds
- Any task requiring extensive file operations

Claude Code has access to Mandrel for context storage - it will persist important
decisions, completions, and context automatically.

Each call generates a fresh session. To resume a previous session, pass a valid UUID as sessionId.`,
  parameters: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'The coding task to execute. Be specific about what to do, which files, and expected outcome.',
      },
      workingDir: {
        type: 'string',
        description: 'Working directory on VPS (default: /opt/projects). Can be any path like /opt/squire for specific projects.',
      },
      sessionId: {
        type: 'string',
        description: 'Session ID (must be valid UUID) to resume a previous session. Omit for fresh session.',
      },
      model: {
        type: 'string',
        enum: ['opus', 'sonnet', 'haiku'],
        description: 'Model to use (default: sonnet). Use opus for complex tasks, haiku for simple ones.',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (default: 900000 = 15 min, max: 15 min).',
      },
    },
    required: ['prompt'],
  },
  handler: claudeCode as ToolHandler,
}];
