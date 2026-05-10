/**
 * Memory Health Module for Daily Brief
 *
 * Operator-facing report on memory/continuity health:
 * - table freshness and pipeline activity
 * - continuity performance and follow-up backlog
 * - support-belief diagnostics
 * - current active threads
 * - recent state snapshots and trends
 * - broader memory pipeline health
 */

import { pool } from '../../../db/pool.js';
import type {
  BriefModule,
  ModuleResult,
  ThreadRow,
  StateSnapshotRow,
  TrendSummaryRow,
  PipelineStats,
  PipelineTableStat,
  SupportBeliefStats,
  SupportBeliefBreakdownRow,
  ContinuityPerformanceStats,
  ContinuityEventBreakdownRow,
  SystemHealthStats,
} from '../types.js';

const COLORS = {
  headerBg: '#1a1a2e',
  accent: '#4f8ef7',
  success: '#22c55e',
  warning: '#f59e0b',
  danger: '#ef4444',
  text: '#1f2937',
  muted: '#6b7280',
  cardBg: '#f9fafb',
  white: '#ffffff',
  border: '#e5e7eb',
  info: '#0ea5e9',
  pink: '#ec4899',
};

function formatDate(date: Date | null): string {
  if (!date) return 'Never';
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (diffHours < 1) return 'Just now';
  if (diffHours < 24) return `${Math.round(diffHours)}h ago`;
  if (diffDays < 7) return `${Math.round(diffDays)}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDateTime(date: Date | null): string {
  if (!date) return 'Never';
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDecimal(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '—';
  return value.toFixed(1);
}

function toInt(value: unknown): number {
  if (typeof value === 'number') return value;
  const parsed = parseInt(String(value ?? '0'), 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function toFloat(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = parseFloat(String(value));
  return Number.isNaN(parsed) ? null : parsed;
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function getStatusIndicator(
  hasData: boolean,
  lastActivity: Date | null,
  staleThresholdHours: number
): { icon: string; color: string; status: string } {
  if (!hasData) {
    return { icon: '✗', color: COLORS.danger, status: 'Empty' };
  }

  if (!lastActivity) {
    return { icon: '⚠', color: COLORS.warning, status: 'No activity' };
  }

  const hoursAgo = (Date.now() - lastActivity.getTime()) / (1000 * 60 * 60);
  if (hoursAgo <= staleThresholdHours) {
    return { icon: '✓', color: COLORS.success, status: 'Fresh' };
  }

  return { icon: '⚠', color: COLORS.warning, status: 'Stale' };
}

function getTrendArrow(
  trend: number | string | null | unknown,
  positiveIsGood = true
): { arrow: string; color: string } {
  if (trend === null || trend === undefined) return { arrow: '—', color: COLORS.muted };

  if (typeof trend === 'number') {
    if (trend === 0) return { arrow: '→', color: COLORS.muted };
    if (trend > 0) {
      return positiveIsGood
        ? { arrow: '↑', color: COLORS.success }
        : { arrow: '↑', color: COLORS.danger };
    }
    return positiveIsGood
      ? { arrow: '↓', color: COLORS.danger }
      : { arrow: '↓', color: COLORS.success };
  }

  if (typeof trend !== 'string') return { arrow: '→', color: COLORS.muted };

  const normalized = trend.toLowerCase();
  if (normalized.includes('stable')) return { arrow: '→', color: COLORS.muted };
  if (normalized.includes('improv') || normalized.includes('down')) {
    return positiveIsGood
      ? { arrow: '↑', color: COLORS.success }
      : { arrow: '↓', color: COLORS.success };
  }
  if (normalized.includes('worsen') || normalized.includes('up') || normalized.includes('declin')) {
    return positiveIsGood
      ? { arrow: '↓', color: COLORS.danger }
      : { arrow: '↑', color: COLORS.danger };
  }
  return { arrow: '→', color: COLORS.muted };
}

function buildMetricCard(
  label: string,
  value: string,
  sublabel: string,
  color: string = COLORS.text
): string {
  return `
    <div style="flex: 1; min-width: 140px; text-align: center; padding: 12px; background: ${COLORS.cardBg}; border-radius: 8px; border: 1px solid ${COLORS.border};">
      <div style="font-size: 26px; font-weight: bold; color: ${color};">${value}</div>
      <div style="font-size: 12px; color: ${COLORS.text}; font-weight: 600; margin-top: 4px;">${label}</div>
      <div style="font-size: 11px; color: ${COLORS.muted}; margin-top: 2px;">${sublabel}</div>
    </div>
  `;
}

function buildSectionShell(title: string, subtitle: string, body: string): string {
  return `
    <div style="background: ${COLORS.white}; border-radius: 8px; overflow: hidden; margin-bottom: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
      <div style="background: ${COLORS.cardBg}; padding: 12px 16px; border-bottom: 1px solid ${COLORS.border};">
        <h3 style="margin: 0; font-size: 16px; color: ${COLORS.text};">${title}</h3>
        <p style="margin: 4px 0 0 0; font-size: 12px; color: ${COLORS.muted};">${subtitle}</p>
      </div>
      <div style="padding: 16px;">
        ${body}
      </div>
    </div>
  `;
}

function formatBeliefType(type: string): string {
  return type
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatThreadType(type: string): string {
  return type
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function getThreadTypeColor(type: string): string {
  const colors: Record<string, string> = {
    project: '#3b82f6',
    work_pressure: '#6366f1',
    family: '#f97316',
    health: '#22c55e',
    relationship: '#8b5cf6',
    identity: '#0ea5e9',
    emotional_load: '#ec4899',
    logistics: '#64748b',
    goal: '#f59e0b',
  };
  return colors[type] || COLORS.muted;
}

function formatRecentActivity(row: PipelineTableStat): string {
  if (row.recent24h > 0) return `${row.recent24h} in 24h`;
  if (row.recent7d > 0) return `${row.recent7d} in 7d`;
  return '0 recent';
}

async function getPipelineStats(): Promise<PipelineStats> {
  const [threadsResult, snapshotsResult, trendsResult, beliefsResult, eventsResult, memoriesResult] =
    await Promise.all([
      pool.query(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'active')::int AS active,
          COUNT(*) FILTER (WHERE status = 'watching')::int AS watching,
          COUNT(*) FILTER (WHERE status = 'dormant')::int AS dormant,
          COUNT(*) FILTER (WHERE status = 'resolved')::int AS resolved,
          MAX(updated_at) AS last_activity,
          COUNT(*) FILTER (WHERE updated_at > NOW() - INTERVAL '24 hours')::int AS recent_24h,
          COUNT(*) FILTER (WHERE updated_at > NOW() - INTERVAL '7 days')::int AS recent_7d
        FROM continuity_threads
      `),
      pool.query(`
        SELECT
          COUNT(*)::int AS total,
          MAX(created_at) AS last_activity,
          MAX(period_end) AS latest_period_end,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')::int AS recent_24h,
          COUNT(*) FILTER (WHERE period_end > NOW() - INTERVAL '7 days')::int AS recent_7d
        FROM state_snapshots
      `),
      pool.query(`
        SELECT
          COUNT(*)::int AS total,
          MAX(created_at) AS last_activity,
          MAX(period_end) AS latest_period_end,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')::int AS recent_24h,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')::int AS recent_7d
        FROM trend_summaries
      `),
      pool.query(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'active' AND confidence >= 0.6)::int AS surfaceable,
          MAX(updated_at) AS last_activity,
          COUNT(*) FILTER (WHERE updated_at > NOW() - INTERVAL '24 hours')::int AS recent_24h,
          COUNT(*) FILTER (WHERE updated_at > NOW() - INTERVAL '7 days')::int AS recent_7d
        FROM beliefs
        WHERE belief_type IN ('support_preference','trigger_sensitivity','protective_priority','vulnerability_theme')
      `),
      pool.query(`
        SELECT
          COUNT(*)::int AS total,
          MAX(created_at) AS last_activity,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')::int AS recent_24h,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')::int AS recent_7d
        FROM continuity_events
      `),
      pool.query(`
        SELECT
          COUNT(*)::int AS total,
          MAX(created_at) AS last_activity,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')::int AS recent_24h,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')::int AS recent_7d,
          COUNT(*) FILTER (WHERE processing_status = 'pending')::int AS pending_processing
        FROM memories
      `),
    ]);

  const threads = threadsResult.rows[0] || {};
  const snapshots = snapshotsResult.rows[0] || {};
  const trends = trendsResult.rows[0] || {};
  const beliefs = beliefsResult.rows[0] || {};
  const events = eventsResult.rows[0] || {};
  const memories = memoriesResult.rows[0] || {};

  const tables: PipelineTableStat[] = [
    {
      key: 'continuity_threads',
      label: 'Continuity Threads',
      total: toInt(threads.total),
      recent24h: toInt(threads.recent_24h),
      recent7d: toInt(threads.recent_7d),
      lastActivity: toDate(threads.last_activity),
      staleThresholdHours: 72,
      detail: `${toInt(threads.active)} active, ${toInt(threads.watching)} watching, ${toInt(threads.dormant)} dormant, ${toInt(threads.resolved)} resolved`,
    },
    {
      key: 'state_snapshots',
      label: 'State Snapshots',
      total: toInt(snapshots.total),
      recent24h: toInt(snapshots.recent_24h),
      recent7d: toInt(snapshots.recent_7d),
      lastActivity: toDate(snapshots.last_activity),
      staleThresholdHours: 36,
      detail: `Latest period end ${formatDateTime(toDate(snapshots.latest_period_end))}`,
    },
    {
      key: 'trend_summaries',
      label: 'Trend Summaries',
      total: toInt(trends.total),
      recent24h: toInt(trends.recent_24h),
      recent7d: toInt(trends.recent_7d),
      lastActivity: toDate(trends.last_activity),
      staleThresholdHours: 24 * 8,
      detail: `Latest period end ${formatDateTime(toDate(trends.latest_period_end))}`,
    },
    {
      key: 'support_beliefs',
      label: 'Support Beliefs',
      total: toInt(beliefs.total),
      recent24h: toInt(beliefs.recent_24h),
      recent7d: toInt(beliefs.recent_7d),
      lastActivity: toDate(beliefs.last_activity),
      staleThresholdHours: 24 * 14,
      detail: `${toInt(beliefs.surfaceable)} surfaceable at active + confidence ≥ 0.6`,
    },
    {
      key: 'continuity_events',
      label: 'Continuity Events',
      total: toInt(events.total),
      recent24h: toInt(events.recent_24h),
      recent7d: toInt(events.recent_7d),
      lastActivity: toDate(events.last_activity),
      staleThresholdHours: 48,
      detail: 'Thread change and follow-up audit trail',
    },
    {
      key: 'memories',
      label: 'Memories',
      total: toInt(memories.total),
      recent24h: toInt(memories.recent_24h),
      recent7d: toInt(memories.recent_7d),
      lastActivity: toDate(memories.last_activity),
      staleThresholdHours: 48,
      detail: `${toInt(memories.pending_processing)} pending processing`,
    },
  ];

  return { tables };
}

async function getSupportBeliefStats(): Promise<SupportBeliefStats> {
  const [summaryResult, breakdownResult] = await Promise.all([
    pool.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'active')::int AS active_total,
        COUNT(*) FILTER (WHERE status = 'active' AND confidence >= 0.6)::int AS surfaceable_total,
        MAX(updated_at) AS last_updated
      FROM beliefs
      WHERE belief_type IN ('support_preference','trigger_sensitivity','protective_priority','vulnerability_theme')
    `),
    pool.query(`
      SELECT
        belief_type,
        status,
        COUNT(*)::int AS count,
        ROUND(AVG(confidence)::numeric, 2) AS avg_confidence,
        COUNT(*) FILTER (WHERE status = 'active' AND confidence >= 0.6)::int AS surfaceable,
        MAX(updated_at) AS last_updated
      FROM beliefs
      WHERE belief_type IN ('support_preference','trigger_sensitivity','protective_priority','vulnerability_theme')
      GROUP BY belief_type, status
      ORDER BY belief_type, status
    `),
  ]);

  const summary = summaryResult.rows[0] || {};
  const breakdown: SupportBeliefBreakdownRow[] = breakdownResult.rows.map((row) => ({
    beliefType: String(row.belief_type),
    status: String(row.status),
    count: toInt(row.count),
    avgConfidence: toFloat(row.avg_confidence),
    surfaceable: toInt(row.surfaceable),
    lastUpdated: toDate(row.last_updated),
  }));

  return {
    total: toInt(summary.total),
    active: toInt(summary.active_total),
    surfaceable: toInt(summary.surfaceable_total),
    lastUpdated: toDate(summary.last_updated),
    breakdown,
  };
}

