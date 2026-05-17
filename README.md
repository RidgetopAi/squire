# Squire

**A personal AI runtime with durable memory, governed tools, and observable autonomy.**

Squire is an AI memory system and assistant runtime built around one human. It stores memories, notes, lists, calendar context, documents, commitments, reminders, goals, and project context, then makes that context available to chat, Telegram, background loops, worker agents, and Mandrel-backed project memory.

The current codebase is not just a memory demo. It is a private production assistant with:

- TypeScript/Node backend and PostgreSQL + pgvector storage
- Next.js web app with chat, activity, dashboard, calendar, notes, lists, documents, graph, timeline, and memory village views
- Socket.IO chat and HTTP chat surfaces
- Telegram, Google, AgentMail, object storage, and Mandrel connectors
- Runtime policy for loop-specific tool access
- Activity/audit logging for autonomous loops and external effects
- Guardrails for high-impact sends and deletes
- A public-core/private-business capability boundary for future packaging

## Current Status

Production is deployed at `https://squire.ridgetopai.net`.

The current architecture closeout is complete. Mandrel reports `110/111` tracked tasks complete for the `squire-agent` project. The only remaining tracked task is true Codex streaming, which is intentionally deferred.

Recent architecture work established:

- Trace-oriented Activity UI at `/app/activity`
- High-impact action guardrails for Telegram sends, email sends/replies, email trash deletion, permanent deletes, and PDF fill-and-email flows
- Mandrel HTTP bridge as the explicit production connector policy, with stable `X-Connection-ID` project isolation
- Runtime policy enforcement through master config for chat, Telegram, Commune, goal worker, Page, Scout, worker agents, sandbox workers, and Codex tool envelopes
- Public-core/private-business capability manifests
- Telegram, goal-worker, and Commune tool surfaces kept below the OpenAI 128-tool limit

## Core Ideas

Squire treats memory as something the AI uses, not just data the user can search.

### Memory That Knows Context

Squire stores raw observations, memories, entities, beliefs, patterns, insights, commitments, reminders, documents, and living summaries. Conversations start with relevant context instead of a blank prompt.

### Governed Tools

Tools are grouped into capabilities, and each runtime loop gets a scoped tool surface. A Telegram response, a background goal worker, a Page agent, and a coding worker do not all see the same tools by default.

### Observable Autonomy

Autonomous loops and connector calls write Activity events. The Activity UI groups events by trace, highlights failures, denied actions, external sends, Mandrel calls, and tool use, and gives a practical audit trail for what Squire did and why.

### Private Runtime, Public Core

Squire currently runs as Brian's private assistant, but the codebase now marks reusable public-core capabilities separately from Brian/Ridgetop-specific private business capabilities. The goal is to make a future open-source or package split explicit and testable before physically splitting the repo.

## Architecture

```text
Web / Telegram / API / Schedulers
            |
            v
Runtime loops
socket_chat, http_chat, telegram, goal_worker, courier,
commune, page, scout, worker_agent, sandbox_worker, codex_chat
            |
            v
Master config policy
capabilities, connectors, providers, loop policies, guardrails, audit
            |
            v
Capability registry and flat tool facade
notes, lists, calendar, reminders, commitments, Mandrel, memory,
email, coding, page, scout, sandbox, browser, goals, PDF, reports,
private business tools
            |
            v
Services and storage
PostgreSQL + pgvector, Google APIs, Telegram, AgentMail,
object storage, Mandrel HTTP bridge, LLM providers
            |
            v
Activity and durable project memory
trace logs, tool events, guardrail decisions, Mandrel contexts,
tasks, decisions, handoffs
```

Key files:

- `src/config/master.ts` - central runtime policy, connector config, provider slots, loop policy, guardrails, public/private visibility
- `src/config/runtime-policy.ts` - shared loop normalization and tool policy helpers
- `src/tools/capabilityRegistry.ts` - grouped capability registration behind the existing flat tool facade
- `src/tools/capabilities.ts` - public/private capability names and richer capability manifests
- `src/tools/index.ts` - tool registration and guarded execution path
- `src/services/activity.ts` - durable Activity event logging and querying
- `src/services/action-guardrails.ts` - high-impact action classification and policy evaluation
- `src/services/mandrel/client.ts` - Mandrel HTTP bridge client with stable connection identity
- `web/src/app/app/activity/page.tsx` - trace-oriented Activity UI

## Runtime Policy

The master config declares every runtime loop and what it can do.

Current loop IDs:

- `socket_chat`
- `http_chat`
- `telegram`
- `goal_worker`
- `courier`
- `commune`
- `page`
- `scout`
- `worker_agent`
- `sandbox_worker`
- `codex_chat`

Each loop has:

- enabled/disabled state
- runtime/provider intent
- allowed capabilities
- allowed tools
- external effects
- Activity audit settings

The capability registry uses that policy when exposing tool definitions and when looking up tools for execution. This keeps policy enforcement close to the tool boundary instead of relying on prompt instructions.

## Guardrails

Squire classifies high-impact actions before executing handlers.

Guarded action classes:

- `external.telegram_send`
- `external.email_send`
- `delete.email_trash`
- `delete.permanent`

Possible policies:

- `allow`
- `deny`
- `draft`
- `require_approval`

Guardrails can be configured globally, per loop/action, or per tool. Non-allowed decisions are recorded as `guardrail.decision` Activity events.

## Mandrel Connector Policy

Squire uses Mandrel's HTTP bridge as the production connector transport.

Default policy:

```text
MANDREL_TRANSPORT=http-bridge
MANDREL_REQUIRE_STABLE_CONNECTION_ID=true
MANDREL_ALLOW_HTTP_FALLBACK=false
MANDREL_PROJECT=squire-agent
MANDREL_CONNECTION_SCOPE=runtime
```

Every Squire-originated Mandrel call goes through `src/services/mandrel/client.ts` and sends:

```text
X-Connection-ID: squire:<NODE_ENV>:<MANDREL_CONNECTION_SCOPE>:<project>
```

This matters because unscoped HTTP calls fall back to Mandrel's shared `http-default` connection and can make project state appear shared across runtimes.

More detail: `docs/squire-agent/mandrel-connector-policy.md`.

## Public Core / Private Business Boundary

The public-core/private-business boundary is explicit but the repo is not physically split yet.

Public core includes reusable assistant primitives such as time, notes, lists, trackers, calendar, commitments, reminders, coding, steward, Mandrel, memory, email, search, scratchpad, Commune, images, report, Page, goals, continuity, PDF, Scout, sandbox, jobs, and browser.

Private business capabilities currently include:

- `squire_email`
- `dealer_foundation`

Private runtime mode:

```text
SQUIRE_CONFIG_MODE=private
```

Public-core verification mode:

```text
SQUIRE_CONFIG_MODE=public-core
```

More detail: `docs/squire-agent/public-core-private-business-packaging.md`.

## Web App

Main app views:

- `/app/chat` - primary chat interface
- `/app/activity` - trace-oriented runtime/activity audit UI
- `/app/dashboard` - current memory and context dashboard
- `/app/calendar` - calendar view
- `/app/notes` - notes
- `/app/lists` - lists
- `/app/reminders` - reminders
- `/app/commitments` - commitments
- `/app/documents` - document ingestion and review
- `/app/graph` - entity and memory graph
- `/app/timeline` - chronological memory view
- `/app/village` - 3D memory village visualization
- `/app/settings` - settings and integrations

## Quick Start

### Prerequisites

- Node.js 20+
- PostgreSQL with pgvector
- API credentials for the providers/connectors you enable
- `pnpm` for the web app

### Install

```bash
git clone https://github.com/RidgetopAi/squire.git
cd squire

npm install
cd web && pnpm install && cd ..
```

### Configure

Create `.env` from your local/private template and set at least:

```text
DATABASE_URL=postgresql://...
LLM_PROVIDER=openai
LLM_MODEL=gpt-5.5
MANDREL_PROJECT=squire-agent
MANDREL_TRANSPORT=http-bridge
MANDREL_REQUIRE_STABLE_CONNECTION_ID=true
```

Optional connectors require their own secrets, such as Google, Telegram, AgentMail, and object storage settings.

### Database

```bash
docker compose up -d
npm run db:migrate
```

### Development

```bash
npm run dev:api
npm run dev:web
```

The backend dev API script runs `src/api/server.ts`. The web app runs from `web/`.

## Verification

Common checks:

```bash
npm run typecheck
npm test
cd web && pnpm type-check
git diff --check
```

Focused architecture checks:

```bash
npx tsx --test tests/capability-registry.test.ts tests/master-config.test.ts tests/runtime-policy-surfaces.test.ts tests/mandrel-client.test.ts
```

Public-core boundary checks:

```bash
SQUIRE_CONFIG_MODE=public-core \
DATABASE_URL=postgresql://test:test@localhost:5432/test \
ACTIVITY_LOGGING_ENABLED=false \
npx tsx --test tests/capability-registry.test.ts tests/master-config.test.ts tests/runtime-policy-surfaces.test.ts
```

## Deployment Notes

Production runs on the VPS under `/opt/squire`.

Before any deploy that uses `/opt/squire-staging`, refresh staging from the intended source of truth before running the self-deploy script. This avoids stale staging content being synced into production.

Typical VPS deploy flow:

```bash
ssh hetzner
cd /opt/squire
sudo env CI=true bash /opt/squire/scripts/setup-staging.sh
CI=true bash scripts/self-deploy.sh --dry-run
CI=true bash scripts/self-deploy.sh
```

Post-deploy checks:

```bash
systemctl is-active squire squire-web
curl -sS https://squire.ridgetopai.net/api/health
curl -sS -o /dev/null -w '%{http_code}\n' https://squire.ridgetopai.net/app/activity
curl -sS -o /dev/null -w '%{http_code}\n' https://squire.ridgetopai.net/app/chat
```

Related lesson: `../lessons/009-refresh-staging-before-deploy.md`.

## Technology Stack

| Area | Technology |
| --- | --- |
| Backend | TypeScript, Node.js, Express |
| Realtime | Socket.IO |
| Web | Next.js, React, TanStack Query, Zustand |
| 3D | Three.js, React Three Fiber |
| Database | PostgreSQL, pgvector |
| Documents | pdf-parse, mammoth, Tesseract.js |
| Connectors | Mandrel, Telegram, Google, AgentMail, object storage |
| Workers | Claude Code and Codex-capable worker slots |
| Testing | Node test runner via `tsx`, TypeScript checks |

## Current Schema And Tests

Current repo shape:

- `53` SQL migrations in `schema/`
- `26` backend route modules in `src/api/routes/`
- `13` main app page routes under `web/src/app/app/`
- `10` top-level backend test files in `tests/`

Important schema areas:

- raw observations, memories, embeddings, entities, entity mentions, memory edges
- beliefs, patterns, insights, living summaries, state snapshots, trends
- notes, lists, reminders, commitments, calendar events
- documents, extracted facts, object storage
- goals, continuity threads/events, activity events, tool-call persistence
- Google integration, emails, dealer/private business data

## Design Principles

- **Memory over retrieval** - context should feel known, not merely searched.
- **Policy in code** - capabilities, loops, effects, and guardrails should be explicit and testable.
- **Observable autonomy** - background work and external effects should leave a durable trace.
- **Private by default** - production secrets and Brian/Ridgetop business data stay private.
- **Public-core ready** - reusable assistant capabilities should be separable from private overlays.
- **Flat facade, structured core** - preserve existing tool APIs while moving metadata and policy into explicit capability structures.

## License

MIT License - see `LICENSE` for details.

Built by [RidgetopAI](https://github.com/RidgetopAi).
