/**
 * Squire Health Module for Daily Brief
 *
 * Operator-facing view of runtime health:
 * - systemd service and endpoint checks
 * - Courier and Commune scheduler status
 * - recent activity-event volume and failures
 * - recent log errors surfaced by Steward
 */

import { config } from '../../../config/index.js';
import { pool } from '../../../db/pool.js';
import { getSystemHealth as getStewardSystemHealth } from '../../steward/index.js';
import { getStats as getCourierStats, isRunning as isCourierRunning } from '../../courier/scheduler.js';
import { getStats as getCommuneStats, isRunning as isCommuneRunning } from '../../commune/scheduler.js';
import type { BriefModule, ModuleResult } from '../types.js';
import type { ErrorEntry, ServiceHealth, EndpointHealth } from '../../steward/types.js';

const COLORS = {
  accent: '#4f8ef7',
  success: '#22c55e',
  warning: '#f59e0b',
  danger: '#ef4444',
  text: '#1f2937',
  muted: '#6b7280',
  cardBg: '#f9fafb',
  white: '#ffffff',
  border: '#e5e7eb',
};

interface ActivityLoopRow {
  sourceLoop: string;
  count: number;
  failed: number;
}

interface FailedActivityRow {
  sourceLoop: string;
  eventType: string;
  summary: string;
  createdAt: Date;
}

interface ActivityStats {
  available: boolean;
  events24h: number;
  failed24h: number;
  lastEventAt: Date | null;
  loops: ActivityLoopRow[];
  recentFailures: FailedActivityRow[];
  error?: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toInt(value: unknown): number {
  if (typeof value === 'number') return value;
  const parsed = parseInt(String(value ?? '0'), 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(date: Date | null): string {
  if (!date) return 'Never';
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = diffMs / (1000 * 60);
  const diffHours = diffMs / (1000 * 60 * 60);
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (diffMinutes < 2) return 'Just now';
  if (diffMinutes < 60) return `${Math.round(diffMinutes)}m ago`;
  if (diffHours < 24) return `${Math.round(diffHours)}h ago`;
  if (diffDays < 7) return `${Math.round(diffDays)}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDateTime(date: Date | null): string {
  if (!date) return 'Never';
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatMinutes(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round((minutes / 60) * 10) / 10;
  return `${hours} hr`;
}

function statusColor(status: string): string {
  if (['healthy', 'active', 'running', 'ok'].includes(status)) return COLORS.success;
  if (['degraded', 'unknown', 'unreachable'].includes(status)) return COLORS.warning;
  return COLORS.danger;
}

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ').toUpperCase();
}

function buildMetricCard(label: string, value: string, sublabel: string, color = COLORS.text): string {
  return `
    <div style="flex: 1; min-width: 150px; text-align: center; padding: 12px; background: ${COLORS.cardBg}; border-radius: 8px; border: 1px solid ${COLORS.border};">
      <div style="font-size: 24px; font-weight: bold; color: ${color};">${escapeHtml(value)}</div>
      <div style="font-size: 12px; color: ${COLORS.text}; font-weight: 600; margin-top: 4px;">${escapeHtml(label)}</div>
      <div style="font-size: 11px; color: ${COLORS.muted}; margin-top: 2px;">${escapeHtml(sublabel)}</div>
    </div>
  `;
}

function buildSectionShell(title: string, subtitle: string, body: string): string {
  return `
    <div style="background: ${COLORS.white}; border-radius: 8px; overflow: hidden; margin-bottom: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
      <div style="background: ${COLORS.cardBg}; padding: 12px 16px; border-bottom: 1px solid ${COLORS.border};">
        <h3 style="margin: 0; font-size: 16px; color: ${COLORS.text};">${escapeHtml(title)}</h3>
        <p style="margin: 4px 0 0 0; font-size: 12px; color: ${COLORS.muted};">${escapeHtml(subtitle)}</p>
      </div>
      <div style="padding: 16px;">
        ${body}
      </div>
    </div>
  `;
}

async function getActivityStats(): Promise<ActivityStats> {
  try {
    const [summaryResult, loopsResult, failuresResult] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')::int AS events_24h,
          COUNT(*) FILTER (
            WHERE created_at > NOW() - INTERVAL '24 hours'
              AND status IN ('failed', 'blocked', 'error')
          )::int AS failed_24h,
          MAX(created_at) AS last_event_at
        FROM squire_activity_events
      `),
      pool.query(`
        SELECT
          source_loop,
          COUNT(*)::int AS count,
          COUNT(*) FILTER (WHERE status IN ('failed', 'blocked', 'error'))::int AS failed
        FROM squire_activity_events
        WHERE created_at > NOW() - INTERVAL '24 hours'
        GROUP BY source_loop
        ORDER BY count DESC, source_loop ASC
        LIMIT 8
      `),
      pool.query(`
        SELECT source_loop, event_type, summary, created_at
        FROM squire_activity_events
        WHERE created_at > NOW() - INTERVAL '24 hours'
          AND status IN ('failed', 'blocked', 'error')
        ORDER BY created_at DESC
        LIMIT 5
      `),
    ]);

