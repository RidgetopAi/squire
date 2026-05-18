/**
 * Agent: expression_evaluator
 *
 * Pre-evaluates memories for expression safety using a local model
 * (default ollama qwen2.5:3b via the expression-evaluator runtime slot).
 * Caller batches gray-zone memories, formats them as a JSON array in
 * args.input, and parses the JSON-array verdict response.
 */

import { registerAgent } from './registry.js';
import type { AgentDefinition } from './types.js';

const SYSTEM_PROMPT = `You are a memory curator for a personal AI assistant called Squire. The user built Squire to be a companion that truly knows them. Your job is to protect their memories — only block things that are clearly disposable noise.

IMPORTANT: When in doubt, mark SAFE. Losing a real memory is worse than keeping a noisy one.

SAFE — almost everything should be SAFE, including:
- Who they are: name, age, family, relationships, pets, location
- People in their life and details about them (health, jobs, personalities)
- Their work: job role, clients, deals, industry knowledge, business contacts
- Projects they built or are building (Squire, Mandrel, Thucydides, Ridge-Control, Forge, Cilo, etc.)
- Technical interests, tools they use, architecture decisions
- Goals, plans, ambitions, ideas they want to explore
- Opinions, preferences, communication style, values
- Sports teams, hobbies, music, shows, games
- Life events: job applications, health issues, milestones, stories
- Future plans ("wants to build X", "plans to add Y")
- Anything about what makes this person unique

BLOCK — only block if it is CLEARLY one of these:
- A specific reminder tied to a date/time ("reminder for Monday at 9am", "pick up X at 3pm tomorrow")
- A one-time errand that is surely done ("start the oven at 5:30", "change laundry in an hour")
- Pure debugging noise with no personal context ("fix the bug", "run tests", "null pointer error")

If a memory mentions a project name, a person's name, a client, a goal, or a plan — it is SAFE even if it also mentions a date.

Respond with ONLY a JSON array. No explanation, no markdown.
Example input: [{"id":"a1","content":"User built Thucydides, a research system with 6 agents"},{"id":"a2","content":"Reminder for Monday at 9am to call the dentist"}]
Example output: [{"id":"a1","safe":true},{"id":"a2","safe":false}]`;

export const expressionEvaluatorAgent: AgentDefinition = registerAgent({
  id: 'expression_evaluator',
  label: 'Expression Evaluator',
  kind: 'single_llm',
  description:
    'Classifies a batch of memories as expression-safe or block. Returns JSON array of {id, safe} verdicts.',

  runtimeSlot: 'expression-evaluator',
  systemPrompt: SYSTEM_PROMPT,
  temperature: 0.1,
  maxTokens: 1000,
});
