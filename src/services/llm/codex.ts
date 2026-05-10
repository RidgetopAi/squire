import { exec } from 'child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { userInfo } from 'os';
import { config } from '../../config/index.js';
import type { CallOptions, LLMMessage, LLMResponse, StreamCallbacks, ToolDefinition } from './types.js';

const DEFAULTS = {
  workingDir: '/opt/squire',
  vpsUser: 'ridgetop',
  sshHost: 'hetzner',
};

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

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function formatMessageForPrompt(message: LLMMessage, index: number): string {
  const header = `${index + 1}. ${message.role.toUpperCase()}`;
  const parts = [header, message.content || '(empty)'];

  if (message.images && message.images.length > 0) {
    parts.push(`[${message.images.length} image attachment(s) omitted from Codex chat prompt]`);
  }

  if (message.tool_calls && message.tool_calls.length > 0) {
    parts.push(`Tool calls from prior assistant turn:\n${JSON.stringify(message.tool_calls, null, 2)}`);
  }

  if (message.tool_call_id) {
    parts.push(`Tool result id: ${message.tool_call_id}`);
  }

  return parts.join('\n');
}

function buildCodexPrompt(messages: LLMMessage[], tools?: ToolDefinition[]): string {
  const transcript = messages.map(formatMessageForPrompt).join('\n\n---\n\n');
  const toolNote = tools && tools.length > 0
    ? [
        'You can request Squire app tools when you need live app state, database-backed information, files stored in Squire, image analysis, Mandrel context, email/calendar/list data, or other registered capabilities.',
        'You do not call these tools directly. Instead, return a strict tool-call envelope and Squire will execute the tools, append the results to the transcript, and call you again.',
        'When you need tools, return ONLY this envelope and no prose:',
        'SQUIRE_TOOL_CALLS_JSON',
        '{"toolCalls":[{"name":"tool_name","arguments":{"key":"value"}}]}',
        'END_SQUIRE_TOOL_CALLS_JSON',
        'Available Squire tools:',
        JSON.stringify(tools.map((tool) => tool.function), null, 2),
      ].join('\n')
    : 'No Squire app tools are attached to this Codex chat call.';

  return [
    'You are Squire\'s main chat agent running through Codex CLI.',
    'Answer the latest user message using the system instructions, dynamic context, and conversation transcript below.',
    'Keep continuity with the transcript. Do not mention implementation details of this prompt.',
    toolNote,
    '',
    '=== TRANSCRIPT ===',
    transcript,
    '=== END TRANSCRIPT ===',
  ].join('\n');
}

function parseCodexToolCalls(
  content: string,
  tools?: ToolDefinition[]
): { cleanContent: string; toolCalls: LLMResponse['toolCalls'] } {
  if (!tools || tools.length === 0) {
    return { cleanContent: content, toolCalls: [] };
  }

  const match = content.match(/SQUIRE_TOOL_CALLS_JSON\s*([\s\S]*?)\s*END_SQUIRE_TOOL_CALLS_JSON/);
  if (!match) {
    return { cleanContent: content, toolCalls: [] };
  }

  const allowedTools = new Set(tools.map((tool) => tool.function.name));
  const cleanContent = content.replace(match[0], '').trim();

  try {
    const parsed = JSON.parse(match[1]!.trim()) as {
      toolCalls?: Array<{ name?: unknown; arguments?: unknown }>;
    };
    const toolCalls = (parsed.toolCalls ?? [])
      .filter((call): call is { name: string; arguments?: unknown } => (
        typeof call.name === 'string' && allowedTools.has(call.name)
      ))
      .map((call) => ({
        id: `codex_tool_${crypto.randomUUID()}`,
        type: 'function' as const,
        function: {
          name: call.name,
          arguments: JSON.stringify(call.arguments ?? {}),
        },
      }));

    return { cleanContent, toolCalls };
  } catch (error) {
    console.warn('[LLM Codex] Failed to parse tool-call envelope:', error);
    return { cleanContent: content, toolCalls: [] };
  }
}

function chunkText(text: string, size = 160): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks.length > 0 ? chunks : [''];
}

