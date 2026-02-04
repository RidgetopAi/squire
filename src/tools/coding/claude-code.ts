/**
 * Claude Code Tool
 *
 * Execute coding tasks via Claude Code headless mode on VPS.
 * Uses Max subscription for inference, maintains session continuity.
 *
 * Architecture:
 * - Squire (Opus 4.5 API) = Orchestrator + Chat + Memory
 * - Claude Code (Max sub) = Coding Worker with full tooling
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import type { ToolHandler } from '../types.js';
import type { ClaudeCodeArgs, ClaudeCodeResult } from './types.js';

const execAsync = promisify(exec);

// Session storage (in-memory, per Squire conversation)
const sessionStore = new Map<string, string>();

// Default configuration
const DEFAULTS = {
  workingDir: '/opt/projects',
  model: 'opus',
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
 * Generate or retrieve session ID for continuity
 */
function getSessionId(providedId?: string): string {
  if (providedId) {
    return providedId;
  }

  // Use a conversation-level session key
  const conversationKey = 'default';
  if (!sessionStore.has(conversationKey)) {
    sessionStore.set(conversationKey, crypto.randomUUID());
  }
  return sessionStore.get(conversationKey)!;
}

/**
 * Escape string for shell command
 */
function escapeShellArg(arg: string): string {
  // Escape single quotes by ending quote, adding escaped quote, starting quote again
  return arg.replace(/'/g, "'\\''");
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

  // Build the Claude Code command
  const escapedPrompt = escapeShellArg(prompt);
  const claudeCommand = [
    'claude',
    '-p',
    '--dangerously-skip-permissions',
    '--output-format json',
    `--session-id ${sessionId}`,
    `--model ${effectiveModel}`,
    `'${escapedPrompt}'`,
  ].join(' ');

  // Determine if we're on VPS or need to SSH
  const onVPS = isRunningOnVPS();
  let command: string;

  if (onVPS) {
    // Running on VPS - execute directly as ridgetop user
    // Use 'script' to provide a PTY (Claude Code needs TTY for output)
    const innerCommand = `cd ${effectiveWorkingDir} && ${claudeCommand}`;
    command = `script -q -c "sudo -u ${DEFAULTS.vpsUser} bash -c '${innerCommand.replace(/'/g, "'\\''")}'" /dev/null`;
    console.log(`[claude_code] Executing LOCALLY on VPS: ${effectiveWorkingDir}`);
  } else {
    // Running remotely - SSH to VPS (SSH provides PTY)
    command = `ssh ${DEFAULTS.sshHost} 'sudo -u ${DEFAULTS.vpsUser} bash -c "cd ${effectiveWorkingDir} && ${claudeCommand}"'`;
    console.log(`[claude_code] Executing via SSH to VPS: ${effectiveWorkingDir}`);
  }

  console.log(`[claude_code] Session: ${sessionId}`);
  console.log(`[claude_code] Model: ${effectiveModel}`);

  try {
    const { stdout, stderr } = await execAsync(command, {
      timeout: effectiveTimeout,
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large outputs
      env: {
        ...process.env,
        // Ensure SSH doesn't hang on prompts
        SSH_ASKPASS: '',
        GIT_ASKPASS: '',
      },
    });

    // Debug logging
    console.log(`[claude_code] stdout length: ${stdout.length}`);
    console.log(`[claude_code] stdout preview: ${stdout.substring(0, 200)}`);
    if (stderr) {
      console.log(`[claude_code] stderr: ${stderr.substring(0, 500)}`);
    }

    // Parse the JSON output
    const result = parseClaudeCodeOutput(stdout.trim());

    // Update session store if we got a new session ID
    if (result.sessionId) {
      sessionStore.set('default', result.sessionId);
    }

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
  }
}

// === TOOL DEFINITION ===

export const claudeCodeToolName = 'claude_code';

export const claudeCodeToolDescription = `Execute coding tasks using Claude Code on VPS.

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

The session persists within this conversation for continuity.`;

export const claudeCodeToolParameters = {
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
      description: 'Session ID for continuity. Usually omit to use automatic session management.',
    },
    model: {
      type: 'string',
      enum: ['opus', 'sonnet', 'haiku'],
      description: 'Model to use (default: opus). Use sonnet/haiku for simpler tasks to save quota.',
    },
    timeout: {
      type: 'number',
      description: 'Timeout in milliseconds (default: 900000 = 15 min, max: 15 min).',
    },
  },
  required: ['prompt'],
};

export const claudeCodeToolHandler: ToolHandler<ClaudeCodeArgs> = claudeCode;
