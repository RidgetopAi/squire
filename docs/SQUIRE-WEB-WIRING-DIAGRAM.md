# SQUIRE WEB - WIRING DIAGRAM

## Purpose

This document tracks the connections between frontend components and backend APIs.
Update this as we build - it's our source of truth for what's wired and what's not.

**Legend**:
- ✅ Wired and working
- 🔧 In progress
- ⬜ Not started
- 🆕 New endpoint needed

---

# BACKEND API ENDPOINTS

## Existing Endpoints (from CLI)

| Endpoint | Method | Status | Frontend Consumer | Notes |
|----------|--------|--------|-------------------|-------|
| `/api/health` | GET | ✅ Exists | StatusIndicator | Health check |
| `/api/memories` | GET | ✅ Exists | ⬜ TimelinePage, DashboardPage | List memories |
| `/api/memories` | POST | ✅ Exists | ⬜ ChatPage (after response) | Create memory |
| `/api/memories/search` | GET | ✅ Exists | ⬜ TimelinePage | Semantic search |
| `/api/memories/:id` | GET | ✅ Exists | ⬜ MemoryCard detail | Get single memory |
| `/api/context` | POST | ✅ Exists | ⬜ ChatPage | Get context package |
| `/api/context/profiles` | GET | ✅ Exists | ⬜ HeaderBar | List profiles |
| `/api/entities` | GET | ✅ Exists | ⬜ EntitiesPanel, GraphPage | List entities |
| `/api/entities/:id` | GET | ✅ Exists | ⬜ EntityDetail | Get entity + memories |
| `/api/entities/search` | GET | ✅ Exists | ⬜ Search | Search entities |
| `/api/beliefs` | GET | ✅ Exists | ⬜ BeliefsPanel | List beliefs |
| `/api/beliefs/:id` | GET | ✅ Exists | ⬜ BeliefCard detail | Get belief + evidence |
| `/api/patterns` | GET | ✅ Exists | ⬜ PatternsPanel | List patterns |
| `/api/patterns/:id` | GET | ✅ Exists | ⬜ PatternCard detail | Get pattern + evidence |
| `/api/insights` | GET | ✅ Exists | ⬜ InsightsPanel | List insights |
| `/api/insights/:id` | GET | ✅ Exists | ⬜ InsightCard detail | Get insight + sources |
| `/api/insights/:id/dismiss` | POST | ✅ Exists | ⬜ InsightCard | Dismiss insight |
| `/api/insights/:id/action` | POST | ✅ Exists | ⬜ InsightCard | Mark actioned |
| `/api/summaries` | GET | ✅ Exists | ⬜ LivingSummaryPanel | Get all summaries |
| `/api/summaries/:category` | GET | ✅ Exists | ⬜ Specific summary | Get one summary |
| `/api/graph/stats` | GET | ✅ Exists | ⬜ GraphPage | Graph statistics |
| `/api/graph/neighbors/:id` | GET | ✅ Exists | ⬜ GraphPage | Entity neighbors |
| `/api/graph/subgraph/:id` | GET | ✅ Exists | ⬜ GraphPage | Entity subgraph |
| `/api/research/gaps` | GET | ✅ Exists | ⬜ Future | Knowledge gaps |
| `/api/research/questions` | GET | ✅ Exists | ⬜ Future | Active questions |
| `/api/objects` | GET | ✅ Exists | ⬜ Future | List objects |
| `/api/consolidation/run` | POST | ✅ Exists | ⬜ Settings | Trigger consolidation |
| `/api/consolidation/stats` | GET | ✅ Exists | ⬜ Settings | Consolidation stats |

## New Endpoints Needed

| Endpoint | Method | Status | Frontend Consumer | Purpose |
|----------|--------|--------|-------------------|---------|
| `/api/chat` | POST | ✅ Exists | ChatPage | Send message, get LLM response |
| `/api/chat/simple` | POST | ✅ Exists | ChatPage | Quick chat without context |
| `/api/chat/health` | GET | ✅ Exists | StatusIndicator | LLM health check |
| `/api/chat/stream` | WS | 🆕 Needed | ChatPage | Stream LLM response |
| `/api/graph/visualization` | GET | ✅ Exists | GraphPage | Full graph data for viz |

