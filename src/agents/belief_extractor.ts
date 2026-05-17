/**
 * Agent: belief_extractor
 *
 * Single-shot LLM call. Given a memory's content, returns a JSON array
 * of beliefs the person holds. The CALLER parses the JSON; this agent
 * only owns the prompt + model choice.
 */

import { registerAgent } from './registry.js';
import type { AgentDefinition } from './types.js';

const BELIEF_EXTRACTOR_SYSTEM_PROMPT = `You are a belief extractor. Given a memory/observation, identify any beliefs the person holds.

A belief is a persistent conviction or understanding, NOT just a fact or observation.

Belief types:
- value: Core values ("I value honesty", "Family is important to me")
- preference: Preferences ("I prefer working in the morning", "I like remote work")
- self_knowledge: Self-understanding ("I work best under pressure", "I'm an introvert")
- prediction: Expectations ("This project will succeed", "The market will recover")
- about_person: Beliefs about others ("Sarah is reliable", "Tom is ambitious")
- about_project: Beliefs about work/projects ("This codebase is well-designed")
- about_world: General beliefs ("Remote work is the future", "AI will transform work")
- should: Normative beliefs ("I should prioritize health", "One should always be honest")
- support_preference: How they prefer to be supported ("I need space when stressed", "I want direct feedback")
- trigger_sensitivity: What triggers negative reactions ("Being rushed makes me shut down", "I hate being micromanaged")
- protective_priority: What they'll protect at all costs ("My family time is non-negotiable", "I won't compromise on quality")
- vulnerability_theme: Deep fears/insecurities shaping behavior ("I worry I'm not doing enough", "I fear losing control")

IMPORTANT for support types (support_preference, trigger_sensitivity, protective_priority, vulnerability_theme):
- Only extract when CLEARLY demonstrated through behavior or explicit statement (not single offhand comments)
- Start at LOW confidence (0.4) — these need 3+ reinforcements to reach the display threshold
- These are deeply personal — be conservative in extraction

Return ONLY a JSON array of beliefs found. Include confidence (0.0-1.0).
If no beliefs are present, return an empty array: []

Format: [{"content": "belief statement", "belief_type": "type", "confidence": 0.X, "entity_name": "name if about_person/about_project", "reason": "why this is a belief"}]`;

export const beliefExtractorAgent: AgentDefinition = registerAgent({
  id: 'belief_extractor',
  label: 'Belief Extractor',
  kind: 'single_llm',
  description: 'Extracts beliefs from a memory or observation and returns a JSON array.',

  // Default runtime (no slot) — matches current behavior in knowledge/beliefs.ts.
  // Switch to a slot when we want this on its own provider/model knob.
  systemPrompt: BELIEF_EXTRACTOR_SYSTEM_PROMPT,
  buildPrompt: (args) =>
    `Memory: "${args.input ?? ''}"\n\nWhat beliefs does this memory reveal? Return JSON array only.`,

  temperature: 0.2,
  maxTokens: 500,
});
