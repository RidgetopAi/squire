import { existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createRidgetopAiStatusDigest,
  type DigestStatus,
  type RidgetopAiStatusDigest,
  type StatusDigestOptions,
  type StatusProbeResult,
} from './statusDigest.js';

export interface DashboardArtifact {
  name: string;
  path: string;
  modifiedAt: Date;
  sizeBytes: number;
}

export interface DashboardMandrelState {
  project: string;
  progressSummary?: string;
  taskBoard?: string;
  recentContext?: string;
  launchRequests?: string;
  error?: string;
}

export interface RidgetopAiDailyDashboard {
  checkedAt: Date;
  project: string;
  status: DigestStatus;
  statusDigest: RidgetopAiStatusDigest;
  mandrel?: DashboardMandrelState;
  artifacts: DashboardArtifact[];
  focus: string[];
}

export type DashboardMandrelToolCaller = (
  toolName: string,
  args?: Record<string, unknown>
) => Promise<string>;

export type DashboardStatusDigestCreator = (
  options?: StatusDigestOptions
) => Promise<RidgetopAiStatusDigest>;

export interface DailyDashboardOptions {
  now?: Date;
  project?: string;
  statusDigest?: RidgetopAiStatusDigest;
  createStatusDigest?: DashboardStatusDigestCreator;
  mandrelTool?: DashboardMandrelToolCaller;
  includeMandrel?: boolean;
  includeArtifacts?: boolean;
  mandrelBaseUrl?: string;
  mandrelConnectionId?: string;
  artifactDir?: string;
  artifactLimit?: number;
}

const DEFAULT_PROJECT = 'ridgetopai';
const DEFAULT_ARTIFACT_LIMIT = 8;

export async function createRidgetopAiDailyDashboard(
  options: DailyDashboardOptions = {}
): Promise<RidgetopAiDailyDashboard> {
  const checkedAt = options.now ?? new Date();
  const project = options.project ?? process.env['RTA_DASHBOARD_PROJECT'] ?? DEFAULT_PROJECT;
  const includeMandrel = options.includeMandrel ?? true;
  const includeArtifacts = options.includeArtifacts ?? true;

  const statusDigest = options.statusDigest ?? await (options.createStatusDigest ?? createRidgetopAiStatusDigest)({
    now: checkedAt,
    mandrelProject: project,
    mandrelConnectionId: options.mandrelConnectionId ?? `squire:daily-dashboard:${project}`,
  });

  const [mandrel, artifacts] = await Promise.all([
    includeMandrel ? getDashboardMandrelState(project, options) : Promise.resolve(undefined),
    includeArtifacts ? listDashboardArtifacts(options) : Promise.resolve([]),
  ]);

  return {
    checkedAt,
    project,
    status: computeDashboardStatus(statusDigest, mandrel),
    statusDigest,
    mandrel,
    artifacts,
    focus: buildFocusItems(statusDigest, mandrel),
  };
}

