'use client';

import { DashboardPanel, StatsCard, LivingSummaryPanel, TodayPanel, BeliefsPanel, PatternsPanel, EntitiesPanel, InsightsPanel, DetailModal } from '@/components/dashboard';
import {
  useOpenMemoryDetail,
  useOpenBeliefDetail,
  useOpenPatternDetail,
  useOpenEntityDetail,
  useOpenInsightDetail,
  useOpenSummaryDetail,
} from '@/lib/stores';

// Icons as simple SVG components
const icons = {
  brain: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
    </svg>
  ),
  lightbulb: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
    </svg>
  ),
  sparkles: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
    </svg>
  ),
  users: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  ),
  clock: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  heart: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
    </svg>
  ),
  chartBar: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  ),
  document: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  ),
  network: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
    </svg>
  ),
};

export default function DashboardPage() {
  // Detail modal actions
  const openMemory = useOpenMemoryDetail();
  const openBelief = useOpenBeliefDetail();
  const openPattern = useOpenPatternDetail();
  const openEntity = useOpenEntityDetail();
  const openInsight = useOpenInsightDetail();
  const openSummary = useOpenSummaryDetail();

  return (
    <div className="h-full flex flex-col p-6 overflow-auto">
      {/* Detail Modal */}
      <DetailModal />
      {/* Page Header */}
      <div className="mb-6 animate-fade-in">
        <h1 className="text-2xl font-bold text-foreground mb-1">Dashboard</h1>
        <p className="text-foreground-muted text-sm">
          Your memory at a glance — summaries, beliefs, patterns, and insights
        </p>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatsCard
          label="Memories"
          value="--"
          icon={icons.brain}
          accent="primary"
        />
        <StatsCard
          label="Beliefs"
          value="--"
          icon={icons.heart}
          accent="gold"
        />
        <StatsCard
          label="Patterns"
          value="--"
          icon={icons.chartBar}
          accent="purple"
        />
        <StatsCard
          label="Entities"
          value="--"
          icon={icons.users}
          accent="success"
        />
      </div>

      {/* Main Dashboard Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">
        {/* Row 1: Living Summary (2 cols) + Today (1 col) */}
        <DashboardPanel
          title="Living Summary"
          icon={icons.document}
          accent="primary"
          className="lg:col-span-2 min-h-[280px]"
        >
          <LivingSummaryPanel onSummaryClick={openSummary} />
        </DashboardPanel>

        <DashboardPanel
          title="Today"
          icon={icons.clock}
          accent="gold"
          className="min-h-[280px]"
        >
          <TodayPanel onMemoryClick={openMemory} />
        </DashboardPanel>

        {/* Row 2: Beliefs + Patterns + Insights (3 cols) */}
        <DashboardPanel
          title="Beliefs"
          icon={icons.heart}
          accent="gold"
          className="min-h-[260px]"
        >
          <BeliefsPanel onBeliefClick={openBelief} />
        </DashboardPanel>

        <DashboardPanel
          title="Patterns"
          icon={icons.chartBar}
          accent="purple"
          className="min-h-[260px]"
        >
          <PatternsPanel onPatternClick={openPattern} />
        </DashboardPanel>

        <DashboardPanel
          title="Insights"
          icon={icons.lightbulb}
          accent="warning"
          className="min-h-[260px]"
        >
          <InsightsPanel onInsightClick={openInsight} />
        </DashboardPanel>

        {/* Row 3: Entities (full width) */}
        <DashboardPanel
          title="Entities"
          icon={icons.network}
          accent="success"
          className="lg:col-span-3 min-h-[240px]"
        >
          <EntitiesPanel onEntityClick={openEntity} />
        </DashboardPanel>
      </div>
    </div>
  );
}
