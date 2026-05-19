# OpenAI Migration Plan

## Goal

Evaluate and plan a migration from Anthropic Sonnet 4.6 as Squire's main agent model to GPT-5.5, while preserving Squire's tool loop, memory behavior, multimodal support, and prompt-caching strategy.

This should not be treated as a simple model-string swap. Squire already has a useful provider abstraction, but GPT-5.5 should get a first-class OpenAI provider path instead of being squeezed through the existing generic OpenAI-compatible Chat Completions path used by Groq, xAI, Gemini, and Ollama-compatible services.

## Current State

Squire's main LLM defaults are Anthropic-specific:

- `LLM_PROVIDER=anthropic`
- `LLM_MODEL=claude-sonnet-4-6`
- `ROUTING_SMART_PROVIDER=anthropic`
- `ROUTING_SMART_MODEL=claude-sonnet-4-6`

Relevant files:

- `src/config/index.ts`
- `src/services/llm/call.ts`
- `src/services/llm/stream.ts`
- `src/services/llm/format.ts`
- `src/services/llm/types.ts`
- `src/services/routing/models.ts`
- `src/api/socket/handlers.ts`
- `src/services/chat/chat.ts`
- `src/services/agent/engine.ts`

The internal message format is already OpenAI-style:

- `system`
- `user`
- `assistant`
- `tool`
- assistant messages can carry `tool_calls`
- tool messages carry `tool_call_id`

That is a good starting point. The migration work is mostly provider conversion, streaming parsing, tool result mapping, usage accounting, and cache semantics.

## Provider Configuration Changes

Add OpenAI as a first-class provider.

Update `src/config/index.ts`:

- Add `openai` to the `LLM_PROVIDER` union.
- Add `openai` to routing provider unions.
- Add `OPENAI_API_KEY`.
- Add `OPENAI_BASE_URL`, defaulting to `https://api.openai.com/v1`.
- Consider defaulting `LLM_MODEL` to `gpt-5.5` only after the implementation is verified.

Likely environment shape:

```env
LLM_PROVIDER=openai
LLM_MODEL=gpt-5.5
OPENAI_API_KEY=...
OPENAI_BASE_URL=https://api.openai.com/v1

ROUTING_SMART_PROVIDER=openai
ROUTING_SMART_MODEL=gpt-5.5
```

Keep Anthropic configuration available during migration so rollback is just an env change.

## API Surface

Use the OpenAI Responses API for GPT-5.5.

Do not rely on the current generic `callOpenAICompatible()` path as the primary GPT-5.5 implementation. That path targets `/chat/completions` and exists for providers that mimic OpenAI Chat Completions. GPT-5.5 should use a dedicated OpenAI provider path so Squire can correctly handle reasoning-model behavior, Responses API streaming events, tool calls, multimodal input, and cached-token accounting.

Implementation targets:

- `callOpenAIResponses()` in `src/services/llm/call.ts`
- `streamOpenAIResponses()` in `src/services/llm/stream.ts`
- `toOpenAIResponsesInput()` in `src/services/llm/format.ts`
- `fromOpenAIResponsesResponse()` in `src/services/llm/format.ts`

Keep the existing `toOpenAIMessages()` and Chat Completions path for Groq/xAI/Gemini/Ollama-compatible providers unless those are intentionally migrated later.

## Prompt Caching Strategy

Squire's current caching shape is good and should be preserved:

1. Static system prompt first.
2. Dynamic date/time, memory, schedule, and context second.
3. Conversation history after that.
4. Current user message last.

Anthropic uses explicit `cache_control` markers. Squire currently marks:

- the first system block as cacheable
- the last Anthropic tool definition as cacheable

OpenAI prompt caching is different. It is automatic and prefix-based. The migration should not add Anthropic-style cache markers to OpenAI requests. Instead, keep the stable static prefix at the front of the request and avoid putting dynamic content before it.

Required follow-up:

- Extend usage accounting to capture cached prompt tokens.
- Preserve the static/dynamic prompt split in `src/services/chat/chat.ts`, `src/api/socket/handlers.ts`, and `src/services/agent/engine.ts`.
- Add tests or logging that confirm cached-token fields are surfaced when available.

Suggested usage shape:

```ts
usage?: {
  promptTokens: number;
  completionTokens: number;
  cachedPromptTokens?: number;
  reasoningTokens?: number;
}
```

## Tool Calling Migration

Tool calling is the highest-risk part of the migration.

Squire's current tool definitions already follow OpenAI/Groq function-calling shape:

```ts
{
  type: 'function',
  function: {
    name,
    description,
    parameters
  }
}
```

That helps, but Responses API tool calls and tool results need their own conversion path. Do not assume the Chat Completions `tool_calls` response shape or `role: "tool"` replay shape will be accepted unchanged.

Important invariants to preserve:

- Assistant tool calls must be persisted with stable IDs.
- Tool results must be paired to the exact tool call IDs.
- Multi-tool turns must replay correctly.
- History truncation must not orphan tool results.
- A follow-up model call after tools must receive tool outputs in the provider's expected shape.

