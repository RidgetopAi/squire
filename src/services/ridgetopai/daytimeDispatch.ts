import {
  createRidgetopAiStatusDigest,
  type DigestStatus,
  type RidgetopAiStatusDigest,
  type StatusDigestOptions,
} from './statusDigest.js';
import {
  createRidgetopAiDailyDashboard,
  renderDailyDashboardConfirmation,
  type DailyDashboardOptions,
  type RidgetopAiDailyDashboard,
} from './dailyDashboard.js';
import {
  callMandrelTool,
  type MandrelCallOptions,
  type MandrelResponse,
} from '../mandrel/index.js';

const RTA_PROJECT = 'ridgetopai';
const CONNECTION_SCOPE = 'daytime-dispatch';
const CODEX_LAUNCH_WORKING_DIR = '/home/ridgetop/projects/ridgetopai';
const CODEX_LAUNCH_TTL_MS = 24 * 60 * 60 * 1000;
const CODEX_LAUNCH_ALLOWED_PATHS = [
  '/home/ridgetop/projects/ridgetopai',
  '/home/ridgetop/projects/ridgetopai-ops',
  '/home/ridgetop/projects/ridgetopai-reports',
  '/home/ridgetop/projects/squire',
  '/home/ridgetop/projects/flowux',
  '/home/ridgetop/projects/harmony',
  '/home/ridgetop/projects/thucydides',
  '/home/ridgetop/aidis',
];

type ContextType = 'discussion' | 'planning' | 'decision';
type ApprovalDecision = 'approved' | 'denied';
type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';
type CodexLaunchApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired';
type CodexLaunchMode = 'prepare_only' | 'manual_pull' | 'local_start';
type CodexLaunchSandbox = 'read-only' | 'workspace-write';

export interface CodexLaunchRequest {
  schemaVersion: 1;
  requestId: string;
  state: 'queued';
  project: string;
  taskId: string;
  title: string;
  requestedBy: string;
  requestedAt: string;
  expiresAt: string;
  workingDir: string;
  prompt: string;
  scope: {
    allowedPaths: string[];
    allowedOperations: string[];
    forbiddenOperations: string[];
    summary?: string;
  };
  approval: {
    required: boolean;
    status: CodexLaunchApprovalStatus;
    reason?: string;
  };
  execution: {
    sandbox: CodexLaunchSandbox;
    maxRuntimeMinutes: number;
    mode: CodexLaunchMode;
  };
  stopConditions: string[];
  requiredFinalization: string[];
}

export type DaytimeDispatchIntent =
  | { kind: 'status_request' }
  | { kind: 'dashboard_request' }
  | { kind: 'store_context'; content: string; contextType: ContextType }
  | {
    kind: 'create_task';
    title: string;
    description?: string;
    priority: TaskPriority;
  }
  | {
    kind: 'approval';
    decision: ApprovalDecision;
    target: string;
    reason?: string;
  }
  | {
    kind: 'codex_launch_prepare';
    taskRef: string;
    scope?: string;
  }
  | { kind: 'codex_launch_status' }
  | {
    kind: 'codex_launch_cancel';
    requestId: string;
    reason?: string;
  }
  | { kind: 'help' }
  | { kind: 'invalid'; message: string };

export interface DaytimeDispatchResult {
  handled: boolean;
  intent?: DaytimeDispatchIntent;
  confirmation?: string;
  error?: string;
}

export type MandrelToolCaller = <T = unknown>(
  toolName: string,
  args?: Record<string, unknown>,
  options?: MandrelCallOptions
) => Promise<MandrelResponse<T>>;

export type StatusDigestCreator = (
  options?: StatusDigestOptions
) => Promise<RidgetopAiStatusDigest>;

export type DailyDashboardCreator = (
  options?: DailyDashboardOptions
) => Promise<RidgetopAiDailyDashboard>;

export interface DaytimeDispatchOptions {
  mandrelCall?: MandrelToolCaller;
  createStatusDigest?: StatusDigestCreator;
  createDailyDashboard?: DailyDashboardCreator;
  now?: Date;
  project?: string;
  source?: string;
  createRequestId?: () => string;
}