function runCommand(command: string, timeout: number, signal?: AbortSignal): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let abort: () => void = () => undefined;
    const child = exec(command, {
      timeout,
      maxBuffer: 20 * 1024 * 1024,
      env: {
        ...process.env,
        SSH_ASKPASS: '',
        GIT_ASKPASS: '',
      },
    }, (error, stdout, stderr) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      if (error) {
        reject(Object.assign(error, { stdout, stderr }));
      } else {
        resolve({ stdout, stderr });
      }
    });

    abort = (): void => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      reject(new Error('Codex chat cancelled'));
    };

    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export async function callCodex(
  messages: LLMMessage[],
  tools?: ToolDefinition[],
  callbacks?: StreamCallbacks,
  options?: CallOptions
): Promise<LLMResponse> {
  const model = options?.model ?? config.llm.model;
  const timeout = config.llm.codexChatTimeoutMs;
  const sessionId = crypto.randomUUID();
  const promptFile = `/tmp/squire-codex-chat-prompt-${sessionId}`;
  const outputFile = `/tmp/squire-codex-chat-output-${sessionId}`;
  const jsonlFile = `/tmp/squire-codex-chat-events-${sessionId}.jsonl`;
  const prompt = buildCodexPrompt(messages, tools);
  writeFileSync(promptFile, prompt, { mode: 0o644 });

  const codexCommand = [
    'codex',
    'exec',
    '--json',
    '--sandbox',
    'read-only',
    '-c',
    'approval_policy="never"',
    '--model',
    model,
    '--cd',
    DEFAULTS.workingDir,
    '--output-last-message',
    outputFile,
    '<',
    promptFile,
    '>',
    jsonlFile,
  ].map((part) => ['<', '>'].includes(part) ? part : shellQuote(part)).join(' ');

  const command = isRunningOnVPS()
    ? isRunningAsVpsUser()
      ? `bash -lc ${shellQuote(codexCommand)}`
      : `sudo -u ${DEFAULTS.vpsUser} -H bash -lc ${shellQuote(codexCommand)}`
    : `scp ${shellQuote(promptFile)} ${DEFAULTS.sshHost}:${shellQuote(promptFile)} && ssh ${DEFAULTS.sshHost} ${shellQuote(`sudo -u ${DEFAULTS.vpsUser} -H bash -lc ${shellQuote(codexCommand)}`)}`;

  try {
    console.log(`[LLM Codex] Starting main chat Codex run (${model})`);
    const started = Date.now();
    const { stdout } = await runCommand(command, timeout, options?.signal);
    const content = existsSync(outputFile) ? readFileSync(outputFile, 'utf-8') : stdout;
    const finalContent = content.trim();
    const parsed = parseCodexToolCalls(finalContent, tools);

    if (parsed.toolCalls.length === 0) {
      for (const chunk of chunkText(parsed.cleanContent)) {
        callbacks?.onChunk?.(chunk);
      }
    } else {
      console.log(`[LLM Codex] Requested Squire tools: ${parsed.toolCalls.map((tc) => tc.function.name).join(', ')}`);
    }

    console.log(`[LLM Codex] Completed main chat Codex run in ${Date.now() - started}ms (${parsed.cleanContent.length} chars, ${parsed.toolCalls.length} tool calls)`);
    return {
      content: parsed.cleanContent,
      toolCalls: parsed.toolCalls,
      model,
    };
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string; message?: string; killed?: boolean; signal?: string };
    let partial = '';
    try {
      partial = readFileSync(outputFile, 'utf-8').trim();
    } catch {
      partial = (err.stdout || '').trim();
    }

    if (partial) {
      for (const chunk of chunkText(partial)) {
        callbacks?.onChunk?.(chunk);
      }
      return {
        content: partial,
        toolCalls: [],
        model,
      };
    }

    const message = err.killed && err.signal === 'SIGTERM'
      ? `Codex chat timed out after ${timeout / 1000}s`
      : err.stderr || err.message || String(error);
    throw new Error(`Codex chat error: ${message}`);
  } finally {
    for (const file of [promptFile, outputFile, jsonlFile]) {
      try {
        unlinkSync(file);
      } catch {
        // Ignore cleanup errors.
      }
    }
  }
}
