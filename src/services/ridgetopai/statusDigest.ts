import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type DigestStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
export type ProbeKind = 'endpoint' | 'git' | 'mandrel';

export interface EndpointProbe {
  name: string;
  url: string;
  optional?: boolean;
}

export interface GitProbe {
  name: string;
  path: string;
}

export interface StatusProbeResult {
  name: string;
  kind: ProbeKind;
  status: DigestStatus;
  detail: string;
  responseTimeMs?: number;
  url?: string;
  path?: string;
}

export interface MandrelDigest {
  project: string;
  progressSummary?: string;
  todoSummary?: string;
}

export interface StatusDigestOptions {
  now?: Date;
  endpointProbes?: EndpointProbe[];
  gitProbes?: GitProbe[];
  mandrelBaseUrl?: string;
  mandrelProject?: string;
  mandrelConnectionId?: string;
  includeMandrel?: boolean;
}

export interface RidgetopAiStatusDigest {
  checkedAt: Date;
  status: DigestStatus;
  probes: StatusProbeResult[];
  mandrel?: MandrelDigest;
}

const DEFAULT_ENDPOINTS: EndpointProbe[] = [
  { name: 'Squire API', url: 'https://squire.ridgetopai.net/api/health' },
  { name: 'Mandrel MCP', url: 'https://mandrel.ridgetopai.net/health' },
  { name: 'Mandrel Command UI', url: 'https://command.ridgetopai.net/' },
  { name: 'Harmony local runtime', url: 'http://127.0.0.1:8787/health', optional: true },
];

const DEFAULT_GIT_REPOS: GitProbe[] = [
  { name: 'squire', path: '/home/ridgetop/projects/squire' },
  { name: 'harmony', path: '/home/ridgetop/projects/harmony' },
];

export async function createRidgetopAiStatusDigest(
  options: StatusDigestOptions = {}
): Promise<RidgetopAiStatusDigest> {
  const checkedAt = options.now ?? new Date();
  const endpointProbes = options.endpointProbes ?? DEFAULT_ENDPOINTS;
  const gitProbes = options.gitProbes ?? DEFAULT_GIT_REPOS;
  const includeMandrel = options.includeMandrel ?? true;

  const [endpointResults, gitResults, mandrelResult] = await Promise.all([
    Promise.all(endpointProbes.map(checkEndpoint)),
    Promise.all(gitProbes.map(checkGitRepo)),
    includeMandrel ? getMandrelDigest(options) : Promise.resolve(undefined),
  ]);

  const probes = [
    ...endpointResults,
    ...gitResults,
    ...(mandrelResult?.probe ? [mandrelResult.probe] : []),
  ];

  return {
    checkedAt,
    status: computeOverallStatus(probes),
    probes,
    mandrel: mandrelResult?.digest,
  };
}

export function computeOverallStatus(probes: StatusProbeResult[]): DigestStatus {
  if (probes.some((probe) => probe.status === 'unhealthy')) {
    return 'unhealthy';
  }

  if (probes.some((probe) => probe.status === 'degraded' || probe.status === 'unknown')) {
    return 'degraded';
  }

  return 'healthy';
}

export function renderStatusDigestMarkdown(digest: RidgetopAiStatusDigest): string {
  const lines = [
    '# RidgetopAI Status Digest',
    '',
    `**Checked:** ${digest.checkedAt.toISOString()}`,
    `**Overall:** ${digest.status.toUpperCase()}`,
    '',
    '## Probes',
    '',
    '| Name | Kind | Status | Detail |',
    '| --- | --- | --- | --- |',
    ...digest.probes.map((probe) => [
      '|',
      escapeTableCell(probe.name),
      '|',
      probe.kind,
      '|',
      probe.status,
      '|',
      escapeTableCell(probe.detail),
      '|',
    ].join(' ')),
  ];

  if (digest.mandrel) {
    lines.push('', '## Mandrel', '', `**Project:** ${digest.mandrel.project}`);

    if (digest.mandrel.progressSummary) {
      lines.push('', '### Progress', '', fence(digest.mandrel.progressSummary));
    }

    if (digest.mandrel.todoSummary) {
      lines.push('', '### Open Tasks', '', fence(digest.mandrel.todoSummary));
    }
  }

  return lines.join('\n');
}

