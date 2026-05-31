import { buildAgentModelConfig } from './agent-models.js';

export type ConfigMode = 'public-core' | 'private';
export type CapabilityVisibility = 'public' | 'private';
export type ConnectorId = 'mandrel' | 'telegram' | 'google' | 'agentmail' | 'object_storage';
export type ActionGuardrailPolicy = 'allow' | 'deny' | 'draft' | 'require_approval';
export type GuardedAction =
  | 'external.telegram_send'
  | 'external.email_send'
  | 'delete.email_trash'
  | 'delete.permanent';
export type LoopId =
  | 'socket_chat'
  | 'http_chat'
  | 'telegram'
  | 'goal_worker'
  | 'courier'
  | 'commune'
  | 'page'
  | 'scout'
  | 'worker_agent'
  | 'sandbox_worker'
  | 'codex_chat';
export type MandrelTransportPolicy = 'mcp' | 'http-bridge';
export type ToolPolicy = 'allow_registered' | 'allow_list' | 'deny_all';

export interface CapabilityConfig {
  enabled: boolean;
  visibility: CapabilityVisibility;
  tags: string[];
}

export interface ConnectorConfig {
  enabled: boolean;
  requiredSecrets: string[];
  visibility: CapabilityVisibility;
}

export interface ProviderSlotConfig {
  provider: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
}

export interface WorkerSlotConfig {
  provider: string;
  claudeModel: string;
  codexModel: string;
}

export interface LoopConfig {
  enabled: boolean;
  runtime?: string;
  schedule?: {
    intervalMs?: number;
    quietHoursStart?: number;
    quietHoursEnd?: number;
  };
  allowedCapabilities: string[];
  allowedTools: string[];
  externalEffects: string[];
  audit: {
    traceActivity: boolean;
    retentionDays: number;
  };
}

export interface SquireMasterConfig {
  version: 1;
  mode: ConfigMode;
  capabilities: Record<string, CapabilityConfig>;
  connectors: Record<ConnectorId, ConnectorConfig>;
  providers: {
    llm: {
      default: ProviderSlotConfig;
      slots: Record<string, ProviderSlotConfig>;
    };
    worker: Record<string, WorkerSlotConfig>;
  };
  loops: Record<LoopId, LoopConfig>;
  mandrel: {
    project: string;
    transport: MandrelTransportPolicy;
    requireStableConnectionId: boolean;
    allowHttpFallback: boolean;
  };
  audit: {
    activityLoggingEnabled: boolean;
    retentionDays: number;
  };
  permissions: {
    defaultToolPolicy: ToolPolicy;
    externalEffectsRequireAudit: boolean;
    loopPolicies: Record<LoopId, ToolPolicy>;
    actionGuardrails: {
      defaultPolicy: ActionGuardrailPolicy;
      loopActionPolicies: Partial<Record<LoopId, Partial<Record<GuardedAction, ActionGuardrailPolicy>>>>;
      toolPolicies: Record<string, ActionGuardrailPolicy>;
    };
  };
  visibility: {
    publicCapabilities: string[];
    privateCapabilities: string[];
  };
}

