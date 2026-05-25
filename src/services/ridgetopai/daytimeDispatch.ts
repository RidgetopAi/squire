import {
  createRidgetopAiStatusDigest,
  type DigestStatus,
  type RidgetopAiStatusDigest,
  type StatusDigestOptions,
} from './statusDigest.js';
import {
  callMandrelTool,
  type MandrelCallOptions,
  type MandrelResponse,
} from '../mandrel/index.js';

const RTA_PROJECT = 'ridgetopai';
const CONNECTION_SCOPE = 'daytime-dispatch';

type ContextType = 'discussion' | 'planning' | 'decision';
type ApprovalDecision = 'approved' | 'denied';
type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export type DaytimeDispatchIntent =
  | { kind: 'status_request' }
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

export interface DaytimeDispatchOptions {
  mandrelCall?: MandrelToolCaller;
  createStatusDigest?: StatusDigestCreator;
  now?: Date;
  project?: string;
  source?: string;
}

interface MandrelBridgeBody {
  success?: boolean;
  error?: string;
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

    switch (intent.kind) {
      case 'status_request':
        return {
          handled: true,
          intent,
          confirmation: await createStatusConfirmation(project, options.createStatusDigest),
        };
      case 'store_context':
        await ensureProject(mandrelCall, project);
        await requireMandrelSuccess(
          'context_store',
          await mandrelCall('context_store', {
            content: renderContextMemory(intent, source, options.now ?? new Date()),
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
            content: renderApprovalMemory(intent, source, options.now ?? new Date()),
            type: 'decision',
            tags: ['ridgetopai', 'squire-dispatch', 'daytime-control', 'approval', intent.decision],
          }, dispatchMandrelOptions(project))
        );

        return {
          handled: true,
          intent,
          confirmation: `Captured ${intent.decision} signal for ${intent.target}. No action was executed.`,
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

function renderDispatchHelp(): string {
  return [
    'RTA dispatch commands:',
    'rta status',
    'rta note <context>',
    'rta plan <planning note>',
    'rta task [high] <title> -- <details>',
    'rta approve <target> -- <reason>',
    'rta deny <target> -- <reason>',
  ].join('\n');
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}