This area has recent production history. Squire previously hit Anthropic 400 errors from orphaned or misordered `tool_use` and `tool_result` blocks. The OpenAI migration should include explicit tests for the same class of failure.

## Streaming Migration

`src/services/llm/stream.ts` currently has two streaming paths:

- Anthropic SSE parsing
- OpenAI-compatible Chat Completions SSE parsing

Add a third path for OpenAI Responses API streaming.

It must support:

- text deltas
- tool call creation
- streamed tool call argument accumulation
- final response completion
- usage extraction when available
- cancellation via `AbortSignal`
- timeout behavior matching the current implementation

Do not remove existing Anthropic streaming until GPT-5.5 has been smoke-tested in production-like conditions.

## Image And Multimodal Path

`src/api/socket/handlers.ts` currently forces Anthropic when images are present:

```ts
const providerOverride = hasImages ? { provider: 'anthropic', model: 'claude-sonnet-4-6' } : undefined;
```

For GPT-5.5 as primary, this needs to become OpenAI-capable.

Migration options:

1. Make the vision override provider-aware.
2. Use OpenAI Responses API image input format for OpenAI.
3. Keep Anthropic as the temporary image fallback until OpenAI image support is verified.

The recent Sharp compression fix should remain provider-agnostic. The image size constraints differ by provider, so Squire should avoid baking Anthropic-specific limits too deeply into OpenAI request handling.

## Routing Changes

Update `src/services/routing/models.ts` and config unions so `openai` can be used for the smart tier.

Suggested rollout:

```env
ROUTING_ENABLED=true
ROUTING_SMART_PROVIDER=openai
ROUTING_SMART_MODEL=gpt-5.5
ROUTING_FAST_PROVIDER=xai
ROUTING_FAST_MODEL=grok-4-1-fast-reasoning
```

Keep fast-tier routing unchanged initially. This limits blast radius to the main smart agent behavior.

## Compatibility And Rollback

Do not remove Anthropic support during the first migration pass.

Keep these rollback levers:

- `LLM_PROVIDER=anthropic`
- `LLM_MODEL=claude-sonnet-4-6`
- `ROUTING_SMART_PROVIDER=anthropic`
- `ROUTING_SMART_MODEL=claude-sonnet-4-6`

The first implementation should allow switching between Anthropic and OpenAI by env config only.

## Recommended Implementation Order

1. Add OpenAI provider config and type unions.
2. Add OpenAI Responses non-streaming call path.
3. Add Responses input/output format conversion for text-only chat.
4. Add tool definition conversion.
5. Add tool call response parsing.
6. Add tool result replay conversion.
7. Add streaming Responses parser.
8. Add image input conversion and remove or generalize Anthropic-only vision override.
9. Extend usage accounting for cached and reasoning tokens.
10. Add migration tests and smoke-test scripts.
11. Flip smart-tier routing in staging.
12. Run staging against real conversations and tool calls.
13. Deploy through `self-deploy.sh` only after staging passes.

## Verification Plan

Minimum tests before switching production:

- Text-only chat succeeds.
- Streaming chat succeeds.
- Tool call with one tool succeeds.
- Tool call with multiple tools in one turn succeeds.
- Tool-call history persists and replays on the next user turn.
- History truncation does not orphan tool results.
- Image upload succeeds or intentionally falls back to Anthropic.
- Prompt usage includes normal prompt/completion tokens.
- Cached-token accounting is captured when OpenAI returns it.
- Routing smart tier can use OpenAI while fast tier remains xAI.
- Anthropic rollback still works by env switch.

Suggested live smoke tests:

- Ask Squire a normal memory-grounded question.
- Ask Squire a calendar question that requires a tool.
- Ask Squire to perform a multi-step tool workflow.
- Upload an image over the chat socket.
- Continue a conversation after a tool-heavy turn and confirm no provider-format error.

## Main Risks

### Tool-loop compatibility

This is the largest risk. Squire's autonomy depends on tool calls, tool results, persistence, and replay. Provider message-shape differences can cause subtle failures only on the next turn.

### Streaming event mismatch

Responses API streaming will need separate event handling. The current OpenAI-compatible streamer is built around Chat Completions chunks.

### Prompt caching assumptions

OpenAI caching is automatic and prefix-based. The static prompt must remain the first stable prefix. Dynamic memory, time, and schedule context should stay after it.

### Image handling

The current image path is Anthropic-forced. This needs a deliberate OpenAI path or a controlled fallback.

### Model behavior

Even if the API migration works, Squire's personality and tool-use habits may shift. Expect prompt tuning after the mechanical migration.

## Bottom Line

The migration is very doable because Squire already has:

- a canonical provider-neutral message type
- provider-specific format conversion
- provider-specific streaming paths
- routing abstraction
- separated static and dynamic system prompts

But GPT-5.5 should be added as a real OpenAI Responses provider, not as a generic OpenAI-compatible Chat Completions provider. The caching strategy mostly crosses over if Squire preserves its stable-prefix prompt layout and adds cached-token accounting.