interface MandrelBridgeBody {
  success?: boolean;
  error?: string;
}

interface MandrelTextContent {
  type?: unknown;
  text?: unknown;
}

export function parseDaytimeDispatchText(text: string): DaytimeDispatchIntent | null {
  const payload = extractRtaPayload(text);

  if (payload === null) {
    return null;
  }

  if (!payload) {
    return { kind: 'help' };
  }

  const { command, rest } = splitCommand(payload);

  if (command === 'help') {
    return { kind: 'help' };
  }

  if (command === 'status' || command === 'digest' || command === 'state') {
    return { kind: 'status_request' };
  }

  if (command === 'dashboard' || command === 'daily' || command === 'board') {
    return { kind: 'dashboard_request' };
  }

  if (command === 'note' || command === 'context' || command === 'remember') {
    if (!rest) {
      return { kind: 'invalid', message: 'Add the context text after the note command.' };
    }

    return { kind: 'store_context', content: rest, contextType: 'discussion' };
  }

  if (command === 'plan') {
    if (!rest) {
      return { kind: 'invalid', message: 'Add the planning note after the plan command.' };
    }

    return { kind: 'store_context', content: rest, contextType: 'planning' };
  }

  if (command === 'task' || command === 'todo') {
    return parseTaskIntent(rest);
  }

  if (command === 'codex') {
    return parseCodexLaunchIntent(rest);
  }

  if (command === 'approve' || command === 'approved') {
    return parseApprovalIntent(rest, 'approved');
  }

  if (command === 'deny' || command === 'denied' || command === 'reject' || command === 'rejected') {
    return parseApprovalIntent(rest, 'denied');
  }

  return {
    kind: 'invalid',
    message: `Unknown RTA dispatch command: ${command}`,
  };
}

