#!/usr/bin/env node

import { handleDaytimeDispatchText } from '../services/ridgetopai/daytimeDispatch.js';

const json = process.argv.includes('--json');
const input = process.argv
  .slice(2)
  .filter((arg) => arg !== '--json')
  .join(' ')
  .trim();

if (!input) {
  console.error('Usage: npm run rta:dispatch:dev -- "rta status"');
  process.exitCode = 1;
} else {
  try {
    const result = await handleDaytimeDispatchText(input, { source: 'cli' });

    if (json) {
      console.log(JSON.stringify(result, null, 2));
    } else if (result.handled) {
      console.log(result.confirmation ?? 'RTA dispatch handled.');
    } else {
      console.log('No RTA dispatch command detected.');
    }

    process.exitCode = result.error ? 1 : 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