const CORE_CAPABILITIES = [
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

const PRIVATE_CAPABILITIES = [
  'squire_email',
  'dealer_foundation',
] as const;

function envString(env: NodeJS.ProcessEnv, name: string, defaultValue: string): string {
  return env[name] ?? defaultValue;
}

function envBoolean(env: NodeJS.ProcessEnv, name: string, defaultValue: boolean): boolean {
  const value = env[name];
  if (value === undefined) return defaultValue;
  return value === 'true' || value === '1';
}

function envNumber(env: NodeJS.ProcessEnv, name: string, defaultValue: number): number {
  const value = env[name];
  if (value === undefined) return defaultValue;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function envList(env: NodeJS.ProcessEnv, name: string): string[] {
  return (env[name] ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function parseGuardrailPolicy(value: string | undefined, fallback: ActionGuardrailPolicy): ActionGuardrailPolicy {
  switch (value) {
    case 'allow':
    case 'deny':
    case 'draft':
    case 'require_approval':
      return value;
    default:
      return fallback;
  }
}

function parseToolGuardrailPolicies(env: NodeJS.ProcessEnv): Record<string, ActionGuardrailPolicy> {
  const policies: Record<string, ActionGuardrailPolicy> = {};
  for (const entry of envList(env, 'SQUIRE_TOOL_GUARDRAILS')) {
    const [toolName, policy] = entry.split(':').map((part) => part.trim());
    if (!toolName) {
      continue;
    }
    policies[toolName] = parseGuardrailPolicy(policy, 'allow');
  }
  return policies;
}

function isLoopId(value: string): value is LoopId {
  return [
    'socket_chat',
    'http_chat',
    'telegram',
    'goal_worker',
    'courier',
    'commune',
    'page',
    'scout',
    'worker_agent',
    'sandbox_worker',
    'codex_chat',
  ].includes(value);
}

function isGuardedAction(value: string): value is GuardedAction {
  return [
    'external.telegram_send',
    'external.email_send',
    'delete.email_trash',
    'delete.permanent',
  ].includes(value);
}

function parseLoopActionGuardrails(
  env: NodeJS.ProcessEnv
): Partial<Record<LoopId, Partial<Record<GuardedAction, ActionGuardrailPolicy>>>> {
  const policies: Partial<Record<LoopId, Partial<Record<GuardedAction, ActionGuardrailPolicy>>>> = {};
  for (const entry of envList(env, 'SQUIRE_LOOP_ACTION_GUARDRAILS')) {
    const [selector, policy] = entry.split(':').map((part) => part.trim());
    if (!selector) {
      continue;
    }

    const [loopId, ...actionParts] = selector.split('.');
    const action = actionParts.join('.');
    if (!loopId || !isLoopId(loopId) || !isGuardedAction(action)) {
      continue;
    }

    policies[loopId] ??= {};
    policies[loopId][action] = parseGuardrailPolicy(policy, 'allow');
  }
  return policies;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function buildCapabilities(env: NodeJS.ProcessEnv): Record<string, CapabilityConfig> {
  const publicOverrides = new Set(envList(env, 'SQUIRE_PUBLIC_CAPABILITIES'));
  const privateOverrides = new Set(envList(env, 'SQUIRE_PRIVATE_CAPABILITIES'));
  const enabledOnly = new Set(envList(env, 'SQUIRE_CAPABILITIES_ENABLED'));
  const disabled = new Set(envList(env, 'SQUIRE_CAPABILITIES_DISABLED'));
  const privateDefaults = new Set<string>(PRIVATE_CAPABILITIES);
  const capabilityNames = unique([
    ...CORE_CAPABILITIES,
    ...PRIVATE_CAPABILITIES,
    ...publicOverrides,
    ...privateOverrides,
    ...enabledOnly,
    ...disabled,
  ]);

  const capabilities: Record<string, CapabilityConfig> = {};
  for (const name of capabilityNames) {
    const visibility = privateOverrides.has(name) || (privateDefaults.has(name) && !publicOverrides.has(name))
      ? 'private'
      : 'public';
    const enabled = enabledOnly.size > 0 ? enabledOnly.has(name) : !disabled.has(name);
    capabilities[name] = {
      enabled,
      visibility,
      tags: visibility === 'private' ? ['private'] : ['core'],
    };
  }

  return capabilities;
}

function enabledCapabilityNames(capabilities: Record<string, CapabilityConfig>): string[] {
  return Object.entries(capabilities)
    .filter(([, capability]) => capability.enabled)
    .map(([name]) => name);
}

export function buildSquireMasterConfig(env: NodeJS.ProcessEnv = process.env): SquireMasterConfig {
  const capabilities = buildCapabilities(env);
  const allEnabledCapabilities = enabledCapabilityNames(capabilities);
  const agentLoopCapabilities = allEnabledCapabilities.filter((name) => name !== 'browser');
  const auditRetentionDays = envNumber(env, 'ACTIVITY_RETENTION_DAYS', 90);
  const agentModels = buildAgentModelConfig(env);

  return {
    version: 1,
    mode: envString(env, 'SQUIRE_CONFIG_MODE', 'private') as ConfigMode,
    capabilities,
    connectors: {
      mandrel: {
        enabled: envBoolean(env, 'MANDREL_ENABLED', true),
        requiredSecrets: [],
        visibility: 'public',
      },
      telegram: {
        enabled: envBoolean(env, 'TELEGRAM_ENABLED', true),
        requiredSecrets: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_ALLOWED_USER_IDS'],
        visibility: 'private',
      },
      google: {
        enabled: envBoolean(env, 'GOOGLE_ENABLED', true),
        requiredSecrets: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
        visibility: 'private',
      },
      agentmail: {
        enabled: envBoolean(env, 'AGENTMAIL_ENABLED', true),
        requiredSecrets: ['AGENTMAIL_API_KEY'],
        visibility: 'private',
      },
      object_storage: {
        enabled: true,
        requiredSecrets: [],
        visibility: 'public',
      },
    },
    providers: {
      llm: {
        default: {
          provider: agentModels.default.provider,
          model: agentModels.default.model,
          maxTokens: envNumber(env, 'LLM_MAX_TOKENS', 8192),
          temperature: envNumber(env, 'LLM_TEMPERATURE', 0.7),
        },
        slots: {
          socket_chat: agentModels.socketChat,
          http_chat: agentModels.httpChat,
          telegram: agentModels.telegram,
          commune: agentModels.commune,
          smart: {
            provider: agentModels.smart.provider,
            model: agentModels.smart.model,
          },
          fast: {
            provider: agentModels.fast.provider,
            model: agentModels.fast.model,
          },
          page: {
            ...agentModels.page,
          },
          scout: {
            ...agentModels.scout,
          },
          vision: {
            ...agentModels.vision,
          },
        },
      },
      worker: {
        coding: agentModels.worker.coding,
        sandbox: agentModels.worker.sandbox,
      },
    },
    loops: {
      socket_chat: {
        enabled: true,
        runtime: 'socket_chat',
        allowedCapabilities: allEnabledCapabilities,
        allowedTools: ['*'],
        externalEffects: ['tool_calls'],
        audit: { traceActivity: true, retentionDays: auditRetentionDays },
      },
      http_chat: {
        enabled: true,
        runtime: 'http_chat',
        allowedCapabilities: allEnabledCapabilities,
        allowedTools: ['*'],
        externalEffects: ['tool_calls'],
        audit: { traceActivity: true, retentionDays: auditRetentionDays },
      },
      telegram: {
        enabled: envBoolean(env, 'TELEGRAM_ENABLED', true),
        runtime: 'telegram',
        allowedCapabilities: agentLoopCapabilities,
        allowedTools: ['*'],
        externalEffects: ['telegram_send', 'tool_calls'],
        audit: { traceActivity: true, retentionDays: auditRetentionDays },
      },
      goal_worker: {
        enabled: envBoolean(env, 'GOAL_WORKER_ENABLED', true),
        runtime: 'smart',
        schedule: {
          intervalMs: envNumber(env, 'GOAL_WORKER_INTERVAL_MS', 3600000),
        },
        allowedCapabilities: agentLoopCapabilities,
        allowedTools: ['*'],
        externalEffects: ['telegram_send', 'mandrel_call', 'tool_calls'],
        audit: { traceActivity: true, retentionDays: auditRetentionDays },
      },
      courier: {
        enabled: envBoolean(env, 'COURIER_ENABLED', true),
        runtime: 'courier-summarizer',
        schedule: {
          intervalMs: envNumber(env, 'COURIER_INTERVAL_MS', 1800000),
          quietHoursStart: envNumber(env, 'COURIER_QUIET_START', 22),
          quietHoursEnd: envNumber(env, 'COURIER_QUIET_END', 7),
        },
        allowedCapabilities: ['email', 'squire_email', 'calendar', 'reminders', 'commitments'],
        allowedTools: ['*'],
        externalEffects: ['telegram_send', 'email_read'],
        audit: { traceActivity: true, retentionDays: auditRetentionDays },
      },
      commune: {
        enabled: envBoolean(env, 'COMMUNE_ENABLED', true),
        runtime: 'commune',
        schedule: {
          intervalMs: envNumber(env, 'COMMUNE_INTERVAL_MS', 900000),
          quietHoursStart: envNumber(env, 'COMMUNE_QUIET_START', 22),
          quietHoursEnd: envNumber(env, 'COMMUNE_QUIET_END', 7),
        },
        allowedCapabilities: agentLoopCapabilities,
        allowedTools: ['commune_send', '*'],
        externalEffects: ['telegram_send', 'tool_calls'],
        audit: { traceActivity: true, retentionDays: auditRetentionDays },
      },
      page: {
        enabled: envBoolean(env, 'PAGE_AGENT_ENABLED', true),
        runtime: 'page',
        allowedCapabilities: ['page'],
        allowedTools: ['read_file', 'grep_search', 'glob_files', 'bash_read'],
        externalEffects: ['read_only_file_access'],
        audit: { traceActivity: true, retentionDays: auditRetentionDays },
      },
      scout: {
        enabled: envBoolean(env, 'SCOUT_AGENT_ENABLED', true),
        runtime: 'scout',
        allowedCapabilities: ['scout'],
        allowedTools: ['read_file', 'grep_search', 'glob_files', 'bash_read'],
        externalEffects: ['read_only_file_access'],
        audit: { traceActivity: true, retentionDays: auditRetentionDays },
      },
      worker_agent: {
        enabled: envBoolean(env, 'WORKER_AGENT_ENABLED', true),
        runtime: 'coding',
        allowedCapabilities: ['coding'],
        allowedTools: [],
        externalEffects: ['filesystem_write', 'shell_exec', 'git_operations'],
        audit: { traceActivity: true, retentionDays: auditRetentionDays },
      },
      sandbox_worker: {
        enabled: envBoolean(env, 'SANDBOX_WORKER_ENABLED', true),
        runtime: 'sandbox',
        allowedCapabilities: ['sandbox'],
        allowedTools: [],
        externalEffects: ['sandbox_filesystem_write', 'shell_exec'],
        audit: { traceActivity: true, retentionDays: auditRetentionDays },
      },
      codex_chat: {
        enabled: envBoolean(env, 'CODEX_CHAT_ENABLED', true),
        runtime: 'smart',
        allowedCapabilities: allEnabledCapabilities,
        allowedTools: ['*'],
        externalEffects: ['tool_calls'],
        audit: { traceActivity: true, retentionDays: auditRetentionDays },
      },
    },
    mandrel: {
      project: envString(env, 'MANDREL_PROJECT', 'squire-agent'),
      transport: envString(env, 'MANDREL_TRANSPORT', 'http-bridge') as MandrelTransportPolicy,
      requireStableConnectionId: envBoolean(env, 'MANDREL_REQUIRE_STABLE_CONNECTION_ID', true),
      allowHttpFallback: envBoolean(env, 'MANDREL_ALLOW_HTTP_FALLBACK', false),
    },
    audit: {
      activityLoggingEnabled: envBoolean(env, 'ACTIVITY_LOGGING_ENABLED', true),
      retentionDays: auditRetentionDays,
    },
    permissions: {
      defaultToolPolicy: envString(env, 'SQUIRE_DEFAULT_TOOL_POLICY', 'allow_registered') as ToolPolicy,
      externalEffectsRequireAudit: true,
      loopPolicies: {
        socket_chat: 'allow_registered',
        http_chat: 'allow_registered',
        telegram: 'allow_registered',
        goal_worker: 'allow_registered',
        courier: 'allow_list',
        commune: 'allow_registered',
        page: 'allow_list',
        scout: 'allow_list',
        worker_agent: 'allow_registered',
        sandbox_worker: 'allow_registered',
        codex_chat: 'allow_registered',
      },
      actionGuardrails: {
        defaultPolicy: parseGuardrailPolicy(env.SQUIRE_ACTION_GUARDRAIL_DEFAULT, 'allow'),
        loopActionPolicies: parseLoopActionGuardrails(env),
        toolPolicies: parseToolGuardrailPolicies(env),
      },
    },
    visibility: {
      publicCapabilities: Object.entries(capabilities)
        .filter(([, capability]) => capability.visibility === 'public')
        .map(([name]) => name),
      privateCapabilities: Object.entries(capabilities)
        .filter(([, capability]) => capability.visibility === 'private')
        .map(([name]) => name),
    },
  };
}

export const squireMasterConfig = buildSquireMasterConfig();
