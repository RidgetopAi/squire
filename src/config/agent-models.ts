export type LLMProviderName = 'groq' | 'xai' | 'ollama' | 'gemini' | 'anthropic' | 'openai' | 'codex';
export type WorkerRuntimeProvider = 'claude-code' | 'codex';

export interface AgentLLMSlotConfig {
  provider: LLMProviderName;
  model: string;
  maxTokens?: number;
  temperature?: number;
}

export interface AgentWorkerSlotConfig {
  provider: WorkerRuntimeProvider;
  claudeModel: string;
  codexModel: string;
}

export interface AgentModelConfig {
  default: AgentLLMSlotConfig;
  socketChat: AgentLLMSlotConfig;
  httpChat: AgentLLMSlotConfig;
  telegram: AgentLLMSlotConfig;
  commune: AgentLLMSlotConfig;
  smart: AgentLLMSlotConfig;
  fast: AgentLLMSlotConfig;
  reranker: AgentLLMSlotConfig;
  page: AgentLLMSlotConfig;
  scout: AgentLLMSlotConfig;
  emotionalSynthesis: AgentLLMSlotConfig;
  courierSummarizer: AgentLLMSlotConfig;
  vision: AgentLLMSlotConfig;
  expressionEvaluator: AgentLLMSlotConfig;
  worker: {
    coding: AgentWorkerSlotConfig;
    sandbox: AgentWorkerSlotConfig;
  };
}

type Env = NodeJS.ProcessEnv | Record<string, string | undefined>;

interface LLMEnvSpec {
  providerEnv: string[];
  modelEnv: string[];
  defaultProvider: LLMProviderName;
  defaultModel: string;
  maxTokensEnv?: string;
  defaultMaxTokens?: number;
  temperatureEnv?: string;
  defaultTemperature?: number;
}

const CHAT_MODEL = {
  provider: 'xai' as const,
  model: 'grok-4.3',
};

const OPENAI_NANO = {
  provider: 'openai' as const,
  model: 'gpt-5.4-nano',
};

const OPENAI_MINI = {
  provider: 'openai' as const,
  model: 'gpt-5.4-mini',
};

export const AGENT_MODEL_ENV = {
  default: {
    providerEnv: ['LLM_PROVIDER'],
    modelEnv: ['LLM_MODEL'],
    defaultProvider: CHAT_MODEL.provider,
    defaultModel: CHAT_MODEL.model,
  },
  socketChat: {
    providerEnv: ['SQUIRE_SOCKET_CHAT_PROVIDER', 'SQUIRE_CHAT_PROVIDER', 'LLM_PROVIDER'],
    modelEnv: ['SQUIRE_SOCKET_CHAT_MODEL', 'SQUIRE_CHAT_MODEL', 'LLM_MODEL'],
    defaultProvider: CHAT_MODEL.provider,
    defaultModel: CHAT_MODEL.model,
  },
  httpChat: {
    providerEnv: ['SQUIRE_HTTP_CHAT_PROVIDER', 'SQUIRE_CHAT_PROVIDER', 'LLM_PROVIDER'],
    modelEnv: ['SQUIRE_HTTP_CHAT_MODEL', 'SQUIRE_CHAT_MODEL', 'LLM_MODEL'],
    defaultProvider: CHAT_MODEL.provider,
    defaultModel: CHAT_MODEL.model,
  },
  telegram: {
    providerEnv: ['SQUIRE_TELEGRAM_PROVIDER', 'SQUIRE_CHAT_PROVIDER', 'LLM_PROVIDER'],
    modelEnv: ['SQUIRE_TELEGRAM_MODEL', 'SQUIRE_CHAT_MODEL', 'LLM_MODEL'],
    defaultProvider: CHAT_MODEL.provider,
    defaultModel: CHAT_MODEL.model,
  },
  commune: {
    providerEnv: ['SQUIRE_COMMUNE_PROVIDER', 'COMMUNE_AGENT_PROVIDER', 'ROUTING_FAST_PROVIDER'],
    modelEnv: ['SQUIRE_COMMUNE_MODEL', 'COMMUNE_AGENT_MODEL', 'ROUTING_FAST_MODEL'],
    defaultProvider: OPENAI_NANO.provider,
    defaultModel: OPENAI_NANO.model,
  },
  smart: {
    providerEnv: ['ROUTING_SMART_PROVIDER'],
    modelEnv: ['ROUTING_SMART_MODEL'],
    defaultProvider: 'openai' as const,
    defaultModel: 'gpt-5.5',
  },
  fast: {
    providerEnv: ['ROUTING_FAST_PROVIDER'],
    modelEnv: ['ROUTING_FAST_MODEL'],
    defaultProvider: OPENAI_NANO.provider,
    defaultModel: OPENAI_NANO.model,
  },
  reranker: {
    providerEnv: ['RECALL_RERANKER_PROVIDER'],
    modelEnv: ['RECALL_RERANKER_MODEL'],
    defaultProvider: OPENAI_NANO.provider,
    defaultModel: OPENAI_NANO.model,
  },
  page: {
    providerEnv: ['PAGE_AGENT_PROVIDER'],
    modelEnv: ['PAGE_AGENT_MODEL'],
    defaultProvider: OPENAI_MINI.provider,
    defaultModel: OPENAI_MINI.model,
    maxTokensEnv: 'PAGE_AGENT_MAX_TOKENS',
    defaultMaxTokens: 16384,
    temperatureEnv: 'PAGE_AGENT_TEMPERATURE',
    defaultTemperature: 0.3,
  },
  scout: {
    providerEnv: ['SCOUT_AGENT_PROVIDER'],
    modelEnv: ['SCOUT_AGENT_MODEL'],
    defaultProvider: OPENAI_MINI.provider,
    defaultModel: OPENAI_MINI.model,
    maxTokensEnv: 'SCOUT_AGENT_MAX_TOKENS',
    defaultMaxTokens: 16384,
    temperatureEnv: 'SCOUT_AGENT_TEMPERATURE',
    defaultTemperature: 0.3,
  },
  emotionalSynthesis: {
    providerEnv: ['EMOTIONAL_SYNTHESIS_PROVIDER'],
    modelEnv: ['EMOTIONAL_SYNTHESIS_MODEL'],
    defaultProvider: OPENAI_MINI.provider,
    defaultModel: OPENAI_MINI.model,
    maxTokensEnv: 'EMOTIONAL_SYNTHESIS_MAX_TOKENS',
    defaultMaxTokens: 400,
    temperatureEnv: 'EMOTIONAL_SYNTHESIS_TEMPERATURE',
    defaultTemperature: 0.6,
  },
  courierSummarizer: {
    providerEnv: ['COURIER_SUMMARIZER_PROVIDER'],
    modelEnv: ['COURIER_SUMMARIZER_MODEL'],
    defaultProvider: OPENAI_MINI.provider,
    defaultModel: OPENAI_MINI.model,
    maxTokensEnv: 'COURIER_SUMMARIZER_MAX_TOKENS',
    defaultMaxTokens: 1000,
    temperatureEnv: 'COURIER_SUMMARIZER_TEMPERATURE',
    defaultTemperature: 0.3,
  },
  vision: {
    providerEnv: ['VISION_PROVIDER'],
    modelEnv: ['VISION_MODEL'],
    defaultProvider: OPENAI_MINI.provider,
    defaultModel: OPENAI_MINI.model,
  },
  expressionEvaluator: {
    providerEnv: ['EXPRESSION_EVALUATOR_PROVIDER'],
    modelEnv: ['EXPRESSION_EVALUATOR_MODEL'],
    defaultProvider: 'ollama' as const,
    defaultModel: 'qwen2.5:3b',
  },
} satisfies Record<string, LLMEnvSpec>;

