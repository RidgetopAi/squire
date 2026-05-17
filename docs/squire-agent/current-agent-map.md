# Current Squire Agent Map

This document captures the current Squire agent/runtime state before reorganizing chat-agent and worker-agent configuration.

## Summary

Squire currently has four practical categories of agents:

- User-facing chat agents
- Autonomous scheduled agents
- Delegated read-only subagents
- Shell-backed worker agents

The key current production distinction is:

- Main web chat is currently powered by Codex CLI.
- Telegram, Commune, and Goal Worker use `AgentEngine` with model routing.
- The `claude_code` tool name is backward-compatible, but it dispatches through the configurable worker runtime.
- Production worker runtime currently defaults to Claude Code with the `sonnet` model.

## Production Runtime Defaults Observed

Production `/opt/squire/.env` currently reports:

```text
LLM_PROVIDER=codex
LLM_MODEL=gpt-5.4
ROUTING_ENABLED=true
CODING_AGENT_PROVIDER=claude-code
CODING_AGENT_CODEX_MODEL=gpt-5.4
SANDBOX_AGENT_PROVIDER=claude-code
SANDBOX_AGENT_CODEX_MODEL=gpt-5.4
```

Code defaults fill in the rest:

```text
ROUTING_SMART_PROVIDER=openai
ROUTING_SMART_MODEL=gpt-5.5
ROUTING_FAST_PROVIDER=openai
ROUTING_FAST_MODEL=gpt-5.4-nano
PAGE_AGENT_PROVIDER=openai
PAGE_AGENT_MODEL=gpt-5.4-mini
SCOUT_AGENT_PROVIDER=openai
SCOUT_AGENT_MODEL=gpt-5.4-mini
VISION_PROVIDER=openai
VISION_MODEL=gpt-5.4-mini
COURIER_SUMMARIZER_PROVIDER=openai
COURIER_SUMMARIZER_MODEL=gpt-5.4-mini
EMOTIONAL_SYNTHESIS_PROVIDER=openai
EMOTIONAL_SYNTHESIS_MODEL=gpt-5.4-mini
CODING_AGENT_CLAUDE_MODEL=sonnet
SANDBOX_AGENT_CLAUDE_MODEL=sonnet
```

## User-Facing Chat Agents

### Web Chat: `socket_chat`

Role:

- Main user chat in `/app/chat`.
- Streams responses over Socket.IO.
- Uses memory/context and can call Squire tools in a loop.

Current power source:

- Production `LLM_PROVIDER=codex`.
- Production `LLM_MODEL=gpt-5.4`.
- Runs through Codex CLI.

Relevant files:

- `src/api/socket/handlers.ts`
- `src/services/llm/stream.ts`
- `src/services/llm/codex.ts`

### HTTP Chat: `http_chat`

Role:

- REST `/api/chat` chat path.
- Non-streaming chat.
- Performs context injection and iterative tool calls.

Current power source:

- Production `LLM_PROVIDER=codex`.
- Production `LLM_MODEL=gpt-5.4`.
- Runs through Codex CLI.

Relevant files:

- `src/services/chat/chat.ts`
- `src/providers/llm.ts`
- `src/services/llm/call.ts`
- `src/services/llm/codex.ts`

### Telegram Agent: `telegram`

Role:

- Main Telegram bot responder.
- Builds user context.
- Runs `AgentEngine`.
- Replies to Brian in Telegram.
- Can use scoped Squire tools.

Current power source:

- Uses `AgentEngine`.
- Routing is enabled.
- The engine classifies tasks unless a tier is forced.
- Smart default: OpenAI `gpt-5.5`.
- Fast default: OpenAI `gpt-5.4-nano`.

Relevant files:

- `src/services/telegram/handler.ts`
- `src/services/agent/engine.ts`
- `src/services/agent/llm.ts`
- `src/services/routing/*`

## Autonomous Scheduled Agents

### Commune: `commune`

Role:

