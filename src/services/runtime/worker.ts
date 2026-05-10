import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, writeFileSync, unlinkSync, readFileSync } from 'fs';
import { userInfo } from 'os';
import { getWorkerModel, getWorkerRuntime, type WorkerRuntimeId } from './index.js';

const execAsync = promisify(exec);

const DEFAULTS = {
  workingDir: '/opt/projects',
  timeout: 900000,
  vpsUser: 'ridgetop',
  sshHost: 'hetzner',
};

export interface WorkerAgentOptions {
  runtimeId: WorkerRuntimeId;
  prompt: string;
  workingDir?: string;
  model?: string;
  sessionId?: string;
  timeout?: number;
  sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access';
}

export interface WorkerAgentResult {
  result: string;
  sessionId: string;
  success: boolean;
  durationMs?: number;
  error?: string;
  provider: string;
  model: string;
}

function isRunningOnVPS(): boolean {
  const hostname = process.env.HOSTNAME || '';
  return hostname.includes('ubuntu') || existsSync('/opt/squire') || existsSync('/etc/systemd/system/squire.service');
}

function isRunningAsVpsUser(): boolean {
  try {
    return userInfo().username === DEFAULTS.vpsUser;
  } catch {
    return process.env.USER === DEFAULTS.vpsUser;
  }
}

function getSessionId(providedId?: string): string {
  if (providedId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(providedId)) {
    return providedId;
  }
  return crypto.randomUUID();
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function parseClaudeOutput(output: string): Omit<WorkerAgentResult, 'provider' | 'model'> {
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
  } catch {
    // Fall through to raw output.
  }

  return {
    result: output,
    sessionId: '',
    success: true,
  };
}

async function runCommand(command: string, timeout: number): Promise<{ stdout: string; stderr: string }> {
  return execAsync(command, {
    timeout,
    maxBuffer: 10 * 1024 * 1024,
    env: {
      ...process.env,
      SSH_ASKPASS: '',
      GIT_ASKPASS: '',
    },
  });
}

async function runClaudeCode(options: WorkerAgentOptions, model: string, timeout: number): Promise<WorkerAgentResult> {
  const sessionId = getSessionId(options.sessionId);
  const workingDir = options.workingDir || DEFAULTS.workingDir;
  const tmpPromptFile = `/tmp/squire-prompt-${sessionId}`;
  writeFileSync(tmpPromptFile, options.prompt, { mode: 0o644 });

  const claudeCommand = [
    'claude',
    '-p',
    '--dangerously-skip-permissions',
    '--output-format',
    'json',
    '--session-id',
    sessionId,
    '--model',
    model,
  ].map(shellQuote).join(' ');

  const onVPS = isRunningOnVPS();
  let command: string;

  if (onVPS) {
    const innerCommand = `cd ${shellQuote(workingDir)} && ${claudeCommand} < ${shellQuote(tmpPromptFile)}`;
    const userCommand = isRunningAsVpsUser()
      ? `bash -lc ${shellQuote(innerCommand)}`
      : `sudo -u ${DEFAULTS.vpsUser} -H bash -lc ${shellQuote(innerCommand)}`;
    command = `script -q -c ${shellQuote(userCommand)} /dev/null`;
    console.log(`[worker:claude-code] Executing locally: ${workingDir}`);
  } else {
    await runCommand(`scp ${shellQuote(tmpPromptFile)} ${DEFAULTS.sshHost}:${shellQuote(tmpPromptFile)}`, timeout);
    const workerCommand = `cd ${shellQuote(workingDir)} && ${claudeCommand} < ${shellQuote(tmpPromptFile)}`;
    const remoteCommand = [
      `sudo -u ${DEFAULTS.vpsUser} bash -lc ${shellQuote(workerCommand)}`,
      'status=$?',
      `rm -f ${shellQuote(tmpPromptFile)}`,
      'exit $status',
    ].join('; ');
    command = `ssh ${DEFAULTS.sshHost} ${shellQuote(remoteCommand)}`;
    console.log(`[worker:claude-code] Executing via SSH: ${workingDir}`);
  }

  try {
    const started = Date.now();
    const { stdout, stderr } = await runCommand(command, timeout);
    if (stderr) {
      console.log(`[worker:claude-code] stderr: ${stderr.substring(0, 500)}`);
    }
    const parsed = parseClaudeOutput(stdout.trim());
    return {
      ...parsed,
      durationMs: parsed.durationMs ?? Date.now() - started,
      provider: 'claude-code',
      model,
    };
  } finally {
    try {
      unlinkSync(tmpPromptFile);
    } catch {
      // Ignore cleanup errors.
    }
  }
}