---

# WEBSOCKET EVENTS

## Server → Client

| Event | Status | Frontend Handler | Payload | Purpose |
|-------|--------|------------------|---------|---------|
| `chat:response` | 🆕 | ChatPage | `{ conversationId, chunk, done }` | Stream LLM tokens |
| `chat:context` | 🆕 | OverlayStore | `{ conversationId, memories[], entities[] }` | Context used |
| `memory:created` | 🆕 | Timeline, Dashboard | `{ memory }` | New memory added |
| `memory:updated` | 🆕 | Timeline, Dashboard | `{ memory }` | Memory changed |
| `summary:updated` | 🆕 | LivingSummaryPanel | `{ category, summary }` | Summary refreshed |
| `insight:created` | 🆕 | InsightsPanel | `{ insight }` | New insight |
| `connection:status` | 🆕 | HeaderBar | `{ connected, latency }` | Connection health |

## Client → Server

| Event | Status | Frontend Source | Payload | Purpose |
|-------|--------|-----------------|---------|---------|
| `chat:message` | 🆕 | ChatInputBar | `{ conversationId, message, profile }` | Send message |
| `chat:cancel` | 🆕 | ChatPage | `{ conversationId }` | Cancel streaming |

---

# FRONTEND COMPONENTS → API MAPPING

## Layout Components

| Component | API Dependencies | Status |
|-----------|------------------|--------|
| `AppLayout` | None | ⬜ |
| `HeaderBar` | `/api/context/profiles`, WS `connection:status` | ⬜ |
| `SideNav` | None | ⬜ |
| `OverlayPortal` | None (uses OverlayStore) | ⬜ |

## Chat Components

| Component | API Dependencies | Status |
|-----------|------------------|--------|
| `ChatPage` | `/api/chat`, `/api/context`, WS events | ⬜ |
| `ChatWindow` | useChatStore → `/api/chat` | ✅ Wired |
| `MessageList` | useChatStore | ✅ Wired |
| `MessageBubble` | None | ✅ Built |
| `ChatInputBar` | useChatStore → `/api/chat` | ✅ Wired |
| `STTButton` | Web Speech API (browser) | ✅ Wired |
| `ContextualMemoryOverlayStack` | OverlayStore (from context response) | ⬜ |

## Card Components

| Component | API Dependencies | Status |
|-----------|------------------|--------|
| `MemoryCard` | Props only (data from parent) | ⬜ |
| `BeliefCard` | Props only | ⬜ |
| `PatternCard` | Props only | ⬜ |
| `InsightCard` | `/api/insights/:id/dismiss`, `/api/insights/:id/action` | ⬜ |
| `EntityChip` | Props only | ⬜ |

## Dashboard Components

| Component | API Dependencies | Status |
|-----------|------------------|--------|
| `DashboardPage` | Aggregates child panels | ✅ Wired |
| `DashboardPanel` | None (layout wrapper) | ✅ Built |
| `StatsCard` | None (props) | ✅ Built |
| `LivingSummaryPanel` | `/api/summaries` | ✅ Wired |
| `TodayPanel` | `/api/memories` (filtered recent, high salience) | ✅ Wired |
| `BeliefsPanel` | `/api/beliefs` | ✅ Wired |
| `PatternsPanel` | `/api/patterns` | ✅ Wired |
| `EntitiesPanel` | `/api/entities` | ✅ Wired |
| `InsightsPanel` | `/api/insights` | ✅ Wired |
| `DetailModal` | None (uses detailModalStore) | ✅ Wired |

## Timeline Components

