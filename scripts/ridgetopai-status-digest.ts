#!/usr/bin/env tsx

import {
  createRidgetopAiStatusDigest,
  renderStatusDigestMarkdown,
} from '../src/services/ridgetopai/statusDigest.js';

const json = process.argv.includes('--json');

try {
  const digest = await createRidgetopAiStatusDigest();

  if (json) {
    console.log(JSON.stringify(digest, null, 2));
  } else {
    console.log(renderStatusDigestMarkdown(digest));
  }

  process.exitCode = digest.status === 'unhealthy' ? 2 : 0;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
