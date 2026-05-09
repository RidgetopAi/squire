/**
 * Runtime Registry
 *
 * Named runtime slots for Squire's model and worker choices. This keeps
 * provider/model decisions centralized without changing the existing call paths.
 */

import { config, type LLMProviderName, type WorkerRuntimeProvider } from '../../config/index.js';

export type LLMRuntimeId =
  | 'smart'
  | 'fast'
  | 'reranker'
  | 'page'
  | 'scout'
  | 'emotional-synthesis'
  | 'courier-summarizer'
  | 'vision';

export interface LLMRuntimeConfig {
  provider: LLMProviderName;
  model: string;
  maxTokens?: number;
  temperature?: number;
}

export type WorkerRuntimeId = 'coding' | 'sandbox';

export interface WorkerRuntimeConfig {
  provider: WorkerRuntimeProvider;
  claudeModel: string;
  codexModel: string;
}

export function getLLMRuntime(id: LLMRuntimeId): LLMRuntimeConfig {
  switch (id) {
    case 'smart':
      return config.routing.smart;
    case 'fast':
      return config.routing.fast;
    case 'reranker':
      return {
        provider: config.recall.rerankerProvider,
        model: config.recall.rerankerModel,
        maxTokens: 10,
        temperature: 0,
      };
    case 'page':
      return config.runtime.llm.page;
    case 'scout':
      return config.runtime.llm.scout;
    case 'emotional-synthesis':
      return config.runtime.llm.emotionalSynthesis;
    case 'courier-summarizer':
      return config.runtime.llm.courierSummarizer;
    case 'vision':
      return config.runtime.llm.vision;
  }
}

export function getWorkerRuntime(id: WorkerRuntimeId): WorkerRuntimeConfig {
  return config.runtime.worker[id];
}

export function getWorkerModel(id: WorkerRuntimeId, requestedModel?: string): string {
  const runtime = getWorkerRuntime(id);
  if (requestedModel) return requestedModel;
  return runtime.provider === 'codex' ? runtime.codexModel : runtime.claudeModel;
}
