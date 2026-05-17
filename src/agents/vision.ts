/**
 * Agent: vision
 *
 * Vision-enabled chat slot. Socket chat switches to this runtime when
 * images are attached; HTTP chat narrows the tool surface to image tools.
 *
 * Catalog entry — actual dispatch lives in api/socket/handlers.ts and
 * services/chat/chat.ts. Phase 1 declares identity only.
 */

import { registerAgent } from './registry.js';
import type { AgentDefinition } from './types.js';

export const visionAgent: AgentDefinition = registerAgent({
  id: 'vision',
  label: 'Vision Chat',
  kind: 'single_llm',
  description:
    'Vision-enabled chat slot. Used when the user attaches images. No standalone dispatch — invoked by chat surfaces.',

  runtimeSlot: 'vision',
});