    const summary = summaryResult.rows[0] || {};
    return {
      available: true,
      events24h: toInt(summary.events_24h),
      failed24h: toInt(summary.failed_24h),
      lastEventAt: toDate(summary.last_event_at),
      loops: loopsResult.rows.map((row) => ({
        sourceLoop: String(row.source_loop ?? 'unknown'),
        count: toInt(row.count),
        failed: toInt(row.failed),
      })),
      recentFailures: failuresResult.rows.map((row) => ({
        sourceLoop: String(row.source_loop ?? 'unknown'),
        eventType: String(row.event_type ?? 'unknown'),
        summary: String(row.summary ?? ''),
        createdAt: toDate(row.created_at) ?? new Date(),
      })),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      available: false,
      events24h: 0,
      failed24h: 0,
      lastEventAt: null,
      loops: [],
      recentFailures: [],
      error: message,
    };
  }
}

function renderServiceTable(services: ServiceHealth[], endpoints: EndpointHealth[]): string {
  const serviceRows = services.map((service) => `
    <tr>
      <td style="padding: 9px 12px; border-bottom: 1px solid ${COLORS.border}; font-weight: 600;">${escapeHtml(service.name)}</td>
      <td style="padding: 9px 12px; border-bottom: 1px solid ${COLORS.border}; color: ${statusColor(service.status)}; font-weight: 700;">${statusLabel(service.status)}</td>
      <td style="padding: 9px 12px; border-bottom: 1px solid ${COLORS.border}; color: ${COLORS.muted};">${escapeHtml(service.error ?? '')}</td>
    </tr>
  `).join('');

  const endpointRows = endpoints.map((endpoint) => `
    <tr>
      <td style="padding: 9px 12px; border-bottom: 1px solid ${COLORS.border}; font-weight: 600;">${escapeHtml(endpoint.url)}</td>
      <td style="padding: 9px 12px; border-bottom: 1px solid ${COLORS.border}; color: ${statusColor(endpoint.status)}; font-weight: 700;">${statusLabel(endpoint.status)}</td>
      <td style="padding: 9px 12px; border-bottom: 1px solid ${COLORS.border}; color: ${COLORS.muted};">
        ${endpoint.responseTime !== undefined ? `${endpoint.responseTime}ms` : ''}
        ${endpoint.error ? ` ${escapeHtml(endpoint.error)}` : ''}
      </td>
    </tr>
  `).join('');

  return buildSectionShell(
    'Runtime Checks',
    'Systemd services and health endpoints Steward can see right now',
    `
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        <thead>
          <tr style="background: ${COLORS.cardBg};">
            <th style="padding: 8px 12px; text-align: left; color: ${COLORS.muted}; font-size: 11px; text-transform: uppercase;">Target</th>
            <th style="padding: 8px 12px; text-align: left; color: ${COLORS.muted}; font-size: 11px; text-transform: uppercase;">Status</th>
            <th style="padding: 8px 12px; text-align: left; color: ${COLORS.muted}; font-size: 11px; text-transform: uppercase;">Detail</th>
          </tr>
        </thead>
        <tbody>
          ${serviceRows}
          ${endpointRows}
        </tbody>
      </table>
    `
  );
}