export function renderDailyDashboardMarkdown(dashboard: RidgetopAiDailyDashboard): string {
  const lines = [
    '# RidgetopAI Daily Operating Dashboard',
    '',
    `**Checked:** ${dashboard.checkedAt.toISOString()}`,
    `**Project:** ${dashboard.project}`,
    `**Overall:** ${dashboard.status.toUpperCase()}`,
    '',
    '## Focus',
    '',
    ...dashboard.focus.map((item) => `- ${item}`),
    '',
    '## Probe Summary',
    '',
    renderProbeSummary(dashboard.statusDigest.probes),
    '',
    '| Name | Kind | Status | Detail |',
    '| --- | --- | --- | --- |',
    ...dashboard.statusDigest.probes.map((probe) => [
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

  if (dashboard.mandrel) {
    lines.push('', '## Mandrel Board', '', `**Project:** ${dashboard.mandrel.project}`);

    if (dashboard.mandrel.error) {
      lines.push('', `Mandrel dashboard data is degraded: ${dashboard.mandrel.error}`);
    }

    appendFencedSection(lines, 'Progress', dashboard.mandrel.progressSummary, 1600);
    appendFencedSection(lines, 'Open Work And Blockers', dashboard.mandrel.taskBoard, 2600);
    appendFencedSection(lines, 'Recent Context', dashboard.mandrel.recentContext, 2200);
    appendFencedSection(lines, 'Launch Requests', dashboard.mandrel.launchRequests, 1600);
  }

  lines.push('', '## Recent Report Artifacts', '');

  if (dashboard.artifacts.length === 0) {
    lines.push('No report artifacts found from this runtime.');
  } else {
    lines.push('| Report | Modified | Size |', '| --- | --- | --- |');
    for (const artifact of dashboard.artifacts) {
      lines.push([
        '|',
        escapeTableCell(artifact.name),
        '|',
        artifact.modifiedAt.toISOString(),
        '|',
        formatBytes(artifact.sizeBytes),
        '|',
      ].join(' '));
    }
  }

  lines.push(
    '',
    '## Metrics To Watch',
    '',
    '- Task cycle time and blocked time.',
    '- Decisions awaiting Brian.',
    '- Verification performed per work block.',
    '- Outreach/research experiments once RTA-037 starts.',
    '- Model/tool routing and local GPU ownership.'
  );

  return lines.join('\n');
}

export function renderDailyDashboardConfirmation(dashboard: RidgetopAiDailyDashboard): string {
  const counts = countStatuses(dashboard.statusDigest.probes);
  const lines = [
    `RidgetopAI dashboard: ${dashboard.status.toUpperCase()}`,
    `Checked: ${dashboard.checkedAt.toISOString()}`,
    `Probes: ${counts.healthy} healthy, ${counts.degraded} degraded, ${counts.unhealthy} unhealthy, ${counts.unknown} unknown`,
    '',
    'Focus:',
    ...dashboard.focus.slice(0, 5).map((item) => `- ${item}`),
  ];

  const notable = dashboard.statusDigest.probes
    .filter((probe) => probe.status !== 'healthy')
    .slice(0, 4)
    .map((probe) => `- ${probe.name}: ${probe.status} (${truncate(probe.detail, 110)})`);

  if (notable.length > 0) {
    lines.push('', 'Notable probes:', ...notable);
  }

  if (dashboard.mandrel?.progressSummary) {
    lines.push('', truncate(dashboard.mandrel.progressSummary, 700));
  }

  if (dashboard.artifacts.length > 0) {
    lines.push('', 'Recent reports:', ...dashboard.artifacts.slice(0, 3).map((artifact) => `- ${artifact.name}`));
  }

  return lines.join('\n');
}

function computeDashboardStatus(
  statusDigest: RidgetopAiStatusDigest,
  mandrel: DashboardMandrelState | undefined
): DigestStatus {
  if (statusDigest.status === 'unhealthy') {
    return 'unhealthy';
  }

  if (statusDigest.status === 'degraded' || mandrel?.error) {
    return 'degraded';
  }

  return statusDigest.status;
}

async function getDashboardMandrelState(
  project: string,
  options: DailyDashboardOptions
): Promise<DashboardMandrelState> {
  const tool = options.mandrelTool ?? createMandrelHttpTool(options, project);

  try {
    await tool('project_switch', { project });
    const [progressSummary, taskBoard, recentContext, launchRequests] = await Promise.all([
      tool('task_progress_summary', {}),
      tool('task_list', {}),
      tool('context_get_recent', { limit: 5 }),
      tool('context_search', { query: 'codex-launcher launch-request ridgetopai', limit: 5 }),
    ]);

    return {
      project,
      progressSummary,
      taskBoard,
      recentContext,
      launchRequests,
    };
  } catch (error) {
    return {
      project,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function createMandrelHttpTool(
  options: DailyDashboardOptions,
  project: string
): DashboardMandrelToolCaller {
  const baseUrl = withoutTrailingSlash(
    options.mandrelBaseUrl ??
    process.env['RTA_DASHBOARD_MANDREL_BASE_URL'] ??
    process.env['RTA_STATUS_MANDREL_BASE_URL'] ??
    'https://mandrel.ridgetopai.net'
  );
  const connectionId = options.mandrelConnectionId ??
    process.env['RTA_DASHBOARD_MANDREL_CONNECTION_ID'] ??
    `squire:daily-dashboard:${project}`;

  return async (toolName, args = {}) => callMandrelTextTool(baseUrl, connectionId, toolName, args);
}

async function callMandrelTextTool(
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

async function listDashboardArtifacts(options: DailyDashboardOptions): Promise<DashboardArtifact[]> {
  const artifactDir = options.artifactDir ??
    process.env['RTA_DASHBOARD_REPORT_DIR'] ??
    firstExistingPath([
      '/home/ridgetop/projects/ridgetopai-reports',
      '/opt/ridgetopai-reports',
    ]);

  if (!artifactDir || !existsSync(artifactDir)) {
    return [];
  }

  const entries = await readdir(artifactDir);
  const artifacts = await Promise.all(entries
    .filter((entry) => entry.endsWith('.html'))
    .map(async (entry): Promise<DashboardArtifact | undefined> => {
      const path = join(artifactDir, entry);
      const info = await stat(path);

      if (!info.isFile()) {
        return undefined;
      }

      return {
        name: entry,
        path,
        modifiedAt: info.mtime,
        sizeBytes: info.size,
      };
    }));

  return artifacts
    .filter((artifact): artifact is DashboardArtifact => artifact !== undefined)
    .sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime())
    .slice(0, options.artifactLimit ?? DEFAULT_ARTIFACT_LIMIT);
}

function buildFocusItems(
  statusDigest: RidgetopAiStatusDigest,
  mandrel: DashboardMandrelState | undefined
): string[] {
  const focus: string[] = [];

  if (statusDigest.status !== 'healthy') {
    focus.push('Review degraded or unhealthy probes before starting risky work.');
  }

  if (mandrel?.error) {
    focus.push('Repair Mandrel dashboard access so the daily board stays trustworthy.');
  }

  focus.push('Advance the highest-leverage unblocked Mandrel task with a verified artifact.');
  focus.push('Keep Flowux untouched while Brian is actively working there.');
  focus.push('Capture decisions, blockers, and completions in Mandrel before ending the work block.');

  return focus;
}

function renderProbeSummary(probes: StatusProbeResult[]): string {
  const counts = countStatuses(probes);
  return [
    `${counts.healthy} healthy`,
    `${counts.degraded} degraded`,
    `${counts.unhealthy} unhealthy`,
    `${counts.unknown} unknown`,
  ].join(', ');
}

function countStatuses(probes: StatusProbeResult[]): Record<DigestStatus, number> {
  const counts: Record<DigestStatus, number> = {
    healthy: 0,
    degraded: 0,
    unhealthy: 0,
    unknown: 0,
  };

  for (const probe of probes) {
    counts[probe.status] += 1;
  }

  return counts;
}

function appendFencedSection(
  lines: string[],
  heading: string,
  value: string | undefined,
  maxLength: number
): void {
  if (!value) {
    return;
  }

  lines.push('', `### ${heading}`, '', '```text', truncate(value, maxLength), '```');
}

function firstExistingPath(paths: string[]): string | undefined {
  return paths.find((path) => existsSync(path));
}

function withoutTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const kib = bytes / 1024;
  if (kib < 1024) {
    return `${kib.toFixed(1)} KiB`;
  }

  return `${(kib / 1024).toFixed(1)} MiB`;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}