- Proactive wake-up agent.
- Runs roughly every 15 minutes by default.
- Reviews scratchpad, schedule, recent commune messages, and send limits.
- May think, write scratchpad notes, resolve scratchpad entries, or send Brian a Telegram message.

Current power source:

- Uses `AgentEngine`.
- Forced to `tier: 'fast'`.
- Default fast runtime: OpenAI `gpt-5.4-nano`.

Tool surface:

- Curated tool list from `getCommuneTools()`.
- Includes scratchpad tools, calendar read tools, `commune_send`, `web_search`, and `lesson_search`.
- Browser automation is intentionally excluded from agent-loop surfaces.

Relevant files:

- `src/services/commune.ts`
- `src/services/commune/scheduler.ts`
- `src/services/commune/core.ts`
- `src/tools/commune.ts`

### Goal Worker: `goal_worker`

Role:

- Background goal-progress agent.
- Runs as a Courier task.
- Selects active goals and attempts concrete progress.
- Logs notes and writes scratchpad/Mandrel context where useful.

Current power source:

- Uses `AgentEngine`.
- Forced to `tier: 'fast'`.
- Default fast runtime: OpenAI `gpt-5.4-nano`.

Default limits:

- `GOAL_WORKER_INTERVAL_MS=3600000` in code defaults.
- `GOAL_WORKER_MAX_TURNS=15` in code defaults.
- `GOAL_WORKER_MAX_EXECUTION_MS=300000` in code defaults.

Relevant files:

- `src/services/courier/tasks/goalWorker.ts`
- `src/services/agent/engine.ts`
- `src/services/planning/goals.ts`

### Courier Email Check: `courier` / `email-check`

Role:

- Scheduled email notifier.
- Checks unread Gmail.
- Summarizes unread messages.
- Caches emails locally.
- Sends Telegram notifications.

Current power source:

- Not an `AgentEngine` agent.
- Uses deterministic Gmail/caching/notification plumbing plus courier summarizer runtime.
- Default summarizer runtime: OpenAI `gpt-5.4-mini`.

Relevant files:

- `src/services/courier/tasks/emailCheck.ts`
- `src/services/courier/summarizer.ts`
- `src/services/courier/notifier.ts`

### AgentMail Check: `agentmail-check`

Role:

- Scheduled AgentMail inbox notifier.
- Checks AgentMail API for new messages.
- Sends Telegram notification with message previews.

Current power source:

- Not LLM-powered.
- Uses AgentMail API plus Telegram notification plumbing.

Relevant files:

- `src/services/courier/tasks/agentmailCheck.ts`
- `src/services/agentmail.ts`
- `src/services/courier/notifier.ts`

### Daily Brief: `daily-brief`

Role:

- Scheduled daily operator email.
- Builds memory/continuity/system-health report modules.
- Sends HTML email through Gmail.

Current power source:

- Mostly deterministic DB/report code in the current module path.
- The current memory-health module does not use the main LLM.
- Email send is guarded by high-impact action guardrails.

Relevant files:

- `src/services/courier/tasks/dailyBrief.ts`
- `src/services/daily-brief/index.ts`
- `src/services/daily-brief/modules/memoryHealth.ts`
- `src/services/daily-brief/emailer.ts`

## Delegated Read-Only Subagents

### Page Agent: `page`

Role:

- Read-only research subagent.
- Main agent can dispatch it to search/read files and return findings.
- Designed for codebase and file investigation without writes.

Current power source:

- Page runtime.
- Default: OpenAI `gpt-5.4-mini`.

Tool surface:

- `read_file`
- `grep_search`
- `glob_files`
- `bash_read`

Relevant files:

- `src/services/page/index.ts`
- `src/services/page/tools.ts`
- `src/tools/page.ts`

### Scout: `scout`

Role:

- Fast read-only reasoning subagent.
- Used for file/code/log search, summarization, data wrangling, calculations, and compact analysis.
- Does not write files.

Current power source:

- Scout runtime.
- Default: OpenAI `gpt-5.4-mini`.

Tool surface:

- `read_file`
- `grep_search`
- `glob_files`
- `bash_read`

Relevant files:

- `src/tools/scout.ts`
- `src/services/page/tools.ts`

## Shell-Backed Worker Agents

### Coding Worker: `worker_agent`

Role:

- Heavy code modification worker.
- Exposed through the backward-compatible `claude_code` tool.
- Can edit files, run tests, build, and use Git.

Current power source:

- Configurable worker runtime.
- Production `CODING_AGENT_PROVIDER=claude-code`.
- Effective default model for Claude Code provider: `sonnet`.
- If switched to Codex, default Codex model is `gpt-5.4`.

Relevant files:

- `src/tools/coding/claude-code.ts`
- `src/services/runtime/worker.ts`
- `src/services/runtime/index.ts`
- `src/config/index.ts`

### Sandbox Worker: `sandbox_worker`

Role:

- Ephemeral build/script/artifact worker.
- Creates temporary VPS workspace under `/tmp/squire-sandbox-*`.
- Can install dependencies, write scripts, generate files, and return artifacts/results.
- Supports sync and async modes.

Current power source:

- Configurable worker runtime.
- Production `SANDBOX_AGENT_PROVIDER=claude-code`.
- Effective default model for Claude Code provider: `sonnet`.
- If switched to Codex, default Codex model is `gpt-5.4`.

Relevant files:

- `src/tools/sandbox.ts`
- `src/services/runtime/worker.ts`
- `src/services/jobs.ts`

## Codex-Specific Runtime

### Codex Chat Runtime: `codex_chat`

Role:

- Policy gate for Codex-backed main chat tool envelopes.
- Codex CLI cannot call app tools directly.
- It returns a `SQUIRE_TOOL_CALLS_JSON` envelope, Squire executes allowed tools, appends results, and calls Codex again.

Current power source:

- Main chat uses Codex CLI with production `gpt-5.4`.

Relevant files:

- `src/services/llm/codex.ts`
- `src/config/runtime-policy.ts`
- `src/config/master.ts`

## Other LLM Runtime Slots

### Vision Runtime

Role:

- Handles image-bearing chat support.
- Socket chat switches to this runtime when images are attached.
- HTTP chat narrows tool exposure to image tools when images are present.

Current power source:

- Default OpenAI `gpt-5.4-mini`.

Relevant files:

- `src/api/socket/handlers.ts`
- `src/services/chat/chat.ts`
- `src/tools/images.ts`

### Emotional Synthesis

Role:

- Sleep/consolidation perspective pass.
- Writes Squire's subjective read into continuity threads.

Current power source:

- Default OpenAI `gpt-5.4-mini`.

Relevant files:

- `src/services/analytics/emotionalSynthesis.ts`
- `src/services/runtime/index.ts`

## Configuration Centers

The current configuration is split across these files:

- `src/config/master.ts`
  - runtime loop declarations
  - allowed capabilities/tools
  - guardrails
  - connector visibility
  - default provider/model slots in master config

- `src/config/index.ts`
  - environment parsing
  - runtime LLM slots
  - worker runtime slots
  - scheduler intervals
  - service URLs and secrets

- `src/services/runtime/index.ts`
  - named runtime lookup helpers
  - LLM runtime IDs
  - worker runtime IDs

- `src/services/runtime/worker.ts`
  - actual Claude Code / Codex worker dispatch
  - VPS/local execution behavior

## Notes For Reorganization

The main pain point is that "agent" configuration is not yet presented as one coherent user-editable map.

Important current split:

- Chat provider/model comes from `LLM_PROVIDER` and `LLM_MODEL`.
- AgentEngine model selection comes from routing config unless a caller forces `tier`.
- Page/Scout/Vision/Courier/Emotional Synthesis each have separate runtime env keys.
- Coding and sandbox workers have worker-specific provider/model env keys.
- Runtime permissions live in `master.ts`, not next to provider/model env parsing.

This means a user can change models today, but the mental model is scattered across chat config, routing config, named runtime slots, and worker runtime config.
