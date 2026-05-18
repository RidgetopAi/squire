/**
 * Agent: entity_disambiguator
 *
 * Picks which of N existing entity candidates matches a new mention,
 * or returns "NEW" if it's a different person. Caller pre-formats the
 * candidate list + new-mention context into args.input and parses the
 * single-token response ("1", "2", ..., or "NEW").
 */

import { registerAgent } from './registry.js';
import type { AgentDefinition } from './types.js';

const SYSTEM_PROMPT =
  'You disambiguate entity mentions. Respond with only a number or "NEW".';

export const entityDisambiguatorAgent: AgentDefinition = registerAgent({
  id: 'entity_disambiguator',
  label: 'Entity Disambiguator',
  kind: 'single_llm',
  description:
    'Picks a matching existing entity candidate or "NEW". Single-token response.',

  systemPrompt: SYSTEM_PROMPT,
  temperature: 0.1,
  maxTokens: 10,
});