function envString(env: Env, names: string[], defaultValue: string): string {
  for (const name of names) {
    const value = env[name];
    if (value && value.trim().length > 0) {
      return value;
    }
  }
  return defaultValue;
}

function envNumber(env: Env, name: string | undefined, defaultValue: number | undefined): number | undefined {
  if (!name || defaultValue === undefined) {
    return undefined;
  }

  const value = env[name];
  if (value === undefined || value.trim().length === 0) {
    return defaultValue;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function llmSlot(env: Env, spec: LLMEnvSpec): AgentLLMSlotConfig {
  const slot: AgentLLMSlotConfig = {
    provider: envString(env, spec.providerEnv, spec.defaultProvider) as LLMProviderName,
    model: envString(env, spec.modelEnv, spec.defaultModel),
  };

  const maxTokens = envNumber(env, spec.maxTokensEnv, spec.defaultMaxTokens);
  const temperature = envNumber(env, spec.temperatureEnv, spec.defaultTemperature);
  if (maxTokens !== undefined) slot.maxTokens = maxTokens;
  if (temperature !== undefined) slot.temperature = temperature;

  return slot;
}

function workerSlot(
  env: Env,
  providerEnv: string,
  claudeModelEnv: string,
  codexModelEnv: string
): AgentWorkerSlotConfig {
  return {
    provider: envString(env, [providerEnv], 'claude-code') as WorkerRuntimeProvider,
    claudeModel: envString(env, [claudeModelEnv], 'sonnet'),
    codexModel: envString(env, [codexModelEnv], 'gpt-5.4'),
  };
}

export function buildAgentModelConfig(env: Env = process.env): AgentModelConfig {
  return {
    default: llmSlot(env, AGENT_MODEL_ENV.default),
    socketChat: llmSlot(env, AGENT_MODEL_ENV.socketChat),
    httpChat: llmSlot(env, AGENT_MODEL_ENV.httpChat),
    telegram: llmSlot(env, AGENT_MODEL_ENV.telegram),
    commune: llmSlot(env, AGENT_MODEL_ENV.commune),
    smart: llmSlot(env, AGENT_MODEL_ENV.smart),
    fast: llmSlot(env, AGENT_MODEL_ENV.fast),
    reranker: llmSlot(env, AGENT_MODEL_ENV.reranker),
    page: llmSlot(env, AGENT_MODEL_ENV.page),
    scout: llmSlot(env, AGENT_MODEL_ENV.scout),
    emotionalSynthesis: llmSlot(env, AGENT_MODEL_ENV.emotionalSynthesis),
    courierSummarizer: llmSlot(env, AGENT_MODEL_ENV.courierSummarizer),
    vision: llmSlot(env, AGENT_MODEL_ENV.vision),
    expressionEvaluator: llmSlot(env, AGENT_MODEL_ENV.expressionEvaluator),
    worker: {
      coding: workerSlot(env, 'CODING_AGENT_PROVIDER', 'CODING_AGENT_CLAUDE_MODEL', 'CODING_AGENT_CODEX_MODEL'),
      sandbox: workerSlot(env, 'SANDBOX_AGENT_PROVIDER', 'SANDBOX_AGENT_CLAUDE_MODEL', 'SANDBOX_AGENT_CODEX_MODEL'),
    },
  };
}
