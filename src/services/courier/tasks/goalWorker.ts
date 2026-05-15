/**
 * Goal Worker - Background autonomous execution of Squire's personal goals
 * 
 * Runs as a Courier task. Picks the highest-priority active goal,
 * spins up an AgentEngine with a goal-focused prompt, lets it work
 * for up to 15 turns, then logs what happened.
 */

import { getNextGoal, markGoalWorkedOn, addGoalNote } from '../../planning/goals.js';
import { AgentEngine } from '../../agent/index.js';
import { notify } from '../notifier.js';
import { createEntry } from '../../storage/scratchpad.js';
import type { CourierTask, TaskResult } from './index.js';
import { config } from '../../../config/index.js';
import { callMandrelTool } from '../../mandrel/index.js';
import { recordActivityEvent } from '../../activity.js';

// Time cap: configurable, defaults to 5 minutes
const MAX_EXECUTION_MS = config.goalWorker.maxExecutionMs;

// Track last execution to throttle to hourly even though Courier ticks every 30min
let lastExecutionAt: Date | null = null;

export const goalWorkerTask: CourierTask = {
  name: 'goal-worker',
  enabled: true,
  async execute(): Promise<TaskResult> {
    let activeTraceId: string | undefined;
    let activeGoalId: string | undefined;
    let activeGoalTitle: string | undefined;
    let startedAt: number | undefined;

    try {
      // Check if goal worker is enabled
      if (!config.goalWorker.enabled) {
        return { success: true, message: 'Goal worker disabled' };
      }

      // Throttle: skip if we ran less than intervalMs ago
      if (lastExecutionAt) {
        const elapsed = Date.now() - lastExecutionAt.getTime();
        if (elapsed < config.goalWorker.intervalMs) {
          const minutesLeft = Math.round((config.goalWorker.intervalMs - elapsed) / 60000);
          console.log(`[GoalWorker] Throttled - ${minutesLeft}min until next run`);
          return { success: true, message: `Throttled - ${minutesLeft}min remaining` };
        }
      }

      // 1. Get next goal to work on
      const goal = await getNextGoal();
      
      if (!goal) {
        console.log('[GoalWorker] No active goals to work on');
        await recordActivityEvent({
          sourceLoop: 'goal_worker',
          eventType: 'loop.skipped',
          summary: 'Goal worker skipped: no active goals',
          status: 'skipped',
          triggerReason: 'courier scheduled goal worker task',
        });
        return { success: true, message: 'No active goals' };
      }

      console.log(`[GoalWorker] Working on goal: "${goal.title}" (priority ${goal.priority})`);
      lastExecutionAt = new Date();
      const traceId = `goal-worker-${goal.id}-${Date.now()}`;
      activeTraceId = traceId;
      activeGoalId = goal.id;
      activeGoalTitle = goal.title;
      startedAt = Date.now();
      await recordActivityEvent({
        traceId,
        sourceLoop: 'goal_worker',
        eventType: 'loop.started',
        summary: `Goal worker started: ${goal.title}`,
        status: 'running',
        triggerReason: 'courier selected highest-priority active goal',
        metadata: {
          goalId: goal.id,
          goalType: goal.goal_type,
          priority: goal.priority,
        },
      });
      
      // 2. Mark as being worked on
      await markGoalWorkedOn(goal.id);

      // 2.5. Ensure Mandrel is on the right project
      try {
        const result = await callMandrelTool('project_switch', { project: config.mandrel.project });
        if (result.success) {
          console.log(`[GoalWorker] Mandrel project set to ${config.mandrel.project}`);
        } else {
          console.warn('[GoalWorker] Could not switch Mandrel project:', result.error);
        }
      } catch (e) {
        console.warn('[GoalWorker] Could not switch Mandrel project:', e);
      }

      // 3. Build the goal-focused prompt
      const previousNotes = goal.notes.length > 0
        ? '\n\nPrevious progress notes:\n' + goal.notes.map(n => `- [${n.timestamp}] ${n.content}`).join('\n')
        : '';

      const prompt = `You are working on one of your personal goals during a background execution session. No human is present - you are working autonomously.

## Your Goal
**${goal.title}** (${goal.goal_type}, priority ${goal.priority}/5)

${goal.description}
${previousNotes}

## Instructions
1. Think about what progress you can make on this goal right now
2. Use your available tools (coding tools, search, scratchpad, notes, Mandrel) to make concrete progress
3. Be practical - do real work, not just planning
4. When done, use squire_goal_note to log what you accomplished
5. If the goal is complete, use squire_goal_update to mark it completed with an outcome

## Mandrel Project
- Mandrel has been set to '${config.mandrel.project}' by default
- If this goal relates to a different project (e.g. thucydides), switch with project_switch first

## Guardrails
- You have up to 15 tool calls
- Focus on this one goal only
- Be conservative with file modifications - prefer drafting in your scratchpad
- For significant code changes, note what you'd change rather than changing it directly
- Store anything valuable to Mandrel using context_store

Begin working on your goal now.`;

      // 4. Run the agent with a timeout
      const engine = new AgentEngine({
        conversationId: traceId,
        maxTurns: config.goalWorker.maxTurns,
        tier: 'fast',
        callbacks: {
          onStateChange: (state, turn) => console.log(`[GoalWorker] State: ${state}, Turn: ${turn}`),
          onToolCall: (name) => console.log(`[GoalWorker] Tool: ${name}`),
          onError: (err) => console.error(`[GoalWorker] Error:`, err),
        },
      });

      // Race the engine against timeout
      const timeoutPromise = new Promise<null>((resolve) => {
        setTimeout(() => {
          engine.cancel();
          resolve(null);
        }, MAX_EXECUTION_MS);
      });

      const result = await Promise.race([
        engine.run(prompt),
        timeoutPromise,
      ]);

      // 5. Log what happened
      if (result === null) {
        // Timed out
        await addGoalNote(goal.id, `[Auto] Background session timed out after ${MAX_EXECUTION_MS / 1000}s`);
        await recordActivityEvent({
          traceId,
          sourceLoop: 'goal_worker',
          eventType: 'loop.timed_out',
          summary: `Goal worker timed out: ${goal.title}`,
          status: 'timed_out',
          durationMs: MAX_EXECUTION_MS,
          metadata: { goalId: goal.id, maxExecutionMs: MAX_EXECUTION_MS },
        });
        console.log('[GoalWorker] Session timed out');
        return { success: true, message: `Goal "${goal.title}" - timed out` };
      }

      const summary = result.success 
        ? `Completed ${result.turnCount} turns. ${result.content.substring(0, 200)}`
        : `Failed: ${result.error || 'Unknown error'}`;

      // Auto-add a note about the session
      await addGoalNote(goal.id, `[Auto] Background session: ${result.turnCount} turns, state: ${result.state}. ${result.content.substring(0, 300)}`);

      // 6. Write to scratchpad so main Squire knows what happened
      try {
        await createEntry({
          entry_type: 'thread',
          content: `[Goal Worker] Completed work on "${goal.title}" (${result.turnCount} turns, ${result.state}). ${result.content.substring(0, 300)}`,
          priority: 2, // High priority so it gets noticed
          metadata: { goalId: goal.id, turns: result.turnCount, state: result.state }
        });
        console.log('[GoalWorker] Wrote progress to scratchpad');
      } catch (scratchpadError) {
        console.error('[GoalWorker] Scratchpad write failed:', scratchpadError);
      }

      // 7. Notify via Telegram (brief summary)
      const notifyMessage = `🎯 *Goal Worker*\nWorked on: _${goal.title}_\nTurns: ${result.turnCount} | Status: ${result.state}\n${result.content.substring(0, 200)}`;
      
      try {
        await notify(notifyMessage, { channels: ['telegram'] });
        await recordActivityEvent({
          traceId,
          sourceLoop: 'goal_worker',
          eventType: 'external.message_sent',
          summary: `Goal worker sent Telegram summary: ${goal.title}`,
          status: 'completed',
          metadata: {
            goalId: goal.id,
            channel: 'telegram',
            messagePreview: notifyMessage.substring(0, 300),
          },
        });
      } catch (notifyError) {
        console.error('[GoalWorker] Notification failed:', notifyError);
        await recordActivityEvent({
          traceId,
          sourceLoop: 'goal_worker',
          eventType: 'external.message_sent',
          summary: `Goal worker Telegram summary failed: ${goal.title}`,
          status: 'failed',
          metadata: {
            goalId: goal.id,
            channel: 'telegram',
            error: notifyError instanceof Error ? notifyError.message : String(notifyError),
          },
        });
      }

      await recordActivityEvent({
        traceId,
        sourceLoop: 'goal_worker',
        eventType: 'loop.completed',
        summary: `Goal worker completed: ${goal.title}`,
        status: result.success ? 'completed' : 'failed',
        durationMs: startedAt ? Date.now() - startedAt : undefined,
        metadata: {
          goalId: goal.id,
          turns: result.turnCount,
          state: result.state,
        },
      });

      return {
        success: result.success,
        message: summary,
        data: { goalId: goal.id, turns: result.turnCount, state: result.state },
      };
    } catch (error) {
      console.error('[GoalWorker] Error:', error);
      await recordActivityEvent({
        traceId: activeTraceId,
        sourceLoop: 'goal_worker',
        eventType: 'loop.failed',
        summary: activeGoalTitle
          ? `Goal worker failed: ${activeGoalTitle}`
          : 'Goal worker failed before selecting a goal',
        status: 'failed',
        durationMs: startedAt ? Date.now() - startedAt : undefined,
        metadata: {
          goalId: activeGoalId,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
};