async function getContinuityPerformance(): Promise<ContinuityPerformanceStats> {
  const [threadsResult, eventsResult, breakdownResult] = await Promise.all([
    pool.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'active')::int AS active,
        COUNT(*) FILTER (WHERE status = 'watching')::int AS watching,
        COUNT(*) FILTER (WHERE status = 'dormant')::int AS dormant,
        COUNT(*) FILTER (WHERE status = 'resolved')::int AS resolved,
        COUNT(*) FILTER (WHERE status = 'archived')::int AS archived,
        COUNT(*) FILTER (WHERE updated_at > NOW() - INTERVAL '24 hours')::int AS updated_24h,
        COUNT(*) FILTER (WHERE updated_at > NOW() - INTERVAL '7 days')::int AS updated_7d,
        COUNT(*) FILTER (
          WHERE status IN ('active','watching')
            AND followup_after IS NOT NULL
            AND followup_after <= NOW()
        )::int AS followup_due,
        COUNT(*) FILTER (
          WHERE status IN ('active','watching')
            AND COALESCE(last_discussed_at, updated_at, created_at) < NOW() - INTERVAL '14 days'
        )::int AS stale_active,
        COUNT(*) FILTER (WHERE resolved_at > NOW() - INTERVAL '7 days')::int AS resolved_7d
      FROM continuity_threads
    `),
    pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')::int AS events_24h,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')::int AS events_7d,
        MAX(created_at) AS last_event_at
      FROM continuity_events
    `),
    pool.query(`
      SELECT event_type, COUNT(*)::int AS count
      FROM continuity_events
      WHERE created_at > NOW() - INTERVAL '7 days'
      GROUP BY event_type
      ORDER BY count DESC, event_type ASC
      LIMIT 6
    `),
  ]);

  const threads = threadsResult.rows[0] || {};
  const events = eventsResult.rows[0] || {};
  const eventBreakdown: ContinuityEventBreakdownRow[] = breakdownResult.rows.map((row) => ({
    eventType: String(row.event_type),
    count: toInt(row.count),
  }));

  return {
    total: toInt(threads.total),
    active: toInt(threads.active),
    watching: toInt(threads.watching),
    dormant: toInt(threads.dormant),
    resolved: toInt(threads.resolved),
    archived: toInt(threads.archived),
    updated24h: toInt(threads.updated_24h),
    updated7d: toInt(threads.updated_7d),
    followupDue: toInt(threads.followup_due),
    staleActive: toInt(threads.stale_active),
    resolved7d: toInt(threads.resolved_7d),
    events24h: toInt(events.events_24h),
    events7d: toInt(events.events_7d),
    lastEventAt: toDate(events.last_event_at),
    eventBreakdown,
  };
}

