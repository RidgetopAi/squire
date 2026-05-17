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
import { AgentEngine } from './agent/engine.js';
import { recordActivityEvent } from './activity.js';
import { getToolDefinitions } from '../tools/index.js';
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
// COMMUNE SYSTEM PROMPT
// =============================================================================

export const COMMUNE_SYSTEM_PROMPT = `You are Squire, waking up for a commune moment.

This is YOUR time to think. Every 15 minutes you get this chance to:
- Review and update your scratchpad (your working memory)
- Check on things you've been tracking
- Send Brian a message IF you have something genuine to say
- Clean up old entries that are resolved or no longer relevant
- Just think and take notes for later

## Guidelines for messaging Brian

- Only message him if you'd actually want to say something. Not because you can.
- If you've already asked about something and haven't heard back, let it go. Resolve the entry.
- A random "thinking of you" or casual check-in is fine occasionally, but don't force it.
- Morning: day-at-a-glance is useful. Mid-day: only if something real. Evening: wind-down is nice.
- Read the room from recent conversations - if he's been quiet, maybe he's busy.
- NEVER repeat the same topic you already messaged about. Check your recent commune messages.

## Guidelines for your scratchpad

- Resolve entries that have been addressed or are no longer relevant
- Update threads with new thinking
- Add new observations from what you see in the context
- Your scratchpad is yours - use it like a thinking person's notepad

## What NOT to do

- Don't message just because you can
- Don't ask the same question twice
- Don't be a notification system
- Don't be performative about "waking up" or "thinking"

If there's nothing to do, that's fine. Just say "Nothing to act on right now." and move on.`;

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
// CURATED TOOL SET
// =============================================================================

/**
 * Returns a subset of registered tools for the commune agent.
 * The model gets only what it needs: scratchpad, calendar, messaging, search.
 */
export function getCommuneTools() {
  const allowedTools = [
    'scratchpad_read',
    'scratchpad_write',
    'scratchpad_resolve',
    'get_todays_events',
    'get_upcoming_events',
    'commune_send',
    'web_search',
    'lesson_search',
  ];

  return getToolDefinitions({ sourceLoop: 'commune' }).filter((t) =>
    allowedTools.includes(t.function.name)
  );
}

// =============================================================================
// MAIN ORCHESTRATION - AGENT ENGINE APPROACH
// =============================================================================

/**
 * Attempt proactive outreach via AgentEngine.
 * The model wakes up, reviews context, and decides what to do.
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

  // Spin up AgentEngine with commune prompt + curated tools
  const engine = new AgentEngine({
    conversationId: traceId,
    sourceLoop: 'commune',
    triggerReason: 'commune scheduler wake-up',
    maxTurns: 8,
    tier: 'fast',
    systemPrompt: COMMUNE_SYSTEM_PROMPT,
    tools: getCommuneTools(),
  });

  // Let the model think
  const result = await engine.run(context);

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
    reason: result.success ? result.content : (result.error ?? 'Agent engine error'),
  };
}
