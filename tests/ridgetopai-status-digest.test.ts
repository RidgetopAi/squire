import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  classifyGitStatus,
  computeOverallStatus,
  renderStatusDigestMarkdown,
  type RidgetopAiStatusDigest,
} from '../src/services/ridgetopai/statusDigest.js';

describe('RidgetopAI status digest', () => {
  it('classifies clean and dirty git status output', () => {
    assert.strictEqual(classifyGitStatus('## main...origin/main\n'), 'healthy');
    assert.strictEqual(classifyGitStatus('## main...origin/main [ahead 1]\n'), 'degraded');
    assert.strictEqual(classifyGitStatus('## main...origin/main\n M package.json\n'), 'degraded');
  });

  it('rolls probe statuses into an overall status', () => {
    assert.strictEqual(computeOverallStatus([
      { name: 'ok', kind: 'endpoint', status: 'healthy', detail: 'ok' },
      { name: 'dirty', kind: 'git', status: 'degraded', detail: 'ahead 1' },
    ]), 'degraded');

    assert.strictEqual(computeOverallStatus([
      { name: 'down', kind: 'endpoint', status: 'unhealthy', detail: 'HTTP 500' },
      { name: 'ok', kind: 'git', status: 'healthy', detail: 'clean' },
    ]), 'unhealthy');
  });

  it('renders a markdown digest with probes and Mandrel summaries', () => {
    const digest: RidgetopAiStatusDigest = {
      checkedAt: new Date('2026-05-25T12:00:00.000Z'),
      status: 'healthy',
      probes: [
        { name: 'Squire API', kind: 'endpoint', status: 'healthy', detail: 'HTTP 200 in 50ms' },
      ],
      mandrel: {
        project: 'ridgetopai',
        progressSummary: '15/24 complete',
        todoSummary: 'RTA-022 todo',
      },
    };

    const markdown = renderStatusDigestMarkdown(digest);

    assert.match(markdown, /RidgetopAI Status Digest/);
    assert.match(markdown, /Squire API/);
    assert.match(markdown, /15\/24 complete/);
    assert.match(markdown, /RTA-022 todo/);
  });
});
