/**
 * Commune Module
 *
 * Squire's proactive outreach system - model-driven autonomous thinking.
 */

// Re-export service functions
export {
  // Types
  type CommuneTriggerType,
  type CommuneChannel,
  type CommuneStatus,
  type CommuneEvent,
  type CommuneConfig,
  type CreateCommuneInput,

  // Config operations
  getCommuneConfig,
  updateCommuneConfig,

  // Event operations
  createCommuneEvent,
  getRecentEvents,
  getTodaysSentEvents,
  getLastSentEvent,
  markEventSent,
  markEventFailed,
  markEventSuppressed,
  wasRecentlySent,

  // Constraint checks
  isQuietHours,
  isAtDailyLimit,
  hasEnoughTimePassed,
  canSendNow,

  // Delivery
  deliverMessage,

  // Main orchestration
  attemptOutreach,
  sendCustomMessage,

  // Stats
  getCommuneStats,
} from '../commune.js';

// Re-export scheduler functions
export {
  start as startCommuneScheduler,
  stop as stopCommuneScheduler,
  isRunning as isCommuneSchedulerRunning,
  getStats as getCommuneSchedulerStats,
  runNow as runCommuneNow,
  initCommuneScheduler,
  shutdownCommuneScheduler,
  type CommuneSchedulerStats,
} from './scheduler.js';
