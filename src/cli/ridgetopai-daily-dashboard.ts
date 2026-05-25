#!/usr/bin/env node

import {
  createRidgetopAiDailyDashboard,
  renderDailyDashboardMarkdown,
} from '../services/ridgetopai/dailyDashboard.js';

const json = process.argv.includes('--json');

try {
  const dashboard = await createRidgetopAiDailyDashboard();

  if (json) {
    console.log(JSON.stringify(dashboard, null, 2));
  } else {
    console.log(renderDailyDashboardMarkdown(dashboard));
  }

  process.exitCode = dashboard.status === 'unhealthy' ? 2 : 0;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
