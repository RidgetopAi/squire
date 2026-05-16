/**
 * Commune core service functions.
 *
 * This module intentionally stays independent of the tool registry and agent
 * runtime so commune tools can depend on delivery/event behavior without
 * creating a services -> tools -> services import cycle.
 */

import * as crypto from 'crypto';
import { config } from '../../config/index.js';
import { pool } from '../../db/pool.js';
import {
  isConfigured as isTelegramConfigured,
  sendMessage as sendTelegramMessage,
} from '../telegram/client.js';

// =============================================================================
// TYPES
// =============================================================================

export type CommuneTriggerType =
  | 'scratchpad'
  | 'commitment_soon'
  | 'commitment_overdue'
  | 'stale_thread'
  | 'daily_summary'
  | 'custom';

export type CommuneChannel = 'telegram' | 'push' | 'email';

export type CommuneStatus = 'pending' | 'sent' | 'failed' | 'suppressed';

export interface CommuneEvent {
  id: string;
  trigger_type: CommuneTriggerType;
  trigger_id: string | null;
  message: string;
  channel: CommuneChannel;
  status: CommuneStatus;
  sent_at: Date | null;
  error_message: string | null;
  content_hash: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface CommuneConfig {
  quiet_hours_start: number;
  quiet_hours_end: number;
  max_daily_messages: number;
  min_hours_between_messages: number;
  enabled_channels: string[];
  default_channel: CommuneChannel;
  enabled: boolean;
}

export interface CreateCommuneInput {
  trigger_type: CommuneTriggerType;
  trigger_id?: string;
  message: string;
  channel?: CommuneChannel;
  metadata?: Record<string, unknown>;
}

// =============================================================================
// CONFIG OPERATIONS
// =============================================================================

export async function getCommuneConfig(): Promise<CommuneConfig> {
  const result = await pool.query('SELECT * FROM commune_config WHERE id = 1');

  if (result.rows.length === 0) {
    return {
      quiet_hours_start: config.commune.quietHoursStart,
      quiet_hours_end: config.commune.quietHoursEnd,
      max_daily_messages: config.commune.maxDailyMessages,
      min_hours_between_messages: config.commune.minHoursBetweenMessages,
      enabled_channels: ['telegram'],
      default_channel: config.commune.defaultChannel,
      enabled: config.commune.enabled,
    };
  }

  return result.rows[0] as CommuneConfig;
}

// =============================================================================
// EVENT OPERATIONS
// =============================================================================

export async function createCommuneEvent(input: CreateCommuneInput): Promise<CommuneEvent> {
  const { trigger_type, trigger_id, message, channel = 'telegram', metadata = {} } = input;

  const contentHash = crypto.createHash('sha256').update(message).digest('hex').slice(0, 16);

  const result = await pool.query(
    `INSERT INTO commune_events (trigger_type, trigger_id, message, channel, content_hash, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [trigger_type, trigger_id ?? null, message, channel, contentHash, JSON.stringify(metadata)]
  );

  return result.rows[0] as CommuneEvent;
}

export async function getRecentEvents(limit: number = 20): Promise<CommuneEvent[]> {
  const result = await pool.query(
    `SELECT * FROM commune_events ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  return result.rows as CommuneEvent[];
}

export async function getTodaysSentEvents(): Promise<CommuneEvent[]> {
  const result = await pool.query(
    `SELECT * FROM commune_events
     WHERE status = 'sent'
     AND sent_at >= CURRENT_DATE
     ORDER BY sent_at DESC`
  );
  return result.rows as CommuneEvent[];
}

export async function getLastSentEvent(): Promise<CommuneEvent | null> {
  const result = await pool.query(
    `SELECT * FROM commune_events
     WHERE status = 'sent'
     ORDER BY sent_at DESC
     LIMIT 1`
  );
  return (result.rows[0] as CommuneEvent) ?? null;
}

export async function markEventSent(id: string): Promise<CommuneEvent | null> {
  const result = await pool.query(
    `UPDATE commune_events
     SET status = 'sent', sent_at = NOW(), updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id]
  );
  return (result.rows[0] as CommuneEvent) ?? null;
}

export async function markEventFailed(id: string, errorMessage: string): Promise<CommuneEvent | null> {
  const result = await pool.query(
    `UPDATE commune_events
     SET status = 'failed', error_message = $2, updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, errorMessage]
  );
  return (result.rows[0] as CommuneEvent) ?? null;
}

// =============================================================================
// CONSTRAINT CHECKS
// =============================================================================

export function isQuietHours(communeConfig: CommuneConfig): boolean {
  const now = new Date();
  const hour = parseInt(
    now.toLocaleString('en-US', {
      hour: 'numeric',
      hour12: false,
      timeZone: config.timezone,
    })
  );

  const { quiet_hours_start, quiet_hours_end } = communeConfig;

  if (quiet_hours_start > quiet_hours_end) {
    return hour >= quiet_hours_start || hour < quiet_hours_end;
  }
  return hour >= quiet_hours_start && hour < quiet_hours_end;
}

export async function isAtDailyLimit(communeConfig: CommuneConfig): Promise<boolean> {
  const todayEvents = await getTodaysSentEvents();
  return todayEvents.length >= communeConfig.max_daily_messages;
}

export async function hasEnoughTimePassed(communeConfig: CommuneConfig): Promise<boolean> {
  const lastEvent = await getLastSentEvent();
  if (!lastEvent || !lastEvent.sent_at) return true;

  const hoursSince = (Date.now() - lastEvent.sent_at.getTime()) / (1000 * 60 * 60);
  return hoursSince >= communeConfig.min_hours_between_messages;
}

export async function canSendNow(): Promise<{ allowed: boolean; reason: string }> {
  const communeConfig = await getCommuneConfig();

  if (!communeConfig.enabled) {
    return { allowed: false, reason: 'Commune is disabled' };
  }

  if (isQuietHours(communeConfig)) {
    return { allowed: false, reason: 'Currently in quiet hours' };
  }

  if (await isAtDailyLimit(communeConfig)) {
    return { allowed: false, reason: 'Daily message limit reached' };
  }

  if (!(await hasEnoughTimePassed(communeConfig))) {
    return { allowed: false, reason: 'Not enough time since last message' };
  }

  return { allowed: true, reason: 'All constraints satisfied' };
}

// =============================================================================
// DELIVERY
// =============================================================================

export async function deliverMessage(
  message: string,
  channel: CommuneChannel
): Promise<{ success: boolean; error?: string }> {
  switch (channel) {
    case 'telegram': {
      if (!isTelegramConfigured()) {
        return { success: false, error: 'Telegram not configured' };
      }

      try {
        const allowedUserId = config.telegram.allowedUserIds[0];
        if (!allowedUserId) {
          return { success: false, error: 'No Telegram user ID configured' };
        }
        const chatId = parseInt(allowedUserId, 10);
        if (isNaN(chatId)) {
          return { success: false, error: 'No valid Telegram chat ID configured' };
        }

        await sendTelegramMessage(chatId, message);
        return { success: true };
      } catch (error) {
        const err = error as Error;
        return { success: false, error: err.message };
      }
    }

    case 'push':
      return { success: false, error: 'Push notifications not yet implemented' };

    case 'email':
      return { success: false, error: 'Email delivery not yet implemented' };

    default:
      return { success: false, error: `Unknown channel: ${channel}` };
  }
}
