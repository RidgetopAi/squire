import type { CapabilityVisibility } from './capabilityRegistry.js';

export type CapabilityPackage = 'core' | 'private-business';
export type CapabilityName =
  | typeof publicCoreCapabilityNames[number]
  | typeof privateBusinessCapabilityNames[number];

export interface CapabilityBoundary {
  visibility: CapabilityVisibility;
  package: CapabilityPackage;
}

export interface CapabilityManifest extends CapabilityBoundary {
  name: CapabilityName;
  tags: string[];
  routes?: string[];
  schedulerTasks?: string[];
  runtimeLoops?: string[];
  connectors?: string[];
  providers?: string[];
  lifecycleHooks?: string[];
  promptGuidance?: string;
  permissions?: {
    externalEffects?: string[];
    guardedActions?: string[];
  };
}

export const publicCoreCapabilityNames = [
  'time',
  'notes',
  'lists',
  'trackers',
  'calendar',
  'commitments',
  'reminders',
  'coding',
  'steward',
  'mandrel',
  'memory',
  'email',
  'search',
  'scratchpad',
  'commune',
  'images',
  'report',
  'page',
  'goals',
  'continuity',
  'pdf',
  'scout',
  'sandbox',
  'jobs',
  'browser',
] as const;

export const privateBusinessCapabilityNames = [
  'squire_email',
  'dealer_foundation',
] as const;

export const capabilityBoundaries: Record<string, CapabilityBoundary> = {
  ...Object.fromEntries(
    publicCoreCapabilityNames.map((name) => [
      name,
      { visibility: 'public', package: 'core' } satisfies CapabilityBoundary,
    ])
  ),
  ...Object.fromEntries(
    privateBusinessCapabilityNames.map((name) => [
      name,
      { visibility: 'private', package: 'private-business' } satisfies CapabilityBoundary,
    ])
  ),
};

const manifestOverrides: Partial<Record<CapabilityName, Partial<CapabilityManifest>>> = {
  calendar: {
    routes: ['/api/calendar', '/api/integrations/google'],
    connectors: ['google'],
    runtimeLoops: ['socket_chat', 'http_chat', 'telegram', 'courier'],
    permissions: { externalEffects: ['google_calendar_read', 'google_calendar_write'] },
    promptGuidance: 'Use for calendar queries and event lifecycle mutations.',
  },
  email: {
    routes: ['/api/tools/history'],
    connectors: ['google'],
    runtimeLoops: ['socket_chat', 'http_chat', 'telegram', 'courier'],
    permissions: {
      externalEffects: ['email_read', 'email_send', 'email_delete'],
      guardedActions: ['external.email_send', 'delete.email_trash'],
    },
    promptGuidance: 'Use for Gmail-backed email read, search, send, archive, and delete operations.',
  },
  squire_email: {
    connectors: ['agentmail'],
    runtimeLoops: ['socket_chat', 'http_chat', 'telegram'],
    permissions: {
      externalEffects: ['email_read', 'email_send'],
      guardedActions: ['external.email_send'],
    },
    promptGuidance: 'Use only for the Squire/RidgetopAI AgentMail account.',
  },
  commune: {
    schedulerTasks: ['commune'],
    runtimeLoops: ['commune'],
    connectors: ['telegram'],
    permissions: {
      externalEffects: ['telegram_send'],
      guardedActions: ['external.telegram_send'],
    },
    promptGuidance: 'Use for intentional outbound Telegram contact from the commune loop.',
  },
  goals: {
    schedulerTasks: ['goal-worker'],
    runtimeLoops: ['goal_worker', 'socket_chat', 'http_chat', 'telegram'],
    connectors: ['mandrel', 'telegram'],
    permissions: { externalEffects: ['mandrel_call', 'telegram_send'] },
    promptGuidance: 'Use for Squire goal tracking and background goal-worker progress.',
  },
  mandrel: {
    connectors: ['mandrel'],
    runtimeLoops: ['socket_chat', 'http_chat', 'telegram', 'goal_worker', 'commune', 'codex_chat'],
    permissions: { externalEffects: ['mandrel_call'] },
    promptGuidance: 'Use for durable project memory, tasks, decisions, and cross-session context.',
  },
  coding: {
    runtimeLoops: ['worker_agent', 'codex_chat'],
    providers: ['claude-code', 'codex'],
    permissions: { externalEffects: ['filesystem_write', 'shell_exec', 'git_operations'] },
    promptGuidance: 'Use for codebase read/write work through explicit coding tool policy.',
  },
  sandbox: {
    runtimeLoops: ['sandbox_worker'],
    providers: ['claude-code', 'codex'],
    permissions: { externalEffects: ['sandbox_filesystem_write', 'shell_exec'] },
    promptGuidance: 'Use for isolated experimental worker execution.',
  },
  page: {
    runtimeLoops: ['page', 'scout'],
    lifecycleHooks: ['scout-agent'],
    permissions: { externalEffects: ['read_only_file_access'] },
    promptGuidance: 'Legacy alias for Scout read-only investigations.',
  },
  scout: {
    runtimeLoops: ['scout'],
    lifecycleHooks: ['scout-agent'],
    permissions: { externalEffects: ['read_only_file_access'] },
    promptGuidance: 'Use for read-only scout investigations.',
  },
  browser: {
    runtimeLoops: ['socket_chat', 'http_chat', 'codex_chat'],
    lifecycleHooks: ['browser-session'],
    permissions: { externalEffects: ['browser_automation'] },
    promptGuidance: 'Use for browser automation when an interactive web page must be inspected or manipulated.',
  },
  images: {
    connectors: ['object_storage'],
    providers: ['vision'],
    permissions: { externalEffects: ['object_storage_read'] },
    promptGuidance: 'Use for analyzing uploaded images and listing stored image objects.',
  },
  pdf: {
    connectors: ['object_storage', 'google'],
    permissions: {
      externalEffects: ['object_storage_read', 'email_send'],
      guardedActions: ['external.email_send'],
    },
    promptGuidance: 'Use for PDF field inspection and fill-and-email workflows.',
  },
  dealer_foundation: {
    routes: ['/api/tools/history'],
    connectors: ['google'],
    permissions: { externalEffects: ['private_business_data_write'] },
    promptGuidance: 'Use only for Brian-specific dealer foundation, campaign, and sales-report work.',
  },
};

function buildCapabilityManifest(name: CapabilityName): CapabilityManifest {
  const boundary = capabilityBoundaries[name] ?? { visibility: 'public', package: 'core' };
  return {
    name,
    visibility: boundary.visibility,
    package: boundary.package,
    tags: boundary.package === 'private-business' ? ['private-business'] : ['core'],
    ...(manifestOverrides[name] ?? {}),
  };
}

export const capabilityManifests: Record<CapabilityName, CapabilityManifest> = Object.fromEntries(
  [...publicCoreCapabilityNames, ...privateBusinessCapabilityNames].map((name) => [
    name,
    buildCapabilityManifest(name),
  ])
) as Record<CapabilityName, CapabilityManifest>;

export const publicCoreCapabilityManifests = publicCoreCapabilityNames.map((name) => capabilityManifests[name]);
export const privateBusinessCapabilityManifests = privateBusinessCapabilityNames.map((name) => capabilityManifests[name]);
