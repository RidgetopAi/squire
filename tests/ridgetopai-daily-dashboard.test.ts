import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createRidgetopAiDailyDashboard,
  renderDailyDashboardConfirmation,
  renderDailyDashboardMarkdown,
} from '../src/services/ridgetopai/dailyDashboard.js';

describe('RidgetopAI daily dashboard', () => {
  it('combines probes, Mandrel board text, and report artifacts', async () => {
    const artifactDir = await mkdtemp(join(tmpdir(), 'rta-dashboard-'));

    try {
      await writeFile(join(artifactDir, 'ridgetopai-status-digest-20260525.html'), '<html></html>');

      const calls: Array<{ toolName: string; args?: Record<string, unknown> }> = [];
      const dashboard = await createRidgetopAiDailyDashboard({
        now: new Date('2026-05-25T22:00:00.000Z'),
        artifactDir,
        createStatusDigest: async () => ({
          checkedAt: new Date('2026-05-25T22:00:00.000Z'),
          status: 'degraded',
          probes: [
            { name: 'Squire API', kind: 'endpoint', status: 'healthy', detail: 'HTTP 200' },
            { name: 'Harmony local runtime', kind: 'endpoint', status: 'unknown', detail: 'not running', optional: true },
            { name: 'dirty repo', kind: 'git', status: 'degraded', detail: 'ahead 1' },
          ],
          mandrel: {
            project: 'ridgetopai',
            progressSummary: '30/34 complete',
          },
        }),
        mandrelTool: async (toolName, args = {}) => {
          calls.push({ toolName, args });
          if (toolName === 'task_progress_summary') {
            return '30/34 complete';
          }
          if (toolName === 'task_list') {
            return 'RTA-035 todo';
          }
          if (toolName === 'context_get_recent') {
            return 'Recent context';
          }
          if (toolName === 'context_search') {
            return 'No launch requests';
          }
          return 'ok';
        },
      });

      assert.strictEqual(dashboard.status, 'degraded');
      assert.strictEqual(dashboard.artifacts.length, 1);
      assert.match(dashboard.mandrel?.taskBoard ?? '', /RTA-035/);
      assert.deepStrictEqual(calls.map((call) => call.toolName), [
        'project_switch',
        'task_progress_summary',
        'task_list',
        'context_get_recent',
        'context_search',
      ]);

      const markdown = renderDailyDashboardMarkdown(dashboard);
      assert.match(markdown, /RidgetopAI Daily Operating Dashboard/);
      assert.match(markdown, /Open Work And Blockers/);
      assert.match(markdown, /ridgetopai-status-digest-20260525\.html/);

      const confirmation = renderDailyDashboardConfirmation(dashboard);
      assert.match(confirmation, /RidgetopAI dashboard: DEGRADED/);
      assert.match(confirmation, /Focus:/);
    } finally {
      await rm(artifactDir, { recursive: true, force: true });
    }
  });
});
