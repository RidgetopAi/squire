/**
 * Agent: vision
 *
 * Single-shot vision LLM call. Used standalone via tools/images.ts to
 * describe / analyze a stored image. Also used as a runtime-slot
 * override in api/socket/handlers.ts when an incoming chat carries
 * image attachments — that path looks up `getLLMRuntime('vision')`
 * directly for the streaming chat loop and does NOT invoke this
 * agent.
 *
 * Caller passes:
 *   args.input   -> the user prompt (e.g. "Describe this image in detail.")
 *   args.payload -> { images: ImageContent[] } so the single user message
 *                   carries the image(s) on the LLMMessage.images field.
 */

import { registerAgent } from './registry.js';
import type { AgentDefinition } from './types.js';
import type { ImageContent, LLMMessage } from '../services/llm/types.js';

export const visionAgent: AgentDefinition = registerAgent({
  id: 'vision',
  label: 'Vision',
  kind: 'single_llm',
  description:
    'Standalone vision LLM call. Returns the model\'s description of the attached image(s). Reads runtime/provider from the vision LLM slot.',

  runtimeSlot: 'vision',
  buildMessages: (args): LLMMessage[] => {
    const payload = args.payload as { images?: ImageContent[] } | undefined;
    const images = payload?.images ?? [];
    return [
      {
        role: 'user',
        content: args.input ?? '',
        ...(images.length > 0 ? { images } : {}),
      },
    ];
  },
});
