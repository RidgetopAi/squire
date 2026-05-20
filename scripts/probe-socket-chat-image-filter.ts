/**
 * Phase 3.1 probe: verify socket_chat's tools resolver drops to image-only
 * when payload.hasImages is true, and returns the full set when it isn't.
 *
 * Imports the agent registry to read the registered tools() resolver and
 * invokes it with both payload shapes. Sanity-checks against the OpenAI
 * 128-tool limit so we know the LLM call won't crash on image upload.
 *
 * Throwaway probe.
 */
import '../src/agents/index.js'; // registers all agents
import { getAgent } from '../src/agents/registry.js';

async function main() {
  const agent = getAgent('socket_chat');
  if (!agent) throw new Error('socket_chat agent not registered');
  if (typeof agent.tools !== 'function') throw new Error('socket_chat tools resolver is not a function');

  console.log('[1] resolver with payload undefined (text-only chat)');
  const fullSet = agent.tools({ payload: undefined });
  console.log(`  ${fullSet.length} tools`);

  console.log('[2] resolver with payload.hasImages=true');
  const imageSet = agent.tools({ payload: { hasImages: true } });
  console.log(`  ${imageSet.length} tools: ${imageSet.map((t) => t.function.name).join(', ')}`);

  console.log('[3] resolver with payload.hasImages=false (explicit)');
  const explicitFalse = agent.tools({ payload: { hasImages: false } });
  console.log(`  ${explicitFalse.length} tools`);

  console.log('\n[checks]');
  if (imageSet.length >= fullSet.length) {
    throw new Error(`expected image-set to be a strict subset; got ${imageSet.length} vs ${fullSet.length}`);
  }
  if (imageSet.length === 0) {
    throw new Error('image-set is empty — image tools not found');
  }
  if (fullSet.length > 128) {
    console.log(`  full set is ${fullSet.length} (over 128) — this is exactly why the image filter is needed`);
  } else {
    console.log(`  full set is ${fullSet.length} (under 128) — image filter still helps focus the model`);
  }
  if (explicitFalse.length !== fullSet.length) {
    throw new Error(`payload.hasImages=false should match no-payload; got ${explicitFalse.length} vs ${fullSet.length}`);
  }

  console.log('\nALL OK');
}

main().catch((e) => {
  console.error('FAIL:', e);
  process.exit(1);
});
