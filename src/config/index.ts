import dotenv from 'dotenv';

dotenv.config();

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

export const config = {
  // Auto-detect timezone from system
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,

  database: {
    url: required('DATABASE_URL'),
  },
  server: {
    port: parseInt(optional('PORT', '3000'), 10),
    nodeEnv: optional('NODE_ENV', 'development'),
    corsOrigin: optional('CORS_ORIGIN', 'http://localhost:3001'),
  },
  embedding: {
    provider: optional('EMBED_PROVIDER', 'ollama') as 'ollama' | 'groq',
    dimension: parseInt(optional('EMBED_DIMENSION', '768'), 10),
    model: optional('EMBED_MODEL', 'nomic-embed-text'),
    ollamaUrl: optional('OLLAMA_URL', 'http://localhost:11434'),
  },
  llm: {
    provider: optional('LLM_PROVIDER', 'groq') as 'groq' | 'xai' | 'ollama' | 'gemini',
    model: optional('LLM_MODEL', 'llama-3.3-70b-versatile'),
    groqApiKey: process.env['GROQ_API_KEY'] ?? '',
    xaiApiKey: process.env['XAI_API_KEY'] ?? '',
    geminiApiKey: process.env['GEMINI_API_KEY'] ?? '',
    groqUrl: optional('GROQ_URL', 'https://api.groq.com/openai/v1'),
    xaiUrl: optional('XAI_URL', 'https://api.x.ai/v1'),
    geminiUrl: optional('GEMINI_URL', 'https://generativelanguage.googleapis.com/v1beta/openai'),
    ollamaUrl: optional('OLLAMA_URL', 'http://localhost:11434'),
    maxTokens: parseInt(optional('LLM_MAX_TOKENS', '4096'), 10),
    temperature: parseFloat(optional('LLM_TEMPERATURE', '0.7')),
    apiTimeoutMs: parseInt(optional('LLM_API_TIMEOUT_MS', '30000'), 10),
  },
  features: {
    emotionTagging: optional('ENABLE_EMOTION_TAGGING', 'false') === 'true',
  },
  search: {
    documentThreshold: parseFloat(optional('SEARCH_DOCUMENT_THRESHOLD', '0.55')),
    contextThreshold: parseFloat(optional('SEARCH_CONTEXT_THRESHOLD', '0.5')),
    notesThreshold: parseFloat(optional('SEARCH_NOTES_THRESHOLD', '0.35')),
  },
} as const;

export type Config = typeof config;