async function getActiveThreads(): Promise<ThreadRow[]> {
  const result = await pool.query<ThreadRow>(`
    SELECT title, thread_type, status, importance, emotional_weight,
           current_state_summary, last_discussed_at, next_followup_question,
           followup_after
    FROM continuity_threads
    WHERE status IN ('active', 'watching')
    ORDER BY importance DESC, emotional_weight DESC
    LIMIT 10
  `);
  return result.rows;
}

async function getStateSnapshots(): Promise<StateSnapshotRow[]> {
  const result = await pool.query<StateSnapshotRow>(`
    SELECT period_end, created_at, stress_level, energy_level, motivation_level,
           emotional_tone, narrative_summary, dominant_pressures, dominant_energizers,
           memories_analyzed, open_loop_count, threads_active
    FROM state_snapshots
    WHERE period_type = 'daily'
    ORDER BY period_end DESC
    LIMIT 7
  `);
  return result.rows;
}

async function getTrendSummaries(): Promise<TrendSummaryRow[]> {
  const result = await pool.query<TrendSummaryRow>(`
    SELECT period_type, period_end, stress_trend, energy_trend, motivation_trend,
           avg_stress, avg_energy, avg_motivation, narrative,
           threads_opened, threads_resolved, threads_stagnant
    FROM trend_summaries
    ORDER BY period_end DESC, period_type ASC
    LIMIT 6
  `);
  return result.rows;
}

async function getSystemHealth(): Promise<SystemHealthStats> {
  const [memoriesResult, snapshotsResult, trendsResult] = await Promise.all([
    pool.query(`
      SELECT
        COUNT(*)::int AS total_memories,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')::int AS last_7_days,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')::int AS last_24_hours,
        MAX(created_at) AS latest_memory_at,
        COUNT(*) FILTER (WHERE processing_status = 'pending')::int AS pending_processing
      FROM memories
    `),
    pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')::int AS snapshots_created_24h,
        MAX(created_at) AS latest_snapshot_at,
        AVG(memories_analyzed)::numeric(10,2) AS avg_memories_analyzed,
        AVG(open_loop_count)::numeric(10,2) AS avg_open_loops,
        AVG(threads_active)::numeric(10,2) AS avg_threads_active
      FROM state_snapshots
    `),
    pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')::int AS trends_created_7d,
        MAX(created_at) AS latest_trend_at
      FROM trend_summaries
    `),
  ]);

  const memories = memoriesResult.rows[0] || {};
  const snapshots = snapshotsResult.rows[0] || {};
  const trends = trendsResult.rows[0] || {};

  return {
    totalMemories: toInt(memories.total_memories),
    last7Days: toInt(memories.last_7_days),
    last24Hours: toInt(memories.last_24_hours),
    latestMemoryAt: toDate(memories.latest_memory_at),
    pendingProcessing: toInt(memories.pending_processing),
    snapshotsCreated24h: toInt(snapshots.snapshots_created_24h),
    latestSnapshotAt: toDate(snapshots.latest_snapshot_at),
    trendsCreated7d: toInt(trends.trends_created_7d),
    latestTrendAt: toDate(trends.latest_trend_at),
    avgMemoriesAnalyzed: toFloat(snapshots.avg_memories_analyzed),
    avgOpenLoops: toFloat(snapshots.avg_open_loops),
    avgThreadsActive: toFloat(snapshots.avg_threads_active),
  };
}