| Component | API Dependencies | Status |
|-----------|------------------|--------|
| `TimelinePage` | `/api/memories`, `/api/memories/search` | ✅ Wired |
| `MemoryCard` | Props + detailModalStore | ✅ Wired |
| `DateSection` | Props from TimelinePage | ✅ Built |
| `TimelineFilters` | Local state, triggers refetch | ✅ Built |
| `LoadMoreTrigger` | IntersectionObserver | ✅ Built |
| `EndOfTimeline` | Props | ✅ Built |

## Graph Components

| Component | API Dependencies | Status |
|-----------|------------------|--------|
| `GraphPage` | `/api/graph/stats`, `/api/graph/visualization`, `/api/graph/entities/:id/subgraph` | ✅ Wired |
| `MemoryGraphView` | `/api/graph/memories/:id/subgraph` via useMemorySubgraph | ✅ Built |
| `GraphControls` | Local state (filters, display options), triggers refetch | ✅ Built |
| `GraphContextMenu` | None (props + callbacks) | ✅ Built |
| `SelectionDetailsPanel` | `/api/entities/:id`, `/api/memories/:id`, `/api/graph/entities/:id/neighbors` | ✅ Wired |

## Shared Components

| Component | API Dependencies | Status |
|-----------|------------------|--------|
| `SalienceMeter` | Props only | ⬜ |
| `EmotionIcon` | Props only | ⬜ |
| `LoadingSkeleton` | None | ⬜ |
| `ErrorState` | None | ⬜ |
| `EmptyState` | None | ⬜ |

---

# STATE STORES

## Zustand Stores

| Store | Purpose | Status |
|-------|---------|--------|
| `chatStore` | Messages, conversationId, loading state | ✅ Implemented |
| `overlayStore` | Active memory cards, push/dismiss | ✅ Implemented |
| `detailModalStore` | Detail modal state for all item types | ✅ Implemented |
| `uiStore` | Theme, sidebar state, selected profile | ⬜ |

## TanStack Query Keys

| Query Key | Endpoint | Consumers |
|-----------|----------|-----------|
| `['memories', filters]` | `/api/memories` | TimelinePage, DashboardPage |
| `['memories', 'search', query]` | `/api/memories/search` | SearchResults |
| `['memory', id]` | `/api/memories/:id` | MemoryCard detail |
| `['context', query, profile]` | `/api/context` | ChatPage |
| `['profiles']` | `/api/context/profiles` | HeaderBar |
| `['entities', filters]` | `/api/entities` | EntitiesPanel, GraphPage |
| `['entity', id]` | `/api/entities/:id` | EntityDetail |
| `['beliefs', filters]` | `/api/beliefs` | BeliefsPanel |
| `['patterns', filters]` | `/api/patterns` | PatternsPanel |
| `['insights', filters]` | `/api/insights` | InsightsPanel |
| `['summaries']` | `/api/summaries` | LivingSummaryPanel |
| `['graph', 'stats']` | `/api/graph/stats` | GraphPage |
| `['graph', 'visualization', options]` | `/api/graph/visualization` | GraphPage |
| `['graph', 'entity-subgraph', id]` | `/api/graph/entities/:id/subgraph` | GraphPage |
| `['graph', 'memory-subgraph', id]` | `/api/graph/memories/:id/subgraph` | GraphPage (future) |
| `['graph', 'entity-neighbors', id]` | `/api/graph/entities/:id/neighbors` | GraphPage (future) |

---

# DATA FLOW DIAGRAMS

