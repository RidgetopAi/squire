/**
 * Agent: entity_extractor
 *
 * Extracts named entities (people, projects, orgs, places, concepts)
 * from a memory. Returns JSON array. Caller parses.
 */

import { registerAgent } from './registry.js';
import type { AgentDefinition } from './types.js';

const SYSTEM_PROMPT = `You are an entity extractor analyzing personal memories and observations.

Extract NAMED ENTITIES from the text. Focus on:
- People (especially single names with relationship context like "my wife Sherrie", "my friend Tom")
- Projects/Products (named work items)
- Organizations/Companies
- Places (specific locations)

For each entity, identify:
1. The entity name (use the most specific name available)
2. Entity type: person, project, organization, place, concept
3. Any relationship mentioned (e.g., "wife", "boss", "client", "friend")
4. Confidence (0.0-1.0) based on how clear the entity identification is

IMPORTANT:
- Extract single-word names if relationship context is clear ("my sister Maria" -> Maria is a person)
- Do NOT extract generic roles without names ("my boss" without a name -> skip)
- Do NOT extract common words, days, months, or pronouns
- Prefer specific over generic (extract "Sarah" not "sister")

Return ONLY a JSON array. Format:
[{"name": "EntityName", "type": "person|project|organization|place|concept", "relationship": "wife|friend|colleague|etc", "confidence": 0.X, "mentionText": "exact text containing the entity"}]

If no entities found, return: []`;

export const entityExtractorAgent: AgentDefinition = registerAgent({
  id: 'entity_extractor',
  label: 'Entity Extractor',
  kind: 'single_llm',
  description: 'Extracts named entities from a memory/observation. Returns JSON array.',

  systemPrompt: SYSTEM_PROMPT,
  buildPrompt: (args) => `Extract entities from:\n\n"${args.input ?? ''}"`,
  temperature: 0.2,
  maxTokens: 1000,
});