export async function handleDaytimeDispatchText(
  text: string,
  options: DaytimeDispatchOptions = {}
): Promise<DaytimeDispatchResult> {
  const intent = parseDaytimeDispatchText(text);

  if (!intent) {
    return { handled: false };
  }

  if (intent.kind === 'help') {
    return {
      handled: true,
      intent,
      confirmation: renderDispatchHelp(),
    };
  }

  if (intent.kind === 'invalid') {
    return {
      handled: true,
      intent,
      confirmation: `${intent.message}\n\n${renderDispatchHelp()}`,
      error: intent.message,
    };
  }

  try {
    const project = options.project ?? RTA_PROJECT;
    const mandrelCall = options.mandrelCall ?? callMandrelTool;
    const source = options.source ?? 'squire';
    const now = options.now ?? new Date();

    switch (intent.kind) {
      case 'status_request':
        return {
          handled: true,
          intent,
          confirmation: await createStatusConfirmation(project, options.createStatusDigest),
        };
      case 'dashboard_request':
        return {
          handled: true,
          intent,
          confirmation: await createDashboardConfirmation(project, options.createDailyDashboard),
        };
      case 'store_context':
        await ensureProject(mandrelCall, project);
        await requireMandrelSuccess(
          'context_store',
          await mandrelCall('context_store', {
            content: renderContextMemory(intent, source, now),
            type: intent.contextType,
            tags: ['ridgetopai', 'squire-dispatch', 'daytime-control', intent.contextType],
          }, dispatchMandrelOptions(project))
        );

        return {
          handled: true,
          intent,
          confirmation: `Stored RidgetopAI ${intent.contextType} context in Mandrel.`,
        };
      case 'create_task':
        await ensureProject(mandrelCall, project);
        await requireMandrelSuccess(
          'task_create',
          await mandrelCall('task_create', {
            title: intent.title,
            description: intent.description,
            priority: intent.priority,
            tags: ['ridgetopai', 'squire-dispatch', 'daytime-control'],
          }, dispatchMandrelOptions(project))
        );

        return {
          handled: true,
          intent,
          confirmation: `Created RidgetopAI task: ${intent.title}`,
        };
      case 'approval':
        await ensureProject(mandrelCall, project);
        await requireMandrelSuccess(
          'context_store',
          await mandrelCall('context_store', {
            content: renderApprovalMemory(intent, source, now),
            type: 'decision',
            tags: ['ridgetopai', 'squire-dispatch', 'daytime-control', 'approval', intent.decision],
          }, dispatchMandrelOptions(project))
        );

        return {
          handled: true,
          intent,
          confirmation: `Captured ${intent.decision} signal for ${intent.target}. No action was executed.`,
        };
      case 'codex_launch_prepare': {
        await ensureProject(mandrelCall, project);
        const request = createCodexLaunchRequest(intent, {
          project,
          source,
          now,
          createRequestId: options.createRequestId,
        });
        await requireMandrelSuccess(
          'context_store',
          await mandrelCall('context_store', {
            content: renderCodexLaunchRequestMemory(request, source, now),
            type: 'planning',
            tags: [
              'ridgetopai',
              'squire-dispatch',
              'daytime-control',
              'codex-launcher',
              'launch-request',
              'approval-required',
              request.taskId,
              request.requestId,
            ],
          }, dispatchMandrelOptions(project))
        );

        return {
          handled: true,
          intent,
          confirmation: [
            `Prepared Codex launch request ${request.requestId} for ${request.taskId}.`,
            'No Codex process was started.',
            'Approve and run it from the WSL2 launcher after validation.',
          ].join('\n'),
        };
      }
      case 'codex_launch_status': {
        await ensureProject(mandrelCall, project);
        const statusResponse = await mandrelCall('context_get_recent', {}, dispatchMandrelOptions(project));
        await requireMandrelSuccess('context_get_recent', statusResponse);

        return {
          handled: true,
          intent,
          confirmation: renderCodexLaunchStatusConfirmation(statusResponse.data),
        };
      }
      case 'codex_launch_cancel':
        await ensureProject(mandrelCall, project);
        await requireMandrelSuccess(
          'context_store',
          await mandrelCall('context_store', {
            content: renderCodexLaunchCancellationMemory(intent, source, now),
            type: 'decision',
            tags: [
              'ridgetopai',
              'squire-dispatch',
              'daytime-control',
              'codex-launcher',
              'launch-cancelled',
              intent.requestId,
            ],
          }, dispatchMandrelOptions(project))
        );

        return {
          handled: true,
          intent,
          confirmation: `Cancelled Codex launch request ${intent.requestId}. No action was executed.`,
        };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return {
      handled: true,
      intent,
      confirmation: `RTA dispatch failed: ${message}`,
      error: message,
    };
  }
}

function extractRtaPayload(text: string): string | null {
  const match = /^\/?rta(?:@\w+)?(?:\s+|$)([\s\S]*)$/i.exec(text.trim());
  return match ? (match[1]?.trim() ?? '') : null;
}

function splitCommand(payload: string): { command: string; rest: string } {
  const trimmed = payload.trim();
  const firstWhitespace = trimmed.search(/\s/);

  if (firstWhitespace === -1) {
    return { command: trimmed.toLowerCase(), rest: '' };
  }

  return {
    command: trimmed.slice(0, firstWhitespace).toLowerCase(),
    rest: trimmed.slice(firstWhitespace).trim(),
  };
}

function parseTaskIntent(payload: string): DaytimeDispatchIntent {
  if (!payload.trim()) {
    return { kind: 'invalid', message: 'Add a task title after the task command.' };
  }

  const { priority, rest } = extractPriority(payload.trim());
  const { primary, secondary } = splitPrimarySecondary(rest);

  if (!primary) {
    return { kind: 'invalid', message: 'Add a task title after the task command.' };
  }

  return {
    kind: 'create_task',
    title: primary,
    description: secondary,
    priority,
  };
}

function parseApprovalIntent(payload: string, decision: ApprovalDecision): DaytimeDispatchIntent {
  const { primary, secondary } = splitPrimarySecondary(payload.trim());

  if (!primary) {
    return { kind: 'invalid', message: `Add what is being ${decision} after the command.` };
  }

  return {
    kind: 'approval',
    decision,
    target: primary,
    reason: secondary,
  };
}

function parseCodexLaunchIntent(payload: string): DaytimeDispatchIntent {
  const { command, rest } = splitCommand(payload);

  if (!command) {
    return { kind: 'invalid', message: 'Add a Codex launcher command after `rta codex`.' };
  }

  if (command === 'prepare' || command === 'queue') {
    return parseCodexLaunchPrepareIntent(rest);
  }

  if (command === 'status' || command === 'list') {
    return { kind: 'codex_launch_status' };
  }

  if (command === 'cancel') {
    return parseCodexLaunchCancelIntent(rest);
  }

  return {
    kind: 'invalid',
    message: `Unknown RTA Codex command: ${command}`,
  };
}

function parseCodexLaunchPrepareIntent(payload: string): DaytimeDispatchIntent {
  const { primary, secondary } = splitPrimarySecondary(payload.trim());

  if (!primary) {
    return { kind: 'invalid', message: 'Add a task id or title after `rta codex prepare`.' };
  }

  return {
    kind: 'codex_launch_prepare',
    taskRef: primary,
    scope: secondary,
  };
}

function parseCodexLaunchCancelIntent(payload: string): DaytimeDispatchIntent {
  const { primary, secondary } = splitPrimarySecondary(payload.trim());

  if (!primary) {
    return { kind: 'invalid', message: 'Add a request id after `rta codex cancel`.' };
  }

  return {
    kind: 'codex_launch_cancel',
    requestId: primary,
    reason: secondary,
  };
}

function extractPriority(payload: string): { priority: TaskPriority; rest: string } {
  const priorityMatch = /^\[(urgent|high|medium|low)\]\s+([\s\S]+)$/i.exec(payload);
  const priority = priorityMatch?.[1]?.toLowerCase();

  if (isTaskPriority(priority)) {
    return {
      priority,
      rest: priorityMatch?.[2]?.trim() ?? '',
    };
  }

  return { priority: 'medium', rest: payload };
}

function isTaskPriority(value: string | undefined): value is TaskPriority {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'urgent';
}

function splitPrimarySecondary(payload: string): { primary: string; secondary?: string } {
  const separatorIndex = payload.indexOf('--');

  if (separatorIndex === -1) {
    return { primary: payload.trim() };
  }

  const primary = payload.slice(0, separatorIndex).trim();
  const secondary = payload.slice(separatorIndex + 2).trim();

  return {
    primary,
    secondary: secondary || undefined,
  };
}

async function createStatusConfirmation(
  project: string,
  createStatusDigest: StatusDigestCreator = createRidgetopAiStatusDigest
): Promise<string> {
  const digest = await createStatusDigest({
    mandrelProject: project,
    mandrelConnectionId: `squire:${CONNECTION_SCOPE}:${project}`,
  });

  return renderStatusConfirmation(digest);
}

async function createDashboardConfirmation(
  project: string,
  createDailyDashboard: DailyDashboardCreator = createRidgetopAiDailyDashboard
): Promise<string> {
  const dashboard = await createDailyDashboard({
    project,
    mandrelConnectionId: `squire:${CONNECTION_SCOPE}:${project}`,
  });

  return renderDailyDashboardConfirmation(dashboard);
}

function renderStatusConfirmation(digest: RidgetopAiStatusDigest): string {
  const counts = countProbeStatuses(digest.probes.map((probe) => probe.status));
  const lines = [
    `RidgetopAI status: ${digest.status.toUpperCase()}`,
    `Checked: ${digest.checkedAt.toISOString()}`,
    `Probes: ${counts.healthy} healthy, ${counts.degraded} degraded, ${counts.unhealthy} unhealthy, ${counts.unknown} unknown`,
  ];

  const notable = digest.probes
    .filter((probe) => probe.status !== 'healthy')
    .slice(0, 3)
    .map((probe) => `- ${probe.name}: ${probe.status} (${truncate(probe.detail, 120)})`);

  if (notable.length > 0) {
    lines.push('', ...notable);
  }

  if (digest.mandrel?.progressSummary) {
    lines.push('', truncate(digest.mandrel.progressSummary, 500));
  }

  return lines.join('\n');
}

function countProbeStatuses(statuses: DigestStatus[]): Record<DigestStatus, number> {
  const counts: Record<DigestStatus, number> = {
    healthy: 0,
    degraded: 0,
    unhealthy: 0,
    unknown: 0,
  };

  for (const status of statuses) {
    counts[status] += 1;
  }

  return counts;
}

async function ensureProject(mandrelCall: MandrelToolCaller, project: string): Promise<void> {
  await requireMandrelSuccess(
    'project_switch',
    await mandrelCall('project_switch', { project }, dispatchMandrelOptions(project))
  );
}

function dispatchMandrelOptions(project: string): MandrelCallOptions {
  return {
    project,
    connectionScope: CONNECTION_SCOPE,
  };
}

async function requireMandrelSuccess(
  toolName: string,
  response: MandrelResponse<unknown>
): Promise<void> {
  if (!response.success) {
    throw new Error(response.error ?? `Mandrel ${toolName} failed`);
  }

  const bridgeBody = response.data as MandrelBridgeBody | undefined;
  if (bridgeBody?.success === false) {
    throw new Error(bridgeBody.error ?? `Mandrel ${toolName} failed`);
  }
}

function renderContextMemory(
  intent: Extract<DaytimeDispatchIntent, { kind: 'store_context' }>,
  source: string,
  now: Date
): string {
  return [
    '## Summary',
    `Daytime ${intent.contextType} context captured through Squire.`,
    '',
    '## Message',
    intent.content,
    '',
    '## Source',
    `Captured from ${source} at ${now.toISOString()}.`,
  ].join('\n');
}

function renderApprovalMemory(
  intent: Extract<DaytimeDispatchIntent, { kind: 'approval' }>,
  source: string,
  now: Date
): string {
  const lines = [
    '## Decision',
    `${intent.target} is ${intent.decision} through Squire daytime dispatch.`,
  ];

  if (intent.reason) {
    lines.push('', '## Reasoning', intent.reason);
  }

  lines.push(
    '',
    '## Consequences',
    'This is an approval signal only. Squire did not execute a destructive action directly.',
    '',
    '## Source',
    `Captured from ${source} at ${now.toISOString()}.`
  );

  return lines.join('\n');
}

function createCodexLaunchRequest(
  intent: Extract<DaytimeDispatchIntent, { kind: 'codex_launch_prepare' }>,
  options: {
    project: string;
    source: string;
    now: Date;
    createRequestId?: () => string;
  }
): CodexLaunchRequest {
  const requestId = options.createRequestId?.() ?? `codex-${crypto.randomUUID()}`;
  const requestedAt = options.now.toISOString();
  const expiresAt = new Date(options.now.getTime() + CODEX_LAUNCH_TTL_MS).toISOString();
  const scopeSummary = intent.scope ?? `Continue ${intent.taskRef} from Mandrel with a narrow, verified work block.`;

  return {
    schemaVersion: 1,
    requestId,
    state: 'queued',
    project: options.project,
    taskId: intent.taskRef,
    title: `Codex launch request for ${intent.taskRef}`,
    requestedBy: options.source,
    requestedAt,
    expiresAt,
    workingDir: CODEX_LAUNCH_WORKING_DIR,
    prompt: [
      `Continue Mandrel task ${intent.taskRef}.`,
      `Scope: ${scopeSummary}`,
      'Use Mandrel MCP directly. Update task state and store completion or handoff context before finishing.',
      'Stop before deploys, service restarts, migrations, destructive cleanup, paid provider changes, DNS changes, or secret changes unless a matching explicit approval is present.',
    ].join('\n'),
    scope: {
      allowedPaths: CODEX_LAUNCH_ALLOWED_PATHS,
      allowedOperations: [
        'read Mandrel task/context state',
        'inspect local files',
        'write scoped docs, reports, tests, or code changes tied to the task',
        'run focused tests and build checks',
        'store Mandrel completion, decision, or handoff context',
      ],
      forbiddenOperations: [
        'database deletion',
        'permanent data deletion',
        'secret rotation',
        'destructive migrations',
        'billing or vendor spend',
        'unapproved deploys or service restarts',
        'unapproved public DNS changes',
      ],
      summary: intent.scope,
    },
    approval: {
      required: true,
      status: 'pending',
      reason: 'Prepared through Squire only. WSL2 launcher must validate a matching approval before execution.',
    },
    execution: {
      sandbox: 'workspace-write',
      maxRuntimeMinutes: 45,
      mode: 'prepare_only',
    },
    stopConditions: [
      'Needed approval is missing, vague, expired, or mismatched.',
      'Requested work expands beyond the stated scope.',
      'A production deploy, service restart, migration, DNS change, secret change, or destructive operation is required.',
      'The working tree contains unrelated changes that would be touched by the task.',
    ],
    requiredFinalization: [
      'Update the Mandrel task status.',
      'Store a Mandrel completion or handoff context.',
      'Create or update a report for substantial work.',
      'Name verification commands and any residual risks.',
    ],
  };
}

function renderCodexLaunchRequestMemory(
  request: CodexLaunchRequest,
  source: string,
  now: Date
): string {
  return [
    '## Summary',
    `Codex launch request ${request.requestId} prepared through Squire.`,
    '',
    '## Request',
    '```json',
    JSON.stringify(request, null, 2),
    '```',
    '',
    '## Safety',
    'This packet is preparation only. Squire did not start Codex, run shell commands, deploy, restart services, or modify files.',
    '',
    '## Source',
    `Captured from ${source} at ${now.toISOString()}.`,
  ].join('\n');
}

function renderCodexLaunchCancellationMemory(
  intent: Extract<DaytimeDispatchIntent, { kind: 'codex_launch_cancel' }>,
  source: string,
  now: Date
): string {
  const lines = [
    '## Decision',
    `Codex launch request ${intent.requestId} is cancelled through Squire daytime dispatch.`,
  ];

  if (intent.reason) {
    lines.push('', '## Reasoning', intent.reason);
  }

  lines.push(
    '',
    '## Consequences',
    'This cancellation record does not start Codex or execute any shell commands.',
    '',
    '## Source',
    `Captured from ${source} at ${now.toISOString()}.`
  );

  return lines.join('\n');
}

function renderCodexLaunchStatusConfirmation(data: unknown): string {
  const text = extractMandrelText(data);

  if (!text) {
    return 'Codex launch status: no recent Mandrel context returned.';
  }

  return [
    'Codex launch status from recent Mandrel context:',
    '',
    truncate(text, 1200),
  ].join('\n');
}

function extractMandrelText(data: unknown): string | undefined {
  if (typeof data === 'string') {
    return data.trim() || undefined;
  }

  if (Array.isArray(data)) {
    return extractTextContent(data);
  }

  if (!isRecord(data)) {
    return undefined;
  }

  const result = data['result'];
  if (isRecord(result)) {
    const resultContent = result['content'];
    if (Array.isArray(resultContent)) {
      return extractTextContent(resultContent);
    }
  }

  const content = data['content'];
  if (Array.isArray(content)) {
    return extractTextContent(content);
  }

  return undefined;
}

function extractTextContent(items: unknown[]): string | undefined {
  const text = items
    .map((item): string | undefined => {
      const content = item as MandrelTextContent;
      return typeof content.text === 'string' ? content.text : undefined;
    })
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join('\n\n')
    .trim();

  return text || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function renderDispatchHelp(): string {
  return [
    'RTA dispatch commands:',
    'rta status',
    'rta dashboard',
    'rta note <context>',
    'rta plan <planning note>',
    'rta task [high] <title> -- <details>',
    'rta approve <target> -- <reason>',
    'rta deny <target> -- <reason>',
    'rta codex prepare <task-or-title> -- <scope>',
    'rta codex status',
    'rta codex cancel <requestId> -- <reason>',
  ].join('\n');
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}