## Chat Message Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           CHAT MESSAGE FLOW                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  User Types/Speaks                                                       │
│       │                                                                  │
│       ▼                                                                  │
│  ┌─────────────────┐                                                     │
│  │  ChatInputBar   │                                                     │
│  │  + STTButton    │                                                     │
│  └────────┬────────┘                                                     │
│           │                                                              │
│           ▼                                                              │
│  ┌─────────────────┐     ┌─────────────────┐                            │
│  │   chatStore     │────▶│  POST /api/     │                            │
│  │   addMessage()  │     │    context      │                            │
│  └────────┬────────┘     └────────┬────────┘                            │
│           │                       │                                      │
│           │              ┌────────▼────────┐                            │
│           │              │ ContextPackage  │                            │
│           │              │ - memories[]    │                            │
│           │              │ - entities[]    │                            │
│           │              │ - summaries[]   │                            │
│           │              └────────┬────────┘                            │
│           │                       │                                      │
│           │    ┌──────────────────┼──────────────────┐                  │
│           │    │                  │                  │                  │
│           │    ▼                  ▼                  ▼                  │
│           │  ┌──────────┐  ┌─────────────┐  ┌──────────────┐           │
│           │  │ Overlay  │  │ POST /api/  │  │ Disclosure   │           │
│           │  │ Store    │  │   chat      │  │ Logging      │           │
│           │  │ (cards)  │  │ (+ context) │  │              │           │
│           │  └────┬─────┘  └──────┬──────┘  └──────────────┘           │
│           │       │               │                                      │
│           │       ▼               ▼                                      │
│           │  ┌──────────┐  ┌─────────────┐                              │
│           │  │ Memory   │  │ WS stream   │                              │
│           │  │ Overlay  │  │ chat:resp   │                              │
│           │  │ Stack    │  └──────┬──────┘                              │
│           │  └──────────┘         │                                      │
│           │                       ▼                                      │
│           │              ┌─────────────────┐                            │
│           └─────────────▶│   MessageList   │                            │
│                          │   (renders)     │                            │
│                          └─────────────────┘                            │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Dashboard Data Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         DASHBOARD DATA FLOW                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                       DashboardPage                              │    │
│  │                      (on mount)                                  │    │
│  └──────────────────────────────┬──────────────────────────────────┘    │
│                                 │                                        │
│     ┌───────────────────────────┼───────────────────────────┐           │
│     │           │               │               │           │           │
│     ▼           ▼               ▼               ▼           ▼           │
│  ┌──────┐   ┌──────┐       ┌──────┐       ┌──────┐     ┌──────┐        │
│  │ GET  │   │ GET  │       │ GET  │       │ GET  │     │ GET  │        │
│  │/sum- │   │/memo-│       │/beli-│       │/patt-│     │/insi-│        │
│  │maries│   │ries  │       │efs   │       │erns  │     │ghts  │        │
│  └──┬───┘   └──┬───┘       └──┬───┘       └──┬───┘     └──┬───┘        │
│     │          │              │              │            │             │
│     ▼          ▼              ▼              ▼            ▼             │
│  ┌──────┐   ┌──────┐       ┌──────┐       ┌──────┐     ┌──────┐        │
│  │Living│   │Today │       │Belief│       │Patter│     │Insig-│        │
│  │Summ- │   │Panel │       │sPanel│       │nsPane│     │hts   │        │
│  │ary   │   │      │       │      │       │l     │     │Panel │        │
│  │Panel │   │      │       │      │       │      │     │      │        │
│  └──────┘   └──────┘       └──────┘       └──────┘     └──────┘        │
│                                                                          │
│  WebSocket Updates (live):                                               │
│  ┌─────────────────┐                                                     │
│  │ summary:updated │───▶ Invalidate summaries query                     │
│  │ memory:created  │───▶ Invalidate memories query                      │
│  │ insight:created │───▶ Invalidate insights query                      │
│  └─────────────────┘                                                     │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

# DATA TYPE MAPPING

**CRITICAL**: Backend and frontend use different field names. All API responses must be transformed.

## Memory Type Mapping

| Backend Field | Frontend Field | Transform | Notes |
|---------------|----------------|-----------|-------|
| `salience_score` | `salience` | Direct copy | 0-10 scale |
| `occurred_at` | `updated_at` | Fallback to `created_at` | Can be null |
| `created_at` | `created_at` | Direct copy | |
| `content` | `content` | Direct copy | |
| `source` | `source` | Cast to MemorySource | |
| `id` | `id` | Direct copy | UUID |

**Transformer**: `transformMemory()` in `lib/api/memories.ts`

## Entity Type Mapping

