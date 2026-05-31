# Tools & Capabilities

Canonical guide to adding a tool to Squire. Read this first when asked to "add a tool" or "add a capability."

The goal is to keep the codebase organized. Every existing tool followed this pattern. New tools that don't will look out of place — and worse, will start growing one-off wiring in the chat surfaces, which is exactly what Phase 6 eliminated.

---

## Vocabulary

- **Tool** — a single function the LLM can call. Defined by a `ToolSpec` (name + description + JSON-schema parameters + handler). Lives in one `.ts` file under `src/tools/`.
- **Capability** — a logical grouping of one or more tools (e.g. `email`, `calendar`, `search`). The unit of permission. Loops grant/deny *capabilities*, not individual tools.
- **Loop / surface** — an agent runtime: `socket_chat`, `http_chat`, `telegram`, `commune`, `goal_worker`, `courier`, `scout`, `page` (legacy Scout alias), `worker_agent`, `sandbox_worker`, `codex_chat`. Defined in `src/config/master.ts`.

---

## Decision tree — bolt on, or new capability?

```
Does the new tool fit semantically inside an existing capability?
├─ YES → bolt on. Add to that capability's tools[]. 1-file diff (or 2 with tests).
└─ NO  → new capability. 3 small edits across capabilities.ts, master.ts, tools/index.ts.
```

When in doubt: bolt on. New capabilities are a permission boundary; only create one if you genuinely want to grant/deny it independently from neighbors. Eight of the existing capabilities have only 1–3 tools — splitting was about permission scope, not file size.

---

## Path A: bolt onto an existing capability (the 80% case)

Example: adding `x_search` (Grok-backed X/Twitter search) — semantically web search, lives in the `search` capability.

**1. Open the capability's tool file.** For `search`, that's `src/tools/search.ts`.

**2. Append to the exported `tools` array:**

```ts
{
  name: 'x_search',
  description: 'Search X (Twitter)/Grok for recent posts about a topic. ...',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '...' },
      max_results: { type: 'number', description: '...' },
    },
    required: ['query'],
  },
  handler: xSearch as ToolHandler,
}
```

**3. Write the handler** at the top of the same file. Convention: an async function that takes a typed args object and returns a `string` (the formatted result the LLM will see). Always return a *string* — even on error, return `'Error: ...'` rather than throwing. Use `process.env.SOME_API_KEY` for credentials; never inline them. Look at `webSearch()` and `fetchUrl()` in `search.ts` for the model.

That's it. Done. The tool is now available to every loop that has the `search` capability allowed (which is all chat surfaces and most schedulers via `allEnabledCapabilities`).

---

## Path B: new capability

Example: adding an `x_search` capability that's distinct from `search` (you want to grant/deny it independently).

**1. New file: `src/tools/x_search.ts`** — same shape as `search.ts`. Export `tools: ToolSpec[]`.

