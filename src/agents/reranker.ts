/**
 * Agent: reranker
 *
 * Yes/no relevance judge used by enhancedRecall. Given a query and a
 * candidate memory, returns "yes" or "no" — caller treats lowercase
 * "yes" prefix as relevant.
 *
 * Args:
 *   args.input -> the prebuilt prompt with query + memory.
 */

import { registerAgent } from './registry.js';
import type { AgentDefinition } from './types.js';

export const rerankerAgent: AgentDefinition = registerAgent({
  id: 'reranker',
  label: 'Memory Reranker',
  kind: 'single_llm',
  description: 'Yes/no LLM judge for memory relevance during recall reranking.',

  runtimeSlot: 'reranker',
  // No system prompt; the user prompt is self-contained "User message: ... Memory: ... yes/no".
});
