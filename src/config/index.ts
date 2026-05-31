import dotenv from 'dotenv';
import { buildAgentModelConfig } from './agent-models.js';
import { squireMasterConfig } from './master.js';

dotenv.config();

export type { LLMProviderName, WorkerRuntimeProvider } from './agent-models.js';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, defaultValue: string): string {
  return process.env[name] ?? defaultValue;
}

const agentModels = buildAgentModelConfig(process.env);

export const config = {
  master: squireMasterConfig,
  agentModels,

  // Auto-detect timezone from system
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,

  database: {
    url: required('DATABASE_URL'),
  },
  server: {
    port: parseInt(optional('PORT', '3000'), 10),
    corsOrigin: optional('CORS_ORIGIN', 'http://localhost:3001'),
  },
  embedding: {
    provider: optional('EMBED_PROVIDER', 'ollama') as 'ollama' | 'groq',
    dimension: parseInt(optional('EMBED_DIMENSION', '768'), 10),
    model: optional('EMBED_MODEL', 'nomic-embed-text'),
    ollamaUrl: optional('OLLAMA_URL', 'http://localhost:11434'),
  },
  llm: {
    provider: agentModels.default.provider,
    model: agentModels.default.model,
    groqApiKey: process.env['GROQ_API_KEY'] ?? '',
    xaiApiKey: process.env['XAI_API_KEY'] ?? '',
    geminiApiKey: process.env['GEMINI_API_KEY'] ?? '',
    anthropicApiKey: process.env['ANTHROPIC_API_KEY'] ?? '',
    openaiApiKey: process.env['OPENAI_API_KEY'] ?? '',
    groqUrl: optional('GROQ_URL', 'https://api.groq.com/openai/v1'),
    xaiUrl: optional('XAI_URL', 'https://api.x.ai/v1'),
    geminiUrl: optional('GEMINI_URL', 'https://generativelanguage.googleapis.com/v1beta/openai'),
    anthropicUrl: optional('ANTHROPIC_URL', 'https://api.anthropic.com'),
    openaiUrl: optional('OPENAI_URL', 'https://api.openai.com/v1'),
    ollamaUrl: optional('OLLAMA_URL', 'http://localhost:11434'),
    maxTokens: parseInt(optional('LLM_MAX_TOKENS', '8192'), 10),
    temperature: parseFloat(optional('LLM_TEMPERATURE', '0.7')),
    apiTimeoutMs: parseInt(optional('LLM_API_TIMEOUT_MS', '60000'), 10),
    openaiStreamServiceTier: optional('OPENAI_STREAM_SERVICE_TIER', ''),
    codexChatTimeoutMs: parseInt(optional('CODEX_CHAT_TIMEOUT_MS', '900000'), 10),
  },
  search: {
    documentThreshold: parseFloat(optional('SEARCH_DOCUMENT_THRESHOLD', '0.55')),
    contextThreshold: parseFloat(optional('SEARCH_CONTEXT_THRESHOLD', '0.5')),
    notesThreshold: parseFloat(optional('SEARCH_NOTES_THRESHOLD', '0.35')),
  },
  telegram: {
    botToken: process.env['TELEGRAM_BOT_TOKEN'] ?? '',
    allowedUserIds: (process.env['TELEGRAM_ALLOWED_USER_IDS'] ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
    pollingIntervalMs: parseInt(optional('TELEGRAM_POLLING_INTERVAL_MS', '1000'), 10),
  },
  coding: {
    workingDirectory: optional('CODING_WORKING_DIR', process.cwd()),
    defaultTimeoutMs: parseInt(optional('CODING_TIMEOUT_MS', '30000'), 10),
    maxOutputBytes: parseInt(optional('CODING_MAX_OUTPUT_BYTES', '1048576'), 10), // 1MB
    blockedCommands: [
      'rm -rf /',
      'rm -rf /*',
      'mkfs',
      'dd if=/dev/zero',
      'dd if=/dev/random',
      ':(){:|:&};:', // fork bomb
      '> /dev/sda',
      'chmod -R 777 /',
      'chown -R',
    ],
  },
  mandrel: {
    baseUrl: optional('MANDREL_URL', 'http://localhost:8080'),
    project: optional('MANDREL_PROJECT', 'squire-agent'),
    connectionScope: optional('MANDREL_CONNECTION_SCOPE', 'runtime'),
  },
  activity: {
    enabled: optional('ACTIVITY_LOGGING_ENABLED', 'true') === 'true',
  },
  routing: {
    enabled: optional('ROUTING_ENABLED', 'true') === 'true',
    defaultTier: optional('ROUTING_DEFAULT_TIER', 'smart') as 'smart' | 'fast',
    smart: agentModels.smart,
    fast: agentModels.fast,
  },
  goalWorker: {
    enabled: optional('GOAL_WORKER_ENABLED', 'true') === 'true',
    intervalMs: parseInt(optional('GOAL_WORKER_INTERVAL_MS', '3600000'), 10), // 1 hour
    maxTurns: parseInt(optional('GOAL_WORKER_MAX_TURNS', '15'), 10),
    maxExecutionMs: parseInt(optional('GOAL_WORKER_MAX_EXECUTION_MS', '300000'), 10), // 5 min
  },
  courier: {
    enabled: optional('COURIER_ENABLED', 'true') === 'true',
    intervalMs: parseInt(optional('COURIER_INTERVAL_MS', '1800000'), 10), // 30 min
    quietHoursStart: parseInt(optional('COURIER_QUIET_START', '22'), 10), // 10pm
    quietHoursEnd: parseInt(optional('COURIER_QUIET_END', '7'), 10), // 7am
    retryAttempts: parseInt(optional('COURIER_RETRY_ATTEMPTS', '3'), 10),
    retryDelayMs: parseInt(optional('COURIER_RETRY_DELAY_MS', '15000'), 10), // 15 sec
  },
  expressionEvaluator: {
    enabled: optional('EXPRESSION_EVALUATOR_ENABLED', 'true') === 'true',
    provider: agentModels.expressionEvaluator.provider,
    model: agentModels.expressionEvaluator.model,
    batchSize: parseInt(optional('EXPRESSION_EVALUATOR_BATCH_SIZE', '10'), 10),
  },
  commune: {
    enabled: optional('COMMUNE_ENABLED', 'true') === 'true',
    intervalMs: parseInt(optional('COMMUNE_INTERVAL_MS', '900000'), 10), // 15 min default
    quietHoursStart: parseInt(optional('COMMUNE_QUIET_START', '22'), 10), // 10pm
    quietHoursEnd: parseInt(optional('COMMUNE_QUIET_END', '7'), 10), // 7am
    maxDailyMessages: parseInt(optional('COMMUNE_MAX_DAILY', '5'), 10),
    minHoursBetweenMessages: parseFloat(optional('COMMUNE_MIN_HOURS_BETWEEN', '2')),
    defaultChannel: optional('COMMUNE_DEFAULT_CHANNEL', 'telegram') as 'telegram' | 'push' | 'email',
  },
  agentmail: {
    apiKey: process.env['AGENTMAIL_API_KEY'] ?? '',
    inboxId: 'squireagent@agentmail.to',
  },
  // Object storage for chat uploads, PDF extractions, generated/edited images.
  // Backed by MinIO on the VPS (single bucket with key prefixes per source).
  // Empty access/secret keys → MediaService throws a clear error at first use
  // rather than blocking boot, so local dev without MinIO still starts.
  media: {
    s3Endpoint: optional('S3_ENDPOINT', 'http://127.0.0.1:9000'),
    s3Bucket: optional('S3_BUCKET', 'media'),
    s3Region: optional('S3_REGION', 'us-east-1'),
    s3AccessKey: process.env['S3_ACCESS_KEY'] ?? '',
    s3SecretKey: process.env['S3_SECRET_KEY'] ?? '',
    // MinIO needs path-style URLs (host/bucket/key); AWS S3 defaults to vhost-style.
    s3ForcePathStyle: optional('S3_FORCE_PATH_STYLE', 'true') === 'true',
    // Base URL the auth proxy serves on — embedded in markdown, chat history, RAG.
    publicUrlBase: optional('MEDIA_PUBLIC_URL_BASE', 'https://squire.ridgetopai.net/media'),
  },
  recall: {
    userStopwords: (process.env['RECALL_USER_STOPWORDS'] ?? '').split(',').filter(Boolean),
    cacheTtlMs: parseInt(optional('RECALL_CACHE_TTL_MS', '300000'), 10),
    rerankerEnabled: optional('RECALL_RERANKER_ENABLED', 'true') === 'true',
    rerankerProvider: agentModels.reranker.provider,
    rerankerModel: agentModels.reranker.model,
    maxRerankerCandidates: parseInt(optional('RECALL_RERANKER_POOL', '15'), 10),
  },
  runtime: {
    llm: {
      socketChat: agentModels.socketChat,
      httpChat: agentModels.httpChat,
      telegram: agentModels.telegram,
      commune: agentModels.commune,
      page: {
        ...agentModels.page,
      },
      scout: {
        ...agentModels.scout,
      },
      emotionalSynthesis: {
        ...agentModels.emotionalSynthesis,
      },
      courierSummarizer: {
        ...agentModels.courierSummarizer,
      },
      vision: {
        ...agentModels.vision,
      },
    },
    worker: {
      coding: agentModels.worker.coding,
      sandbox: agentModels.worker.sandbox,
    },
  },
  security: {
    apiKey: process.env['SQUIRE_API_KEY'] ?? '',
    rateLimitWindowMs: parseInt(optional('RATE_LIMIT_WINDOW_MS', '900000'), 10), // 15 min
    rateLimitMax: parseInt(optional('RATE_LIMIT_MAX', '100'), 10),
    chatRateLimitMax: parseInt(optional('CHAT_RATE_LIMIT_MAX', '20'), 10),
  },
} as const;

export type Config = typeof config;
