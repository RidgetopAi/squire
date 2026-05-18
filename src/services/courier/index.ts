export { start as startCourier, stop as stopCourier, isRunning, getStats, runNow } from './scheduler.js';
export { registerTask, unregisterTask, listTasks } from './tasks/index.js';
export type { CourierTask, TaskResult } from './tasks/index.js';

import { runAgent } from '../../agents/lazy.js';

// Register built-in tasks
import { registerTask } from './tasks/index.js';

// Auto-register email check task — dispatched via agent registry (connector)
registerTask('email-check', {
  name: 'email-check',
  enabled: true,
  async execute() {
    const result = await runAgent('courier_email_check', {
      actor: 'scheduler',
      triggerReason: 'courier tick',
    });
    return {
      success: result.success,
      message: result.content,
      data: result.data,
    };
  },
});

import { goalWorkerTask } from './tasks/goalWorker.js';
registerTask('goal-worker', goalWorkerTask);

// Register Daily Brief task (sends 7 AM EDT) — dispatched via agent registry
registerTask('daily-brief', {
  name: 'daily-brief',
  enabled: true,
  async execute() {
    const result = await runAgent('daily_brief', {
      actor: 'scheduler',
      triggerReason: 'courier tick',
    });
    return {
      success: result.success,
      message: result.content,
      data: result.data,
    };
  },
});

// Register AgentMail check task (if configured) — dispatched via agent registry
if (process.env['AGENTMAIL_API_KEY']) {
  registerTask('agentmail-check', {
    name: 'agentmail-check',
    enabled: true,
    async execute() {
      const result = await runAgent('agentmail_check', {
        actor: 'scheduler',
        triggerReason: 'courier tick',
      });
      return {
        success: result.success,
        message: result.content,
        data: result.data,
      };
    },
  });
}