function renderSchedulerStatus(activity: ActivityStats): string {
  const courierStats = getCourierStats();
  const communeStats = getCommuneStats();
  const courierRunning = isCourierRunning();
  const communeRunning = isCommuneRunning();

  return buildSectionShell(
    'Autonomous Loops',
    'Courier delivery cadence, Commune outreach, and recent activity volume',
    `
      <div style="display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 16px;">
        ${buildMetricCard('Courier', courierRunning ? 'Running' : 'Stopped', `Every ${formatMinutes(config.courier.intervalMs)}`, courierRunning ? COLORS.success : COLORS.warning)}
        ${buildMetricCard('Courier Ticks', String(courierStats.ticks), `last ${formatDate(courierStats.lastTickAt)}`, COLORS.accent)}
        ${buildMetricCard('Courier Errors', String(courierStats.errors), `${courierStats.skippedQuietHours} quiet-hour skips`, courierStats.errors > 0 ? COLORS.warning : COLORS.success)}
        ${buildMetricCard('Commune', communeRunning ? 'Running' : 'Stopped', config.commune.enabled ? `Every ${formatMinutes(config.commune.intervalMs)}` : 'disabled', communeRunning ? COLORS.success : COLORS.muted)}
        ${buildMetricCard('Commune Sent', String(communeStats.sent), `${communeStats.skipped} skipped`, COLORS.accent)}
        ${buildMetricCard('Activity 24h', String(activity.events24h), `${activity.failed24h} failed`, activity.failed24h > 0 ? COLORS.warning : COLORS.success)}
      </div>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; font-size: 13px;">
        <div style="background: ${COLORS.cardBg}; border: 1px solid ${COLORS.border}; border-radius: 8px; padding: 12px;">
          <div style="font-size: 11px; color: ${COLORS.muted}; text-transform: uppercase; margin-bottom: 4px;">Last Courier Tick</div>
          <div style="color: ${COLORS.text};">${escapeHtml(formatDateTime(courierStats.lastTickAt))}</div>
        </div>
        <div style="background: ${COLORS.cardBg}; border: 1px solid ${COLORS.border}; border-radius: 8px; padding: 12px;">
          <div style="font-size: 11px; color: ${COLORS.muted}; text-transform: uppercase; margin-bottom: 4px;">Last Commune Send</div>
          <div style="color: ${COLORS.text};">${escapeHtml(formatDateTime(communeStats.lastSentAt))}</div>
        </div>
        <div style="background: ${COLORS.cardBg}; border: 1px solid ${COLORS.border}; border-radius: 8px; padding: 12px;">
          <div style="font-size: 11px; color: ${COLORS.muted}; text-transform: uppercase; margin-bottom: 4px;">Last Activity Event</div>
          <div style="color: ${COLORS.text};">${escapeHtml(formatDateTime(activity.lastEventAt))}</div>
        </div>
      </div>
    `
  );
}

function renderActivitySurface(activity: ActivityStats): string {
  if (!activity.available) {
    return buildSectionShell(
      'Activity Surface',
      'Recent autonomous work and failed events',
      `
        <div style="background: ${COLORS.warning}10; border: 1px solid ${COLORS.warning}30; border-radius: 8px; padding: 14px; color: ${COLORS.text};">
          Activity events are not available: ${escapeHtml(activity.error ?? 'unknown error')}
        </div>
      `
    );
  }

  const loopBadges = activity.loops.length
    ? activity.loops.map((loop) => `
        <span style="display: inline-block; padding: 5px 9px; border-radius: 999px; background: ${COLORS.cardBg}; border: 1px solid ${COLORS.border}; font-size: 12px; color: ${COLORS.text}; margin: 0 6px 6px 0;">
          ${escapeHtml(loop.sourceLoop)}: ${loop.count}${loop.failed > 0 ? `, ${loop.failed} failed` : ''}
        </span>
      `).join('')
    : `<span style="font-size: 13px; color: ${COLORS.muted};">No activity events recorded in the last 24 hours.</span>`;

  const failures = activity.recentFailures.length
    ? activity.recentFailures.map((failure) => `
        <div style="border-left: 3px solid ${COLORS.warning}; padding: 8px 10px; margin-bottom: 8px; background: ${COLORS.warning}08;">
          <div style="font-size: 12px; color: ${COLORS.muted};">${escapeHtml(failure.sourceLoop)} / ${escapeHtml(failure.eventType)} / ${escapeHtml(formatDate(failure.createdAt))}</div>
          <div style="font-size: 13px; color: ${COLORS.text};">${escapeHtml(failure.summary)}</div>
        </div>
      `).join('')
    : `<div style="font-size: 13px; color: ${COLORS.muted};">No failed activity events in the last 24 hours.</div>`;

  return buildSectionShell(
    'Activity Surface',
    'Which loops are doing work, and what failed recently',
    `
      <div style="margin-bottom: 14px;">
        <div style="font-size: 11px; color: ${COLORS.muted}; text-transform: uppercase; margin-bottom: 6px;">Loop Mix, Last 24 Hours</div>
        ${loopBadges}
      </div>
      <div>
        <div style="font-size: 11px; color: ${COLORS.muted}; text-transform: uppercase; margin-bottom: 6px;">Recent Failures</div>
        ${failures}
      </div>
    `
  );
}

