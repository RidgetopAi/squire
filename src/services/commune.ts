/**
 * Commune Service v2 - Model-Driven Autonomous Thinking
 *
 * Instead of a coded decision tree (findShareable → generateMessage → send),
 * the model wakes up every 15 minutes with context and tools. It decides
 * what to do - think, take notes, clean up scratchpad, send a message, or nothing.
 * The code handles plumbing and guardrails only.
 */

import { config } from '../config/index.js';
import { listEntries as listScratchpadEntries } from './storage/scratchpad.js';
import { getUpcomingCommitments } from './planning/commitments.js';
import { runAgent } from '../agents/index.js';
import { recordActivityEvent } from './activity.js';
import {
  canSendNow,
  getCommuneConfig,
  getRecentEvents,
  getTodaysSentEvents,
  isQuietHours,
} from './commune/core.js';

export {
  type CommuneTriggerType,
  type CommuneChannel,
  type CommuneStatus,
  type CommuneEvent,
  type CommuneConfig,
  type CreateCommuneInput,
  getCommuneConfig,
  createCommuneEvent,
  getRecentEvents,
  getTodaysSentEvents,
  getLastSentEvent,
  markEventSent,
  markEventFailed,
  isQuietHours,
  isAtDailyLimit,
  hasEnoughTimePassed,
  canSendNow,
  deliverMessage,
} from './commune/core.js';

// =============================================================================
// CONTEXT GATHERING
// =============================================================================

async function gatherCommuneContext(sendStatus: { allowed: boolean; reason: string }): Promise<string> {
  const [scratchpad, todayEvents, recentCommune, communeConfig] = await Promise.all([
    listScratchpadEntries({ limit: 15 }),
    getUpcomingCommitments(480),  // next 8 hours
    getRecentEvents(5),
    getCommuneConfig(),
  ]);

  const todaySent = await getTodaysSentEvents();

  const now = new Date();
  const timeStr = now.toLocaleString('en-US', {
    timeZone: config.timezone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  // Format scratchpad
  let scratchpadSection: string;
  if (scratchpad.length === 0) {
    scratchpadSection = '_No active scratchpad entries._';
  } else {
    scratchpadSection = scratchpad.map((e) => {
      const age = Math.round((Date.now() - new Date(e.created_at).getTime()) / (1000 * 60 * 60));
      const ageStr = age < 1 ? '<1h ago' : age < 24 ? `${age}h ago` : `${Math.round(age / 24)}d ago`;
      return `- [${e.entry_type}] (P${e.priority}, ${ageStr}) ${e.content} [id: ${e.id}]`;
    }).join('\n');
  }

  // Format schedule
  let scheduleSection: string;
  if (todayEvents.length === 0) {
    scheduleSection = '_No upcoming events in the next 8 hours._';
  } else {
    scheduleSection = todayEvents.map((c) => {
      const dueStr = c.due_at
        ? new Date(c.due_at).toLocaleString('en-US', {
            timeZone: config.timezone,
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
          })
        : 'no time set';
      return `- ${c.title} (${dueStr}) [${c.status}]`;
    }).join('\n');
  }

  // Format recent commune messages
  let recentCommuneSection: string;
  if (recentCommune.length === 0) {
    recentCommuneSection = '_No recent commune messages._';
  } else {
    recentCommuneSection = recentCommune
      .filter((e) => e.status === 'sent')
      .map((e) => {
        const sentStr = e.sent_at
          ? new Date(e.sent_at).toLocaleString('en-US', {
              timeZone: config.timezone,
              hour: 'numeric',
              minute: '2-digit',
              hour12: true,
            })
          : 'unknown';
        return `- (${sentStr}) ${e.message}`;
      }).join('\n') || '_No sent messages recently._';
  }

  return `## Commune Wake-Up

**Current time**: ${timeStr}
**Can send message**: ${sendStatus.allowed ? 'Yes' : `No - ${sendStatus.reason}`}
**Messages sent today**: ${todaySent.length}/${communeConfig.max_daily_messages}

### Your Scratchpad (active entries)
${scratchpadSection}

### Upcoming Schedule (next 8 hours)
${scheduleSection}

### Recent Commune Messages You've Sent
${recentCommuneSection}
`;
}

// =============================================================================
// MAIN ORCHESTRATION
// =============================================================================

/**
 * Attempt proactive outreach via the commune agent.
 * The model wakes up, reviews context, and decides what to do.
 * Prompt, tools, tier, and maxTurns come from the agent registry definition.
 */
export async function attemptOutreach(): Promise<{
  sent: boolean;
  reason: string;
}> {
  const traceId = `commune-${Date.now()}`;

  // Check hard guardrails first (saves LLM cost during quiet hours)
  const communeConfig = await getCommuneConfig();
  if (!communeConfig.enabled) {
    await recordActivityEvent({
      traceId,
      sourceLoop: 'commune',
      eventType: 'loop.skipped',
      summary: 'Commune skipped: disabled',
      status: 'skipped',
      triggerReason: 'commune scheduler wake-up',
    });
    return { sent: false, reason: 'Commune is disabled' };
  }

  if (isQuietHours(communeConfig)) {
    await recordActivityEvent({
      traceId,
      sourceLoop: 'commune',
      eventType: 'loop.skipped',
      summary: 'Commune skipped: quiet hours',
      status: 'skipped',
      triggerReason: 'commune scheduler wake-up',
    });
    return { sent: false, reason: 'Currently in quiet hours' };
  }

  // Gather send status (model needs to know if it CAN send)
  const sendStatus = await canSendNow();

  // Gather context for the model
  const context = await gatherCommuneContext(sendStatus);
  await recordActivityEvent({
    traceId,
    sourceLoop: 'commune',
    eventType: 'loop.started',
    summary: 'Commune wake-up started',
    status: 'running',
    triggerReason: 'commune scheduler wake-up',
    metadata: {
      canSend: sendStatus.allowed,
      sendStatusReason: sendStatus.reason,
    },
  });

  // Run the commune agent — registry owns prompt, tools, tier, maxTurns
  const result = await runAgent('commune', {
    input: context,
    conversationId: traceId,
    traceId,
    actor: 'assistant',
    triggerReason: 'commune scheduler wake-up',
  });

  // Check if commune_send was called by looking at the result
  // The commune_send tool handles event recording internally
  const wasSent = result.content?.toLowerCase().includes('message sent successfully') ||
    result.content?.toLowerCase().includes('sent successfully');
  await recordActivityEvent({
    traceId,
    sourceLoop: 'commune',
    eventType: 'loop.completed',
    summary: wasSent ? 'Commune wake-up completed with outbound message' : 'Commune wake-up completed without outbound message',
    status: result.success ? 'completed' : 'failed',
    metadata: {
      sent: wasSent,
      turns: result.turnCount,
      state: result.state,
      resultPreview: result.content.substring(0, 500),
      error: result.error,
    },
  });

  return {
    sent: wasSent,
    reason: result.success ? result.content : (result.error ?? 'Commune agent run failed'),
  };
}
