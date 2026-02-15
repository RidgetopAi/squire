export { start as startCourier, stop as stopCourier, isRunning, getStats, runNow } from './scheduler.js';
export { registerTask, unregisterTask, listTasks } from './tasks/index.js';
export type { CourierTask, TaskResult } from './tasks/index.js';

// Register built-in tasks
import { emailCheckTask } from './tasks/emailCheck.js';
import { registerTask } from './tasks/index.js';

// Auto-register email check task
registerTask('email-check', emailCheckTask);

import { goalWorkerTask } from './tasks/goalWorker.js';
registerTask('goal-worker', goalWorkerTask);