| Backend Field | Frontend Field | Transform | Notes |
|---------------|----------------|-----------|-------|
| `entity_type` | `type` | Direct copy | EntityType enum |
| `first_seen_at` | `first_seen` | Direct copy | ISO string |
| `last_seen_at` | `last_seen` | Direct copy | ISO string |
| `attributes` | `metadata` | Direct copy | Record<string, unknown> |
| `id` | `id` | Direct copy | UUID |
| `name` | `name` | Direct copy | |
| `aliases` | `aliases` | Direct copy | string[] |
| `mention_count` | `mention_count` | Direct copy | |

**Transformer**: `transformEntity()` in `lib/api/entities.ts`

## Belief Type Mapping

| Backend Field | Frontend Field | Transform | Notes |
|---------------|----------------|-----------|-------|
| `content` | `statement` | Direct copy | Belief text |
| `belief_type` | `category` | Direct copy | BeliefCategory enum |
| `source_memory_count` | `evidence_count` | Direct copy | Number |
| `first_extracted_at` | `first_observed` | Direct copy | ISO string |
| `last_reinforced_at` | `last_reinforced` | Fallback to first_extracted_at | Can be null |
| `status` | `status` | 'superseded' → 'deprecated' | Enum mapping |
| `id` | `id` | Direct copy | UUID |
| `confidence` | `confidence` | Direct copy | 0-1 scale |

**Transformer**: `transformBelief()` in `lib/api/beliefs.ts`

## Pattern Type Mapping

| Backend Field | Frontend Field | Transform | Notes |
|---------------|----------------|-----------|-------|
| `content` | `description` | Direct copy | Pattern text |
| `pattern_type` | `type` | Direct copy | PatternType enum |
| `first_detected_at` | `first_detected` | Direct copy | ISO string |
| `last_observed_at` | `last_detected` | Fallback to first_detected_at | Can be null |
| `id` | `id` | Direct copy | UUID |
| `frequency` | `frequency` | Direct copy | 0-1 scale |
| `confidence` | `confidence` | Direct copy | 0-1 scale |

**Transformer**: `transformPattern()` in `lib/api/patterns.ts`

## Insight Type Mapping

| Backend Field | Frontend Field | Transform | Notes |
|---------------|----------------|-----------|-------|
| `insight_type` | `type` | Direct copy | InsightType enum |
| `status` | `status` | 'active' → 'new', 'stale' → 'reviewed' | Enum mapping |
| `id` | `id` | Direct copy | UUID |
| `content` | `content` | Direct copy | |
| `priority` | `priority` | Direct copy | low/medium/high/critical |
| `created_at` | `created_at` | Direct copy | ISO string |
| N/A | `source_memories` | Empty array | Fetched via /api/insights/:id/sources |

**Transformer**: `transformInsight()` in `lib/api/insights.ts`
**Helper**: `mapInsightStatus()` for status enum mapping

---

# API CLIENT FUNCTIONS

Track implementation status of API client wrappers:

| Function | File | Status | Endpoint |
|----------|------|--------|----------|
| `fetchMemories()` | `lib/api/memories.ts` | ✅ | GET /api/memories |
| `fetchMemoriesPage()` | `lib/api/memories.ts` | ✅ | GET /api/memories (paginated) |
| `searchMemories()` | `lib/api/memories.ts` | ✅ | GET /api/memories/search |
| `fetchMemory()` | `lib/api/memories.ts` | ✅ | GET /api/memories/:id |
| `fetchRecentHighSalienceMemories()` | `lib/api/memories.ts` | ✅ | GET /api/memories (sorted) |
| `createMemory()` | `lib/api/memories.ts` | ⬜ | POST /api/memories |
| `fetchContextPackage()` | `lib/api/context.ts` | ✅ | POST /api/context |
| `fetchProfiles()` | `lib/api/context.ts` | ⬜ | GET /api/context/profiles |
| `sendChatMessage()` | `lib/api/chat.ts` | ✅ | POST /api/chat |
| `fetchEntities()` | `lib/api/entities.ts` | ✅ | GET /api/entities |
| `getEntity()` | `lib/api/entities.ts` | ⬜ | GET /api/entities/:id |
| `fetchBeliefs()` | `lib/api/beliefs.ts` | ✅ | GET /api/beliefs |
| `fetchPatterns()` | `lib/api/patterns.ts` | ✅ | GET /api/patterns |
| `fetchInsights()` | `lib/api/insights.ts` | ✅ | GET /api/insights |
| `dismissInsight()` | `lib/api/insights.ts` | ⬜ | POST /api/insights/:id/dismiss |
| `fetchSummaries()` | `lib/api/summaries.ts` | ✅ | GET /api/summaries |
| `fetchGraphStats()` | `lib/api/graph.ts` | ✅ | GET /api/graph/stats |
| `fetchGraphVisualization()` | `lib/api/graph.ts` | ✅ | GET /api/graph/visualization |
| `fetchEntitySubgraph()` | `lib/api/graph.ts` | ✅ | GET /api/graph/entities/:id/subgraph |
| `fetchMemorySubgraph()` | `lib/api/graph.ts` | ✅ | GET /api/graph/memories/:id/subgraph |
| `fetchEntityNeighbors()` | `lib/api/graph.ts` | ✅ | GET /api/graph/entities/:id/neighbors |

---

# HOOKS

Track implementation status of React hooks:

| Hook | File | Status | Dependencies |
|------|------|--------|--------------|
| `useMemories()` | `lib/hooks/useMemories.ts` | ✅ | fetchMemories |
| `useInfiniteMemories()` | `lib/hooks/useMemories.ts` | ✅ | fetchMemoriesPage |
| `useMemorySearch()` | `lib/hooks/useMemories.ts` | ✅ | searchMemories |
| `useMemory()` | `lib/hooks/useMemories.ts` | ⬜ | fetchMemory |
| `useContextPackage()` | `lib/hooks/useContextPackage.ts` | ⬜ | fetchContextPackage |
| `useProfiles()` | `lib/hooks/useProfiles.ts` | ⬜ | fetchProfiles |
| `useEntities()` | `lib/hooks/useEntities.ts` | ✅ | fetchEntities |
| `useBeliefs()` | `lib/hooks/useBeliefs.ts` | ✅ | fetchBeliefs |
| `usePatterns()` | `lib/hooks/usePatterns.ts` | ✅ | fetchPatterns |
| `useInsights()` | `lib/hooks/useInsights.ts` | ✅ | fetchInsights |
| `useSummaries()` | `lib/hooks/useSummaries.ts` | ✅ | fetchSummaries |
| `useRecentMemories()` | `lib/hooks/useDashboard.ts` | ✅ | fetchRecentHighSalienceMemories |
| `useGraphStats()` | `lib/hooks/useGraphData.ts` | ✅ | fetchGraphStats |
| `useGraphVisualization()` | `lib/hooks/useGraphData.ts` | ✅ | fetchGraphVisualization |
| `useEntitySubgraph()` | `lib/hooks/useGraphData.ts` | ✅ | fetchEntitySubgraph |
| `useMemorySubgraph()` | `lib/hooks/useGraphData.ts` | ✅ | fetchMemorySubgraph |
| `useEntityNeighbors()` | `lib/hooks/useGraphData.ts` | ✅ | fetchEntityNeighbors |
| `useGraphInteractions()` | `lib/hooks/useGraphInteractions.ts` | ✅ | graphData, callbacks |
| `useSpeechRecognition()` | `lib/hooks/useSpeechRecognition.ts` | ✅ | Web Speech API |
| `useWebSocket()` | `lib/hooks/useWebSocket.ts` | ✅ | Socket.IO |

---

# UPDATE LOG

Track changes to wiring as we implement:

