/**
 * Agent: state_snapshot_narrator
 *
 * Writes a 2-3 sentence narrative summary of how the user seems to be doing,
 * based on a structured affect + open-loops context built by the caller.
 * Free-text output, no JSON.
 */

import { registerAgent } from './registry.js';
import type { AgentDefinition } from './types.js';

const SYSTEM_PROMPT =
  'Write a 2-3 sentence narrative summary of how this person seems to be doing. Write as if you know them well. Use "they" pronouns. Be warm but honest. No bullet points, just flowing prose. Return ONLY the narrative text.';

export const stateSnapshotNarratorAgent: AgentDefinition = registerAgent({
  id: 'state_snapshot_narrator',
  label: 'State Snapshot Narrator',
  kind: 'single_llm',
  description:
    'Writes a 2-3 sentence narrative summary of how the user is doing for a daily/weekly state snapshot.',

  systemPrompt: SYSTEM_PROMPT,
  temperature: 0.6,
  maxTokens: 150,
});