async function checkEndpoint(probe: EndpointProbe): Promise<StatusProbeResult> {
  const startedAt = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(probe.url, { signal: controller.signal });
    clearTimeout(timeout);

    const responseTimeMs = Date.now() - startedAt;
    const ok = response.status >= 200 && response.status < 400;

    return {
      name: probe.name,
      kind: 'endpoint',
      status: ok ? 'healthy' : (probe.optional ? 'degraded' : 'unhealthy'),
      detail: `HTTP ${response.status} in ${responseTimeMs}ms`,
      responseTimeMs,
      url: probe.url,
    };
  } catch (error) {
    const responseTimeMs = Date.now() - startedAt;
    const message = error instanceof Error ? error.message : String(error);

    return {
      name: probe.name,
      kind: 'endpoint',
      status: probe.optional ? 'degraded' : 'unhealthy',
      detail: `${message} after ${responseTimeMs}ms`,
      responseTimeMs,
      url: probe.url,
    };
  }
}

async function checkGitRepo(probe: GitProbe): Promise<StatusProbeResult> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', probe.path, 'status', '--short', '--branch'], {
      encoding: 'utf8',
      timeout: 8000,
      maxBuffer: 1024 * 256,
    });
    const detail = stdout.trim() || 'clean';
    const status = classifyGitStatus(stdout);

    return {
      name: probe.name,
      kind: 'git',
      status,
      detail,
      path: probe.path,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return {
      name: probe.name,
      kind: 'git',
      status: 'unknown',
      detail: message,
      path: probe.path,
    };
  }
}

export function classifyGitStatus(statusOutput: string): DigestStatus {
  const lines = statusOutput.trim().split('\n').filter(Boolean);
  const branchLine = lines[0] ?? '';
  const worktreeLines = lines.slice(1);

  if (worktreeLines.length > 0) {
    return 'degraded';
  }

  if (/\[(ahead|behind|gone|diverged)/.test(branchLine)) {
    return 'degraded';
  }

  return 'healthy';
}

async function getMandrelDigest(options: StatusDigestOptions): Promise<{
  probe: StatusProbeResult;
  digest?: MandrelDigest;
}> {
  const mandrelBaseUrl = withoutTrailingSlash(
    options.mandrelBaseUrl ?? process.env['RTA_STATUS_MANDREL_BASE_URL'] ?? 'https://mandrel.ridgetopai.net'
  );
  const project = options.mandrelProject ?? process.env['RTA_STATUS_MANDREL_PROJECT'] ?? 'ridgetopai';
  const connectionId = options.mandrelConnectionId ??
    process.env['RTA_STATUS_MANDREL_CONNECTION_ID'] ??
    `squire:status-digest:${project}`;

  try {
    await callMandrelTool(mandrelBaseUrl, connectionId, 'project_switch', { project });
    const [progressSummary, todoSummary] = await Promise.all([
      callMandrelTool(mandrelBaseUrl, connectionId, 'task_progress_summary', {}),
      callMandrelTool(mandrelBaseUrl, connectionId, 'task_list', { status: 'todo', limit: 10 }),
    ]);

    return {
      probe: {
        name: 'Mandrel task board',
        kind: 'mandrel',
        status: 'healthy',
        detail: `Project ${project} task summaries loaded`,
        url: mandrelBaseUrl,
      },
      digest: {
        project,
        progressSummary,
        todoSummary,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return {
      probe: {
        name: 'Mandrel task board',
        kind: 'mandrel',
        status: 'degraded',
        detail: message,
        url: mandrelBaseUrl,
      },
      digest: { project },
    };
  }
}

async function callMandrelTool(
  baseUrl: string,
  connectionId: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<string> {
  const response = await fetch(`${baseUrl}/mcp/tools/${toolName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Connection-ID': connectionId,
    },
    body: JSON.stringify({ arguments: args }),
  });

  const body = await response.json() as {
    success?: boolean;
    error?: string;
    result?: {
      content?: Array<{ type?: string; text?: string }>;
    };
  };

  if (!response.ok || body.success === false) {
    throw new Error(body.error ?? `Mandrel ${toolName} failed with HTTP ${response.status}`);
  }

  const text = body.result?.content
    ?.map((item) => item.text)
    .filter((value): value is string => typeof value === 'string')
    .join('\n\n');

  return text?.trim() || JSON.stringify(body);
}

function withoutTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

function fence(value: string): string {
  return ['```text', value, '```'].join('\n');
}