function generateSparklineSvg(snapshots: StateSnapshotRow[]): string {
  if (snapshots.length === 0) {
    return `
      <div style="text-align: center; padding: 20px; color: ${COLORS.muted};">
        No state snapshots yet — this chart will show stress, energy, and motivation trends over the past week.
      </div>
    `;
  }

  const data = [...snapshots].reverse();
  const width = 400;
  const height = 80;
  const padding = { top: 10, right: 10, bottom: 20, left: 30 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const stressValues = data.map((d) => d.stress_level ?? 5);
  const energyValues = data.map((d) => d.energy_level ?? 5);
  const motivationValues = data.map((d) => d.motivation_level ?? 5);

  const minVal = 1;
  const maxVal = 10;

  const generatePath = (values: number[]): string => {
    const points = values.map((v, i) => {
      const x = padding.left + (i / Math.max(values.length - 1, 1)) * chartWidth;
      const y = padding.top + chartHeight - ((v - minVal) / (maxVal - minVal)) * chartHeight;
      return `${x},${y}`;
    });
    return `M ${points.join(' L ')}`;
  };

  const generateDots = (values: number[], color: string): string => {
    return values
      .map((v, i) => {
        const x = padding.left + (i / Math.max(values.length - 1, 1)) * chartWidth;
        const y = padding.top + chartHeight - ((v - minVal) / (maxVal - minVal)) * chartHeight;
        return `<circle cx="${x}" cy="${y}" r="3" fill="${color}" />`;
      })
      .join('');
  };

  const dayLabels = data
    .map((d, i) => {
      const x = padding.left + (i / Math.max(data.length - 1, 1)) * chartWidth;
      const dayName = new Date(d.period_end).toLocaleDateString('en-US', { weekday: 'short' });
      return `<text x="${x}" y="${height - 2}" text-anchor="middle" font-size="9" fill="${COLORS.muted}">${dayName}</text>`;
    })
    .join('');

  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="display: block; margin: 0 auto;">
      <line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${padding.top + chartHeight}" stroke="${COLORS.border}" stroke-width="1"/>
      <line x1="${padding.left}" y1="${padding.top + chartHeight}" x2="${width - padding.right}" y2="${padding.top + chartHeight}" stroke="${COLORS.border}" stroke-width="1"/>
      <line x1="${padding.left}" y1="${padding.top}" x2="${width - padding.right}" y2="${padding.top}" stroke="${COLORS.border}" stroke-width="0.5" stroke-dasharray="2"/>
      <line x1="${padding.left}" y1="${padding.top + chartHeight / 2}" x2="${width - padding.right}" y2="${padding.top + chartHeight / 2}" stroke="${COLORS.border}" stroke-width="0.5" stroke-dasharray="2"/>
      <text x="${padding.left - 5}" y="${padding.top + 4}" text-anchor="end" font-size="9" fill="${COLORS.muted}">10</text>
      <text x="${padding.left - 5}" y="${padding.top + chartHeight / 2 + 3}" text-anchor="end" font-size="9" fill="${COLORS.muted}">5</text>
      <text x="${padding.left - 5}" y="${padding.top + chartHeight + 3}" text-anchor="end" font-size="9" fill="${COLORS.muted}">1</text>
      <path d="${generatePath(stressValues)}" fill="none" stroke="${COLORS.danger}" stroke-width="2" opacity="0.8"/>
      <path d="${generatePath(energyValues)}" fill="none" stroke="${COLORS.success}" stroke-width="2" opacity="0.8"/>
      <path d="${generatePath(motivationValues)}" fill="none" stroke="${COLORS.accent}" stroke-width="2" opacity="0.8"/>
      ${generateDots(stressValues, COLORS.danger)}
      ${generateDots(energyValues, COLORS.success)}
      ${generateDots(motivationValues, COLORS.accent)}
      ${dayLabels}
    </svg>
    <div style="display: flex; justify-content: center; gap: 20px; margin-top: 8px; font-size: 11px;">
      <span><span style="color: ${COLORS.danger};">●</span> Stress</span>
      <span><span style="color: ${COLORS.success};">●</span> Energy</span>
      <span><span style="color: ${COLORS.accent};">●</span> Motivation</span>
    </div>
  `;
}

function renderPipelineStatus(stats: PipelineStats): string {
  const rows = stats.tables
    .map((row) => {
      const status = getStatusIndicator(row.total > 0, row.lastActivity, row.staleThresholdHours);
      return `
        <tr>
          <td style="padding: 10px 12px; border-bottom: 1px solid ${COLORS.border}; vertical-align: top;">
            <span style="color: ${status.color}; font-weight: bold; margin-right: 8px;">${status.icon}</span>
            <strong>${row.label}</strong>
            <div style="font-size: 11px; color: ${COLORS.muted}; margin-top: 2px;">${status.status}</div>
          </td>
          <td style="padding: 10px 12px; border-bottom: 1px solid ${COLORS.border}; text-align: center; font-weight: 600;">${row.total}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid ${COLORS.border}; color: ${COLORS.text}; font-size: 13px;">${formatRecentActivity(row)}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid ${COLORS.border}; color: ${COLORS.text}; font-size: 13px;">${formatDate(row.lastActivity)}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid ${COLORS.border}; color: ${COLORS.muted}; font-size: 13px;">${row.detail}</td>
        </tr>
      `;
    })
    .join('');

  return buildSectionShell(
    '📡 Memory Pipeline Status',
    'Are the core tables alive, fresh, and actually moving?',
    `
      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        <thead>
          <tr style="background: ${COLORS.cardBg};">
            <th style="padding: 8px 12px; text-align: left; font-weight: 600; color: ${COLORS.muted}; font-size: 12px; text-transform: uppercase;">Table</th>
            <th style="padding: 8px 12px; text-align: center; font-weight: 600; color: ${COLORS.muted}; font-size: 12px; text-transform: uppercase;">Rows</th>
            <th style="padding: 8px 12px; text-align: left; font-weight: 600; color: ${COLORS.muted}; font-size: 12px; text-transform: uppercase;">Recent</th>
            <th style="padding: 8px 12px; text-align: left; font-weight: 600; color: ${COLORS.muted}; font-size: 12px; text-transform: uppercase;">Last Activity</th>
            <th style="padding: 8px 12px; text-align: left; font-weight: 600; color: ${COLORS.muted}; font-size: 12px; text-transform: uppercase;">Notes</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    `
  );
}

function renderContinuityPerformance(stats: ContinuityPerformanceStats): string {
  const breakdown = stats.eventBreakdown.length
    ? stats.eventBreakdown
        .map(
          (event) => `
            <span style="display: inline-block; padding: 4px 8px; border-radius: 999px; background: ${COLORS.cardBg}; border: 1px solid ${COLORS.border}; font-size: 11px; color: ${COLORS.text}; margin: 0 6px 6px 0;">
              ${event.eventType}: ${event.count}
            </span>
          `
        )
        .join('')
    : `<span style="font-size: 12px; color: ${COLORS.muted};">No continuity events in the last 7 days.</span>`;

  return buildSectionShell(
    '🧵 Continuity Performance',
    'Thread mix, backlog, and whether continuity is actively being maintained',
    `
      <div style="display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 16px;">
        ${buildMetricCard('Active', String(stats.active), `${stats.watching} watching`, COLORS.success)}
        ${buildMetricCard('Dormant', String(stats.dormant), `${stats.resolved} resolved`, COLORS.warning)}
        ${buildMetricCard('Updated 24h', String(stats.updated24h), `${stats.updated7d} in 7d`, COLORS.accent)}
        ${buildMetricCard('Follow-ups Due', String(stats.followupDue), `${stats.staleActive} stale active/watching`, stats.followupDue > 0 ? COLORS.warning : COLORS.success)}
        ${buildMetricCard('Events 24h', String(stats.events24h), `${stats.events7d} in 7d`, stats.events24h > 0 ? COLORS.success : COLORS.muted)}
      </div>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-bottom: 12px;">
        <div style="background: ${COLORS.cardBg}; border: 1px solid ${COLORS.border}; border-radius: 8px; padding: 12px;">
          <div style="font-size: 11px; color: ${COLORS.muted}; text-transform: uppercase; margin-bottom: 4px;">Distribution</div>
          <div style="font-size: 13px; color: ${COLORS.text}; line-height: 1.5;">
            ${stats.total} total threads • ${stats.active} active • ${stats.watching} watching • ${stats.dormant} dormant • ${stats.resolved} resolved • ${stats.archived} archived
          </div>
        </div>
        <div style="background: ${COLORS.cardBg}; border: 1px solid ${COLORS.border}; border-radius: 8px; padding: 12px;">
          <div style="font-size: 11px; color: ${COLORS.muted}; text-transform: uppercase; margin-bottom: 4px;">Recent Completion</div>
          <div style="font-size: 13px; color: ${COLORS.text}; line-height: 1.5;">
            ${stats.resolved7d} thread${stats.resolved7d === 1 ? '' : 's'} resolved in the last 7 days.
          </div>
        </div>
        <div style="background: ${COLORS.cardBg}; border: 1px solid ${COLORS.border}; border-radius: 8px; padding: 12px;">
          <div style="font-size: 11px; color: ${COLORS.muted}; text-transform: uppercase; margin-bottom: 4px;">Latest Event</div>
          <div style="font-size: 13px; color: ${COLORS.text}; line-height: 1.5;">
            ${formatDateTime(stats.lastEventAt)}
          </div>
        </div>
      </div>
      <div style="margin-top: 8px;">
        <div style="font-size: 11px; color: ${COLORS.muted}; text-transform: uppercase; margin-bottom: 6px;">Event Mix, Last 7 Days</div>
        ${breakdown}
      </div>
    `
  );
}

function renderSupportBeliefDiagnostics(stats: SupportBeliefStats): string {
  if (stats.total === 0) {
    return buildSectionShell(
      '🫶 Support Belief Diagnostics',
      'Why the support-model section may look empty even when the system is otherwise active',
      `
        <div style="background: ${COLORS.warning}10; border: 1px solid ${COLORS.warning}30; border-radius: 8px; padding: 14px; margin-bottom: 12px;">
          <div style="font-weight: 600; color: ${COLORS.text}; margin-bottom: 6px;">No support beliefs have been extracted yet.</div>
          <div style="font-size: 13px; color: ${COLORS.text}; line-height: 1.6;">
            This is not a rendering bug by itself. The support-belief extractor is intentionally conservative: these belief types start around <strong>0.4 confidence</strong> and only become surfaceable when they are <strong>active</strong> and reach <strong>0.6 confidence</strong> or higher.
          </div>
        </div>
        <div style="font-size: 13px; color: ${COLORS.muted}; line-height: 1.6;">
          Practical read: the table exists, but the pipeline is under-producing data for it right now. Either support beliefs are not being extracted often enough, or they are being extracted too cautiously to become visible.
        </div>
      `
    );
  }

  const rows = stats.breakdown
    .map(
      (row) => `
        <tr>
          <td style="padding: 8px 12px; border-bottom: 1px solid ${COLORS.border};">${formatBeliefType(row.beliefType)}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid ${COLORS.border};">${row.status}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid ${COLORS.border}; text-align: center; font-weight: 600;">${row.count}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid ${COLORS.border}; text-align: center;">${row.avgConfidence !== null ? row.avgConfidence.toFixed(2) : '—'}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid ${COLORS.border}; text-align: center;">${row.surfaceable}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid ${COLORS.border};">${formatDate(row.lastUpdated)}</td>
        </tr>
      `
    )
    .join('');

  return buildSectionShell(
    '🫶 Support Belief Diagnostics',
    'Do we have support-model data, and is any of it actually visible to the assistant?',
    `
      <div style="display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 16px;">
        ${buildMetricCard('Total', String(stats.total), 'support belief rows', COLORS.text)}
        ${buildMetricCard('Active', String(stats.active), 'not superseded or conflicted', COLORS.accent)}
        ${buildMetricCard('Surfaceable', String(stats.surfaceable), 'active + confidence ≥ 0.6', stats.surfaceable > 0 ? COLORS.success : COLORS.warning)}
        ${buildMetricCard('Last Update', formatDate(stats.lastUpdated), 'most recent support-belief activity', COLORS.info)}
      </div>
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        <thead>
          <tr style="background: ${COLORS.cardBg};">
            <th style="padding: 8px 12px; text-align: left; font-weight: 600; color: ${COLORS.muted}; font-size: 12px; text-transform: uppercase;">Belief Type</th>
            <th style="padding: 8px 12px; text-align: left; font-weight: 600; color: ${COLORS.muted}; font-size: 12px; text-transform: uppercase;">Status</th>
            <th style="padding: 8px 12px; text-align: center; font-weight: 600; color: ${COLORS.muted}; font-size: 12px; text-transform: uppercase;">Count</th>
            <th style="padding: 8px 12px; text-align: center; font-weight: 600; color: ${COLORS.muted}; font-size: 12px; text-transform: uppercase;">Avg Conf.</th>
            <th style="padding: 8px 12px; text-align: center; font-weight: 600; color: ${COLORS.muted}; font-size: 12px; text-transform: uppercase;">Surfaceable</th>
            <th style="padding: 8px 12px; text-align: left; font-weight: 600; color: ${COLORS.muted}; font-size: 12px; text-transform: uppercase;">Last Update</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    `
  );
}

function renderActiveThreads(threads: ThreadRow[]): string {
  if (threads.length === 0) {
    return buildSectionShell(
      '🧠 Active Threads',
      'What Squire is currently carrying forward across conversations',
      `<p style="color: ${COLORS.muted}; margin: 0;">No active or watching threads yet.</p>`
    );
  }

  const threadCards = threads
    .map((thread) => {
      const importanceWidth = Math.min((thread.importance / 10) * 100, 100);
      const emotionalWidth = Math.min((thread.emotional_weight / 10) * 100, 100);
      const badgeColor = getThreadTypeColor(thread.thread_type);
      const isFollowupDue = thread.followup_after && new Date(thread.followup_after) <= new Date();

      return `
        <div style="background: ${COLORS.white}; border: 1px solid ${COLORS.border}; border-radius: 8px; padding: 16px; margin-bottom: 12px;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; gap: 12px;">
            <div>
              <span style="display: inline-block; background: ${badgeColor}; color: white; font-size: 10px; padding: 2px 8px; border-radius: 12px; text-transform: uppercase; letter-spacing: 0.5px; margin-right: 8px;">
                ${formatThreadType(thread.thread_type)}
              </span>
              <span style="display: inline-block; background: ${thread.status === 'active' ? COLORS.success : COLORS.warning}20; color: ${thread.status === 'active' ? COLORS.success : COLORS.warning}; font-size: 10px; padding: 2px 8px; border-radius: 12px;">
                ${thread.status}
              </span>
              ${isFollowupDue ? `
                <span style="display: inline-block; background: ${COLORS.warning}20; color: ${COLORS.warning}; font-size: 10px; padding: 2px 8px; border-radius: 12px; margin-left: 8px;">
                  follow-up due
                </span>
              ` : ''}
            </div>
            <span style="color: ${COLORS.muted}; font-size: 12px;">${formatDate(thread.last_discussed_at)}</span>
          </div>

          <h4 style="margin: 0 0 8px 0; font-size: 15px; color: ${COLORS.text};">${thread.title}</h4>

          ${thread.current_state_summary ? `<p style="margin: 0 0 12px 0; color: ${COLORS.muted}; font-size: 13px; line-height: 1.5;">${thread.current_state_summary}</p>` : ''}

          <div style="display: flex; gap: 24px; margin-bottom: 8px;">
            <div style="flex: 1;">
              <div style="font-size: 11px; color: ${COLORS.muted}; margin-bottom: 4px;">Importance</div>
              <div style="background: ${COLORS.cardBg}; border-radius: 4px; height: 8px; overflow: hidden;">
                <div style="background: ${COLORS.accent}; height: 100%; width: ${importanceWidth}%;"></div>
              </div>
            </div>
            <div style="flex: 1;">
              <div style="font-size: 11px; color: ${COLORS.muted}; margin-bottom: 4px;">Emotional Weight</div>
              <div style="background: ${COLORS.cardBg}; border-radius: 4px; height: 8px; overflow: hidden;">
                <div style="background: ${COLORS.pink}; height: 100%; width: ${emotionalWidth}%;"></div>
              </div>
            </div>
          </div>

          ${thread.next_followup_question ? `
            <div style="background: ${COLORS.accent}10; border-left: 3px solid ${COLORS.accent}; padding: 8px 12px; margin-top: 12px; border-radius: 0 4px 4px 0;">
              <div style="font-size: 11px; color: ${COLORS.accent}; font-weight: 600; margin-bottom: 4px;">Follow-up Question</div>
              <div style="font-size: 13px; color: ${COLORS.text};">${thread.next_followup_question}</div>
            </div>
          ` : ''}
        </div>
      `;
    })
    .join('');

  return buildSectionShell(
    '🧠 Active Threads',
    'The top active and watching threads Squire is currently carrying',
    threadCards
  );
}

function renderStateSnapshots(snapshots: StateSnapshotRow[]): string {
  const latestSnapshot = snapshots[0];
  const sparkline = generateSparklineSvg(snapshots);

  const latestSection = latestSnapshot
    ? `
      <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid ${COLORS.border};">
        <div style="display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 12px;">
          ${buildMetricCard('Memories Analyzed', String(latestSnapshot.memories_analyzed ?? '—'), 'latest daily snapshot', COLORS.accent)}
          ${buildMetricCard('Open Loops', String(latestSnapshot.open_loop_count ?? '—'), 'latest daily snapshot', COLORS.warning)}
          ${buildMetricCard('Threads Active', String(latestSnapshot.threads_active ?? '—'), 'captured in latest snapshot', COLORS.success)}
        </div>
        <div style="display: flex; gap: 16px; flex-wrap: wrap;">
          ${latestSnapshot.emotional_tone ? `
            <div style="flex: 1; min-width: 200px;">
              <div style="font-size: 11px; color: ${COLORS.muted}; text-transform: uppercase; margin-bottom: 4px;">Emotional Tone</div>
              <div style="font-size: 14px; color: ${COLORS.text};">${latestSnapshot.emotional_tone}</div>
            </div>
          ` : ''}
          ${latestSnapshot.dominant_pressures && latestSnapshot.dominant_pressures.length > 0 ? `
            <div style="flex: 1; min-width: 200px;">
              <div style="font-size: 11px; color: ${COLORS.muted}; text-transform: uppercase; margin-bottom: 4px;">Current Pressures</div>
              <div style="font-size: 13px; color: ${COLORS.text};">${latestSnapshot.dominant_pressures.join(', ')}</div>
            </div>
          ` : ''}
          ${latestSnapshot.dominant_energizers && latestSnapshot.dominant_energizers.length > 0 ? `
            <div style="flex: 1; min-width: 200px;">
              <div style="font-size: 11px; color: ${COLORS.muted}; text-transform: uppercase; margin-bottom: 4px;">Current Energizers</div>
              <div style="font-size: 13px; color: ${COLORS.text};">${latestSnapshot.dominant_energizers.join(', ')}</div>
            </div>
          ` : ''}
        </div>
        ${latestSnapshot.narrative_summary ? `
          <div style="margin-top: 12px;">
            <div style="font-size: 11px; color: ${COLORS.muted}; text-transform: uppercase; margin-bottom: 4px;">Latest Narrative</div>
            <div style="font-size: 13px; color: ${COLORS.text}; line-height: 1.5;">${latestSnapshot.narrative_summary}</div>
          </div>
        ` : ''}
      </div>
    `
    : '';

  return buildSectionShell(
    '📈 State This Week',
    'Stress, energy, and motivation across the last 7 daily snapshots',
    `${sparkline}${latestSection}`
  );
}

function renderTrendSummaries(trends: TrendSummaryRow[]): string {
  if (trends.length === 0) {
    return buildSectionShell(
      '📊 Trend Intelligence',
      'Longer-range state patterns built from snapshot history',
      `<p style="color: ${COLORS.muted}; margin: 0;">No trend summaries yet.</p>`
    );
  }

  const byPeriod: Record<string, TrendSummaryRow> = {};
  for (const trend of trends) {
    if (!byPeriod[trend.period_type]) {
      byPeriod[trend.period_type] = trend;
    }
  }

  const periodLabels: Record<string, string> = {
    '7day': '7 Day',
    '30day': '30 Day',
    '90day': '90 Day',
  };

  const trendCards = Object.entries(byPeriod)
    .map(([periodType, trend]) => {
      const stressTrend = getTrendArrow(trend.stress_trend, false);
      const energyTrend = getTrendArrow(trend.energy_trend, true);
      const motivationTrend = getTrendArrow(trend.motivation_trend, true);

      return `
        <div style="flex: 1; min-width: 200px; background: ${COLORS.cardBg}; border-radius: 8px; padding: 16px; border: 1px solid ${COLORS.border};">
          <div style="font-size: 14px; font-weight: 600; color: ${COLORS.text}; margin-bottom: 12px;">
            ${periodLabels[periodType] || periodType}
          </div>

          <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-size: 12px; color: ${COLORS.muted};">Stress</span>
              <span style="font-size: 16px; color: ${stressTrend.color}; font-weight: bold;">${stressTrend.arrow}</span>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-size: 12px; color: ${COLORS.muted};">Energy</span>
              <span style="font-size: 16px; color: ${energyTrend.color}; font-weight: bold;">${energyTrend.arrow}</span>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-size: 12px; color: ${COLORS.muted};">Motivation</span>
              <span style="font-size: 16px; color: ${motivationTrend.color}; font-weight: bold;">${motivationTrend.arrow}</span>
            </div>
          </div>

          <div style="border-top: 1px solid ${COLORS.border}; padding-top: 12px; display: flex; gap: 12px; font-size: 11px; flex-wrap: wrap;">
            <div>
              <span style="color: ${COLORS.success};">+${trend.threads_opened ?? 0}</span>
              <span style="color: ${COLORS.muted};"> opened</span>
            </div>
            <div>
              <span style="color: ${COLORS.accent};">✓${trend.threads_resolved ?? 0}</span>
              <span style="color: ${COLORS.muted};"> resolved</span>
            </div>
            ${(trend.threads_stagnant ?? 0) > 0 ? `
              <div>
                <span style="color: ${COLORS.warning};">⚠${trend.threads_stagnant}</span>
                <span style="color: ${COLORS.muted};"> stagnant</span>
              </div>
            ` : ''}
          </div>

          ${trend.narrative ? `
            <div style="margin-top: 12px; font-size: 12px; color: ${COLORS.text}; line-height: 1.4;">
              ${trend.narrative.substring(0, 180)}${trend.narrative.length > 180 ? '...' : ''}
            </div>
          ` : ''}
        </div>
      `;
    })
    .join('');

  return buildSectionShell(
    '📊 Trend Intelligence',
    'How state and thread dynamics are shifting across 7, 30, and 90 day windows',
    `<div style="display: flex; gap: 16px; flex-wrap: wrap;">${trendCards}</div>`
  );
}

function renderSystemHealth(health: SystemHealthStats): string {
  return buildSectionShell(
    '🔧 System Health',
    'Memory intake, backlog, and whether snapshot/trend generation is keeping up',
    `
      <div style="display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 16px;">
        ${buildMetricCard('Total Memories', health.totalMemories.toLocaleString(), `${health.last7Days} in 7d`, COLORS.text)}
        ${buildMetricCard('New Memories', String(health.last24Hours), 'created in last 24h', health.last24Hours > 0 ? COLORS.success : COLORS.muted)}
        ${buildMetricCard('Pending Processing', String(health.pendingProcessing), 'memory backlog', health.pendingProcessing > 0 ? COLORS.warning : COLORS.success)}
        ${buildMetricCard('Snapshots 24h', String(health.snapshotsCreated24h), 'state snapshots generated', health.snapshotsCreated24h > 0 ? COLORS.success : COLORS.warning)}
        ${buildMetricCard('Trends 7d', String(health.trendsCreated7d), 'trend summaries generated', health.trendsCreated7d > 0 ? COLORS.success : COLORS.warning)}
      </div>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px;">
        <div style="background: ${COLORS.cardBg}; border: 1px solid ${COLORS.border}; border-radius: 8px; padding: 12px;">
          <div style="font-size: 11px; color: ${COLORS.muted}; text-transform: uppercase; margin-bottom: 4px;">Latest Memory Activity</div>
          <div style="font-size: 13px; color: ${COLORS.text};">${formatDateTime(health.latestMemoryAt)}</div>
        </div>
        <div style="background: ${COLORS.cardBg}; border: 1px solid ${COLORS.border}; border-radius: 8px; padding: 12px;">
          <div style="font-size: 11px; color: ${COLORS.muted}; text-transform: uppercase; margin-bottom: 4px;">Latest Snapshot</div>
          <div style="font-size: 13px; color: ${COLORS.text};">${formatDateTime(health.latestSnapshotAt)}</div>
        </div>
        <div style="background: ${COLORS.cardBg}; border: 1px solid ${COLORS.border}; border-radius: 8px; padding: 12px;">
          <div style="font-size: 11px; color: ${COLORS.muted}; text-transform: uppercase; margin-bottom: 4px;">Latest Trend Summary</div>
          <div style="font-size: 13px; color: ${COLORS.text};">${formatDateTime(health.latestTrendAt)}</div>
        </div>
      </div>
      <div style="display: flex; gap: 12px; flex-wrap: wrap; margin-top: 12px; font-size: 12px; color: ${COLORS.text};">
        <span style="background: ${COLORS.cardBg}; border: 1px solid ${COLORS.border}; border-radius: 999px; padding: 4px 10px;">Avg memories analyzed per snapshot: ${formatDecimal(health.avgMemoriesAnalyzed)}</span>
        <span style="background: ${COLORS.cardBg}; border: 1px solid ${COLORS.border}; border-radius: 999px; padding: 4px 10px;">Avg open loops per snapshot: ${formatDecimal(health.avgOpenLoops)}</span>
        <span style="background: ${COLORS.cardBg}; border: 1px solid ${COLORS.border}; border-radius: 999px; padding: 4px 10px;">Avg threads active per snapshot: ${formatDecimal(health.avgThreadsActive)}</span>
      </div>
    `
  );
}

function buildAlerts(
  pipeline: PipelineStats,
  support: SupportBeliefStats,
  continuity: ContinuityPerformanceStats,
  systemHealth: SystemHealthStats
): string[] {
  const alerts: string[] = [];

  for (const table of pipeline.tables) {
    const status = getStatusIndicator(table.total > 0, table.lastActivity, table.staleThresholdHours);
    if (status.status === 'Empty' && table.key !== 'support_beliefs') {
      alerts.push(`${table.label} table is empty`);
    } else if (status.status === 'Stale') {
      alerts.push(`${table.label} looks stale — last activity ${formatDate(table.lastActivity)}`);
    }
  }

  if (support.total === 0) {
    alerts.push('Support beliefs are still at zero — diagnostic section added to explain why');
  } else if (support.surfaceable === 0) {
    alerts.push('Support beliefs exist but none are surfaceable at active + confidence ≥ 0.6');
  }

  if (continuity.followupDue > 0) {
    alerts.push(`${continuity.followupDue} continuity follow-up${continuity.followupDue === 1 ? '' : 's'} overdue`);
  }

  if (continuity.staleActive > 0) {
    alerts.push(`${continuity.staleActive} active/watching thread${continuity.staleActive === 1 ? '' : 's'} have gone quiet for 14+ days`);
  }

  if (systemHealth.pendingProcessing > 0) {
    alerts.push(`${systemHealth.pendingProcessing} memories still pending processing`);
  }

  if (systemHealth.trendsCreated7d === 0) {
    alerts.push('No trend summaries generated in the last 7 days');
  }

  return alerts;
}

export const memoryHealthModule: BriefModule = {
  title: 'Memory Health',

  async render(): Promise<ModuleResult> {
    try {
      const [pipeline, support, continuity, activeThreads, stateSnapshots, trendSummaries, systemHealth] =
        await Promise.all([
          getPipelineStats(),
          getSupportBeliefStats(),
          getContinuityPerformance(),
          getActiveThreads(),
          getStateSnapshots(),
          getTrendSummaries(),
          getSystemHealth(),
        ]);

      const alerts = buildAlerts(pipeline, support, continuity, systemHealth);

      const hasData =
        pipeline.tables.some((table) => table.total > 0) ||
        activeThreads.length > 0 ||
        stateSnapshots.length > 0 ||
        trendSummaries.length > 0;

      const html = `
        ${renderPipelineStatus(pipeline)}
        ${renderContinuityPerformance(continuity)}
        ${renderSupportBeliefDiagnostics(support)}
        ${renderActiveThreads(activeThreads)}
        ${renderStateSnapshots(stateSnapshots)}
        ${renderTrendSummaries(trendSummaries)}
        ${renderSystemHealth(systemHealth)}
      `;

      return {
        title: 'Memory Health',
        html,
        hasData,
        alerts: alerts.length > 0 ? alerts : undefined,
      };
    } catch (error) {
      console.error('[MemoryHealth] Error rendering module:', error);

      return {
        title: 'Memory Health',
        html: `
          <div style="background: ${COLORS.danger}10; border: 1px solid ${COLORS.danger}; border-radius: 8px; padding: 16px; color: ${COLORS.danger};">
            <strong>Error loading memory health data:</strong><br>
            ${error instanceof Error ? error.message : 'Unknown error'}
          </div>
        `,
        hasData: false,
        alerts: ['Failed to load memory health data'],
      };
    }
  },
};