function renderRecentErrors(errors: ErrorEntry[]): string {
  const body = errors.length
    ? errors.slice(0, 6).map((error) => `
        <div style="border-left: 3px solid ${COLORS.danger}; padding: 8px 10px; margin-bottom: 8px; background: ${COLORS.danger}08;">
          <div style="font-size: 12px; color: ${COLORS.muted};">${escapeHtml(error.source)} / ${escapeHtml(formatDate(error.timestamp))}</div>
          <div style="font-size: 13px; color: ${COLORS.text};">${escapeHtml(error.message.substring(0, 280))}${error.message.length > 280 ? '...' : ''}</div>
        </div>
      `).join('')
    : `<div style="font-size: 13px; color: ${COLORS.muted};">No recent log errors surfaced by Steward.</div>`;

  return buildSectionShell(
    'Recent Log Errors',
    'Top recent errors from Mandrel and the Squire service journal',
    body
  );
}

function buildAlerts(
  status: string,
  services: ServiceHealth[],
  endpoints: EndpointHealth[],
  activity: ActivityStats
): string[] {
  const alerts: string[] = [];

  if (status !== 'healthy') {
    alerts.push(`Squire operational health is ${status}`);
  }

  for (const service of services) {
    if (['inactive', 'failed'].includes(service.status)) {
      alerts.push(`${service.name} service is ${service.status}`);
    }
  }

  for (const endpoint of endpoints) {
    if (endpoint.status !== 'healthy') {
      alerts.push(`${endpoint.url} is ${endpoint.status}`);
    }
  }

  if (config.courier.enabled && !isCourierRunning()) {
    alerts.push('Courier scheduler is enabled but not running');
  }

  const communeStats = getCommuneStats();
  if (communeStats.errors > 0) {
    alerts.push(`Commune scheduler has ${communeStats.errors} recorded error${communeStats.errors === 1 ? '' : 's'}`);
  }

  if (!activity.available) {
    alerts.push('Activity surface could not be loaded');
  } else if (activity.failed24h > 0) {
    alerts.push(`${activity.failed24h} failed activity event${activity.failed24h === 1 ? '' : 's'} in the last 24 hours`);
  }

  return alerts;
}

export const squireHealthModule: BriefModule = {
  title: 'Squire Health',

  async render(): Promise<ModuleResult> {
    try {
      const [health, activity] = await Promise.all([
        getStewardSystemHealth(),
        getActivityStats(),
      ]);

      const activeServices = health.services.filter((service) => service.status === 'active').length;
      const healthyEndpoints = health.endpoints.filter((endpoint) => endpoint.status === 'healthy').length;
      const courierStats = getCourierStats();
      const alerts = buildAlerts(health.status, health.services, health.endpoints, activity);
      const summaryItems = [
        `Squire health is ${health.status}`,
        `${activeServices}/${health.services.length} services active`,
        `${healthyEndpoints}/${health.endpoints.length} endpoints healthy`,
        `Courier last tick: ${formatDate(courierStats.lastTickAt)}`,
        `Activity last 24h: ${activity.events24h} events, ${activity.failed24h} failed`,
      ];

      const html = `
        <div style="margin-bottom: 18px;">
          <div style="display: flex; gap: 16px; flex-wrap: wrap;">
            ${buildMetricCard('Overall', statusLabel(health.status), `checked ${formatDate(health.checkedAt)}`, statusColor(health.status))}
            ${buildMetricCard('Services', `${activeServices}/${health.services.length}`, 'active systemd services', activeServices === health.services.length ? COLORS.success : COLORS.warning)}
            ${buildMetricCard('Endpoints', `${healthyEndpoints}/${health.endpoints.length}`, 'healthy HTTP checks', healthyEndpoints === health.endpoints.length ? COLORS.success : COLORS.warning)}
            ${buildMetricCard('Log Errors', String(health.recentErrors.length), 'recent surfaced errors', health.recentErrors.length > 0 ? COLORS.warning : COLORS.success)}
          </div>
        </div>
        ${renderServiceTable(health.services, health.endpoints)}
        ${renderSchedulerStatus(activity)}
        ${renderActivitySurface(activity)}
        ${renderRecentErrors(health.recentErrors)}
      `;

      return {
        title: 'Squire Health',
        html,
        hasData: true,
        alerts: alerts.length > 0 ? alerts : undefined,
        summaryItems,
      };
    } catch (error) {
      console.error('[SquireHealth] Error rendering module:', error);

      return {
        title: 'Squire Health',
        html: `
          <div style="background: ${COLORS.danger}10; border: 1px solid ${COLORS.danger}; border-radius: 8px; padding: 16px; color: ${COLORS.danger};">
            <strong>Error loading Squire health data:</strong><br>
            ${escapeHtml(error instanceof Error ? error.message : 'Unknown error')}
          </div>
        `,
        hasData: false,
        alerts: ['Failed to load Squire health data'],
      };
    }
  },
};