**2. Register the capability name** in `src/tools/capabilities.ts`:
- Add `'x_search'` to `publicCoreCapabilityNames` (or `privateBusinessCapabilityNames` if it's private-package).
- Optionally add a `manifestOverrides['x_search']` block: `runtimeLoops` (which loops use it — informational), `promptGuidance` (one-line hint surfaced to the LLM), `permissions.externalEffects` (e.g. `['x_api_call']`), `permissions.guardedActions` (see below).

**3. Mirror the list in `src/config/master.ts`** — add `'x_search'` to `CORE_CAPABILITIES` (the array near the top, currently lines 106–132). This is the only "duplication" in the system and exists because the master config is the source of truth for what's enabled at runtime; the capability registry mirrors it.

**4. Wire it up in `src/tools/index.ts`:**
```ts
import { tools as xSearchTools } from './x_search.js';
// ...
const allCapabilities: Capability[] = [
  // ...
  capability('x_search', xSearchTools),
];
```

Total: 1 new file + 3 small edits. The agent registry picks it up automatically — no changes to `src/agents/`, `src/api/socket/handlers.ts`, or `src/services/chat/chat.ts`.

---

## Loop policy — who gets to call it?

`src/config/master.ts:360–462` is the source of truth for which loops can invoke which capabilities and tools.

| Loop | Default for a new capability |
|---|---|
| `socket_chat` / `http_chat` / `codex_chat` | Auto-allowed (`allowedCapabilities: allEnabledCapabilities`) |
| `telegram` / `commune` / `goal_worker` | Auto-allowed (`agentLoopCapabilities`) |
| `courier` | **Explicit allowlist** — currently `['email', 'squire_email', 'calendar', 'reminders', 'commitments']`. Edit if your tool should be summarized in the daily brief. |
| `scout` / `page` | **Explicit allowlist** — read-only file tools only. `page` is a legacy alias for Scout. New capability won't appear here unless you add it. |
| `worker_agent` / `sandbox_worker` | **No tools** — shell-backed worker runtime. `sandbox_worker` is the sandbox-mode policy alias. |

If your tool needs to be callable by a loop with an explicit allowlist, edit that loop's `allowedCapabilities` array. **Never** add a tool to a worker loop's `allowedTools` — workers don't run the LLM tool loop.

---

## Guarded actions

If your tool has side effects (sends an email, posts to X, deletes data) and you want a runtime gate beyond the registration check, declare a guardedAction:

```ts
// in capabilities.ts manifestOverrides
x_search: {
  permissions: {
    externalEffects: ['x_api_call'],
    guardedActions: ['external.x_post'], // if x_search ever posts
  },
}
```

Then at runtime the policy in `SQUIRE_TOOL_GUARDRAILS` env (parsed by `parseToolGuardrailPolicies` in master.ts) decides whether to `allow`, `deny`, write to `draft`, or `require_approval` per tool. Read-only tools generally don't need guardedActions.

---

## Tests — what catches drift

After registering a new tool, run `npm test`. The relevant suites:

- `tests/runtime-policy-surfaces.test.ts` — asserts the right tools land in the right loops. If your tool leaks into `page`/`scout` (read-only loops) it will fail here.
- `tests/agents-parity.test.ts` — asserts every catalog agent's tool surface matches expectations.
- `tests/capability-registry.test.ts` — asserts capability registration shape.

If you change a tool's category or rename it, expect to update one of these. They are *meant* to fail when you change scope — that's the safety net against accidental over-grants.

---

## Anti-patterns ("how to turn this into soup")

These are the patterns Phase 6 cleaned up. Don't reintroduce them:

1. **Adding tool resolution code inside a chat surface.** Wrong:
   ```ts
   // ❌ in handlers.ts or chat.ts
   const tools = [...existingTools, myNewTool];
   ```
   The agent definition's `tools` resolver is the only place tools come from. If you find yourself touching `src/api/socket/handlers.ts` or `src/services/chat/chat.ts` to add a tool, stop — you're in the wrong file.

2. **Bypassing the capability registry.** Don't import a tool directly into an agent definition and skip `getToolDefinitions`. The policy gates (loop allowlists, guardedActions, role visibility) are enforced at the registry layer. Bypassing them means your tool ignores `master.ts`.

3. **A `customRunner` for a chat surface.** Phase 6 deleted `streamWithToolLoop`. Don't put a new inner-loop function back. If a new agent surface needs streaming, register it as a real `loop_llm` and use `runAgent(id, args)` with `callbacks.onChunk`.

4. **Throwing from a tool handler.** Tools return strings. Errors return `'Error: ...'`. Throws end up surfaced as raw stack traces in the chat UI.

5. **Tool descriptions written for engineers.** The description is the *prompt* the LLM reads to decide whether to call the tool. Write for an LLM choosing between 130 tools, not for a code reviewer. "Use this when ... Returns ..." is the canonical shape. See `search.ts` for examples.

---

## Checklist (for me, the next time I'm asked to do this)

When the user says "add a tool" or "add a capability":

1. **Decide the path.** Read this file's "Decision tree" section. Ask if it's not obvious.
2. **Write the handler** in `src/tools/<name>.ts`. String return, no throws, env-var credentials.
3. **Append the ToolSpec** to that file's `tools[]` export.
4. **If new capability**: edit `capabilities.ts` + `master.ts:CORE_CAPABILITIES` + `tools/index.ts:allCapabilities`.
5. **Consider loop policy.** If `courier`/`page`/`scout` should see it, edit their `allowedCapabilities` in `master.ts`. Otherwise leave alone — chat surfaces get it for free.
6. **Consider guardedActions.** Only if the tool has side effects you want runtime-gated.
7. **`npx tsc --noEmit && npm test`**. The policy surface tests should pass; if they fail, the message will tell you which loop got an unexpected grant.
8. **Deploy via `squire-deploy`** when ready (no migrations needed for tool additions).
9. **Optional: store a Mandrel context** under the project if the tool is part of a larger initiative.

If any step doesn't apply, skip it — but don't invent new patterns. Consistency is the whole point.

---

## See also

- `src/agents/` — agent definitions consume tools via `def.tools(args)`. No README there yet; the pattern is documented inline in `socket_chat.ts` and `http_chat.ts`.
- `src/config/master.ts` — runtime policy. Source of truth for what's enabled.
- `src/tools/capabilityRegistry.ts` — registration internals. Don't edit unless you're changing the registry itself.
- Mandrel project `squire-agent`, milestone `eba544ba` — Phase 6 (Agent Runtime Registry unification) context.