| Date | Phase | Change | Components Affected |
|------|-------|--------|---------------------|
| 2025-12-27 | P0 | Initial scaffolding complete | All structure |
| 2025-12-27 | P1-T1 | Layout shell built | AppLayout, HeaderBar, SideNav |
| 2025-12-27 | P1-T2 | Chat UI components built | ChatWindow, MessageList, MessageBubble, ChatInputBar |
| 2025-12-27 | P1-T3 | useChatStore implemented | lib/stores/chatStore.ts |
| 2025-12-27 | P1-T4 | /api/chat endpoint created | Backend routes/chat.ts, services/chat.ts |
| 2025-12-27 | P1-T5 | Frontend wired to backend API | lib/api/chat.ts, chatStore updated |
| 2025-12-27 | P1-T6 | STT Button implemented | STTButton, useSpeechRecognition hook |
| 2025-12-27 | P2 | Context overlay system | OverlayStore, ContextualMemoryOverlayStack |
| 2025-12-27 | P3-T1 | Dashboard layout | DashboardPage, DashboardPanel, StatsCard |
| 2025-12-27 | P3-T2 | Living Summary panel | LivingSummaryPanel, useSummaries |
| 2025-12-27 | P3-T3 | Today panel | TodayPanel, useRecentMemories |
| 2025-12-27 | P3-T4 | Beliefs panel | BeliefsPanel, useBeliefs |
| 2025-12-27 | P3-T5 | Patterns panel | PatternsPanel, usePatterns |
| 2025-12-27 | P3-T6 | Entities panel | EntitiesPanel, useEntities |
| 2025-12-27 | P3-T7 | Insights panel | InsightsPanel, useInsights |
| 2025-12-27 | P3-T8 | Detail modal system | DetailModal, detailModalStore |
| 2025-12-27 | P4-T1 | Timeline page route | TimelinePage, MemoryCard, DateSection |
| 2025-12-27 | P4-T2 | Timeline filters | TimelineFilters, source/date/salience filters |
| 2025-12-27 | P4-T3 | Infinite scroll | useInfiniteMemories, LoadMoreTrigger |
| 2025-12-27 | P4-T4 | Memory cards enhanced | Expand/collapse, detail modal wiring |
| 2025-12-27 | P4-T5 | Animations | Framer Motion staggered entrance |
| 2025-12-27 | P4-T6 | Deep linking | URL params ?memory=id, focus/highlight |
| 2025-12-27 | FIX | Data type mapping | Added transformMemory() for backend→frontend field mapping |
| 2025-12-27 | AUDIT | Complete data mapping | Added transformers for Entity, Belief, Pattern, Insight APIs |
| 2025-12-27 | P5-T1 | GraphPage with react-force-graph | GraphPage, lib/api/graph.ts, lib/hooks/useGraphData.ts |
| 2025-12-27 | P5-T2 | Graph visualization endpoint | /api/graph/visualization, fetchGraphVisualization, useGraphVisualization, GraphPage full view |
| 2025-12-27 | P5-T3 | MemoryGraphView component | components/graph/MemoryGraphView.tsx (reusable memory graph) |
| 2025-12-27 | P5-T4 | GraphControls panel | components/graph/GraphControls.tsx (filters, display options) |
| 2025-12-27 | P5-T5 | Graph interactions | useGraphInteractions hook, GraphContextMenu, hover highlights, double-click zoom |
| 2025-12-27 | P5-T6 | SelectionDetailsPanel | components/graph/SelectionDetailsPanel.tsx (entity/memory details) |
| 2025-12-27 | FIX | Graph hover collapse bug | useMemo for stableGraphData, hasInitialZoomRef |
| 2025-12-27 | P6-T1 | Socket.IO added to Express | src/api/server.ts, src/config/index.ts, socket.io package |
| 2025-12-27 | P6-T2 | WebSocket event handlers | src/api/socket/types.ts, handlers.ts, index.ts - chat streaming |
| 2025-12-27 | P6-T3 | useWebSocket hook | web/src/lib/hooks/useWebSocket.ts - singleton socket client |

---

# NOTES

- Update this document after completing each task
- Use status emoji consistently
- Add new endpoints to "New Endpoints Needed" before implementing
- Move from 🆕 → 🔧 → ✅ as work progresses