async function runCodex(options: WorkerAgentOptions, model: string, timeout: number): Promise<WorkerAgentResult> {
  const workingDir = options.workingDir || DEFAULTS.workingDir;
  const sessionId = crypto.randomUUID();
  const tmpPromptFile = `/tmp/squire-prompt-${sessionId}`;
  const tmpOutputFile = `/tmp/squire-codex-output-${sessionId}`;
  const tmpJsonlFile = `/tmp/squire-codex-events-${sessionId}.jsonl`;
  writeFileSync(tmpPromptFile, options.prompt, { mode: 0o644 });

  const sandboxMode = options.sandboxMode ?? 'workspace-write';
  const codexCommand = [
    'codex',
    'exec',
    '--json',
    '--skip-git-repo-check',
    '--sandbox',
    sandboxMode,
    '-c',
    'approval_policy="never"',
    '--model',
    model,
    '--cd',
    workingDir,
    '--output-last-message',
    tmpOutputFile,
    '<',
    tmpPromptFile,
    '>',
    tmpJsonlFile,
  ].map((part) => ['<', '>'].includes(part) ? part : shellQuote(part)).join(' ');

  const onVPS = isRunningOnVPS();
  let command: string;

  if (onVPS) {
    command = isRunningAsVpsUser()
      ? `bash -lc ${shellQuote(codexCommand)}`
      : `sudo -u ${DEFAULTS.vpsUser} -H bash -lc ${shellQuote(codexCommand)}`;
    console.log(`[worker:codex] Executing locally: ${workingDir}`);
  } else {
    await runCommand(`scp ${shellQuote(tmpPromptFile)} ${DEFAULTS.sshHost}:${shellQuote(tmpPromptFile)}`, timeout);
    const remoteCommand = [
      codexCommand,
      'status=$?',
      `cat ${shellQuote(tmpOutputFile)} 2>/dev/null`,
      `rm -f ${shellQuote(tmpPromptFile)} ${shellQuote(tmpOutputFile)} ${shellQuote(tmpJsonlFile)}`,
      'exit $status',
    ].join('; ');
    command = `ssh ${DEFAULTS.sshHost} ${shellQuote(`sudo -u ${DEFAULTS.vpsUser} bash -lc ${shellQuote(remoteCommand)}`)}`;
    console.log(`[worker:codex] Executing via SSH: ${workingDir}`);
  }

  const started = Date.now();
  try {
    const { stdout } = await runCommand(command, timeout);
    const result = existsSync(tmpOutputFile) ? readFileSync(tmpOutputFile, 'utf-8') : stdout;
    return {
      result,
      sessionId,
      success: true,
      durationMs: Date.now() - started,
      provider: 'codex',
      model,
    };
  } catch (error: unknown) {
    const execError = error as { stdout?: string; stderr?: string; message?: string; killed?: boolean; signal?: string };
    let finalMessage = '';
    try {
      finalMessage = readFileSync(tmpOutputFile, 'utf-8');
    } catch {
      finalMessage = execError.stdout || '';
    }

    const errorMessage = execError.killed && execError.signal === 'SIGTERM'
      ? `Codex timed out after ${timeout / 1000}s`
      : execError.stderr || execError.message || String(error);

    return {
      result: finalMessage,
      sessionId,
      success: false,
      durationMs: Date.now() - started,
      error: errorMessage,
      provider: 'codex',
      model,
    };
  } finally {
    for (const file of [tmpPromptFile, tmpOutputFile, tmpJsonlFile]) {
      try {
        unlinkSync(file);
      } catch {
        // Ignore cleanup errors.
      }
    }
  }
}

export async function runWorkerAgent(options: WorkerAgentOptions): Promise<WorkerAgentResult> {
  if (!options.prompt || options.prompt.trim().length === 0) {
    return {
      result: '',
      sessionId: '',
      success: false,
      error: 'prompt is required',
      provider: getWorkerRuntime(options.runtimeId).provider,
      model: '',
    };
  }

  const runtime = getWorkerRuntime(options.runtimeId);
  const model = getWorkerModel(options.runtimeId, options.model);
  const timeout = Math.min(options.timeout || DEFAULTS.timeout, DEFAULTS.timeout);

  if (runtime.provider === 'codex') {
    return runCodex(options, model, timeout);
  }

  return runClaudeCode(options, model, timeout);
}
