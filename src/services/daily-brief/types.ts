/**
 * Daily Brief Module System Types
 *
 * Each module renders an HTML section for the daily brief email.
 * Modules are designed to be independent and extensible.
 */

export interface BriefModule {
  /** Display title for this module section */
  title: string;

  /** Render the module and return the result */
  render(): Promise<ModuleResult>;
}

export interface ModuleResult {
  /** Display title for the rendered section */
  title: string;

  /** HTML content for this section (inline styles only) */
  html: string;

  /** If false, module shows a "no data yet" placeholder */
  hasData: boolean;

  /** Urgent items to surface at top of email */
  alerts?: string[];

  /** Short operator-facing bullets surfaced in the top summary */
  summaryItems?: string[];
}

export interface ThreadRow {
  title: string;
  thread_type: string;
  status: string;
  importance: number;
  emotional_weight: number;
  current_state_summary: string | null;
  last_discussed_at: Date | null;
  next_followup_question: string | null;
  followup_after: Date | null;
}

export interface StateSnapshotRow {
  period_end: Date;
  created_at: Date;
  stress_level: number | null;
  energy_level: number | null;
  motivation_level: number | null;
  emotional_tone: string | null;
  narrative_summary: string | null;
  dominant_pressures: string[] | null;
  dominant_energizers: string[] | null;
  memories_analyzed: number | null;
  open_loop_count: number | null;
  threads_active: number | null;
}

export interface TrendSummaryRow {
  period_type: string;
  period_end: Date;
  stress_trend: number | string | null;
  energy_trend: number | string | null;
  motivation_trend: number | string | null;
  avg_stress: number | null;
  avg_energy: number | null;
  avg_motivation: number | null;
  narrative: string | null;
  threads_opened: number | null;
  threads_resolved: number | null;
  threads_stagnant: number | null;
}

export interface PipelineTableStat {
  key: string;
  label: string;
  total: number;
  recent24h: number;
  recent7d: number;
  lastActivity: Date | null;
  staleThresholdHours: number;
  detail: string;
}

export interface PipelineStats {
  tables: PipelineTableStat[];
}

export interface SupportBeliefBreakdownRow {
  beliefType: string;
  status: string;
  count: number;
  avgConfidence: number | null;
  surfaceable: number;
  lastUpdated: Date | null;
}

export interface SupportBeliefStats {
  total: number;
  active: number;
  surfaceable: number;
  lastUpdated: Date | null;
  breakdown: SupportBeliefBreakdownRow[];
}

export interface ContinuityEventBreakdownRow {
  eventType: string;
  count: number;
}

export interface ContinuityPerformanceStats {
  total: number;
  active: number;
  watching: number;
  dormant: number;
  resolved: number;
  archived: number;
  updated24h: number;
  updated7d: number;
  followupDue: number;
  staleActive: number;
  resolved7d: number;
  events24h: number;
  events7d: number;
  lastEventAt: Date | null;
  eventBreakdown: ContinuityEventBreakdownRow[];
}

export interface SystemHealthStats {
  totalMemories: number;
  last7Days: number;
  last24Hours: number;
  latestMemoryAt: Date | null;
  pendingProcessing: number;
  snapshotsCreated24h: number;
  latestSnapshotAt: Date | null;
  trendsCreated7d: number;
  latestTrendAt: Date | null;
  avgMemoriesAnalyzed: number | null;
  avgOpenLoops: number | null;
  avgThreadsActive: number | null;
}
