import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFile } from 'node:fs/promises';

describe('import boundaries', () => {
  it('keeps commune tool handlers out of the commune orchestration service', async () => {
    const communeTool = await readFile(new URL('../src/tools/commune.ts', import.meta.url), 'utf8');
    const communeCore = await readFile(new URL('../src/services/commune/core.ts', import.meta.url), 'utf8');

    assert.ok(
      communeTool.includes("from '../services/commune/core.js'"),
      'commune tool should depend on the core commune service'
    );
    assert.ok(
      !communeTool.includes("from '../services/commune.js'"),
      'commune tool must not import the commune orchestration service'
    );
    assert.ok(
      !/from ['"].*\.\.\/.*tools\//.test(communeCore),
      'commune core must not depend on tool modules'
    );
    assert.ok(
      !communeCore.includes("from '../agent/engine.js'"),
      'commune core must not depend on AgentEngine'
    );
  });
});
