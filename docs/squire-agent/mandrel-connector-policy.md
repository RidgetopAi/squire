# Mandrel Connector Policy

## Decision

Squire runtime uses Mandrel's HTTP bridge as its production connector transport.

The in-process runtime does not currently implement a true MCP client transport. `MANDREL_TRANSPORT=mcp` is reserved for a future native MCP adapter or for strict policy checks that intentionally deny HTTP bridge calls unless `MANDREL_ALLOW_HTTP_FALLBACK=true` is set.

## Runtime Contract

Every Squire-originated Mandrel call goes through `src/services/mandrel/client.ts`.

The HTTP request shape is:

```json
{
  "arguments": {}
}
```

The client always sends `X-Connection-ID` using this stable format:

```text
squire:<NODE_ENV>:<MANDREL_CONNECTION_SCOPE>:<project>
```

The default project is `squire-agent`, and the default connection scope is `runtime`.

## Project Isolation

Mandrel project/session state is isolated by connection ID. Squire must not call the HTTP bridge without `X-Connection-ID`, because unscoped HTTP calls fall back to Mandrel's shared `http-default` connection and can make project state appear shared across runtimes.

For `project_switch`, the target project becomes part of the connection ID so the switch applies to the same scoped connection that will later use that project. For tools without an explicit project argument, the configured `MANDREL_PROJECT` is used.

## Configuration

Defaults:

```text
MANDREL_TRANSPORT=http-bridge
MANDREL_REQUIRE_STABLE_CONNECTION_ID=true
MANDREL_ALLOW_HTTP_FALLBACK=false
MANDREL_PROJECT=squire-agent
MANDREL_CONNECTION_SCOPE=runtime
```

Supported modes:

- `MANDREL_TRANSPORT=http-bridge`: production runtime mode. HTTP bridge calls are allowed and must include stable identity.
- `MANDREL_TRANSPORT=mcp` with `MANDREL_ALLOW_HTTP_FALLBACK=false`: strict future mode. Calls are denied because no native MCP adapter is implemented yet.
- `MANDREL_TRANSPORT=mcp` with `MANDREL_ALLOW_HTTP_FALLBACK=true`: transitional compatibility mode. Calls still use the HTTP bridge but are recorded as fallback usage in Activity metadata.

## Activity Logging

Mandrel calls emit `mandrel.call` activity events with:

- tool name
- arguments
- connection ID
- transport
- completion, failure, or denied status
- duration

This keeps project-isolation mistakes and transport-policy failures visible in `/api/activity` and the Activity UI.

## Future Native MCP Adapter

A future native MCP adapter should be added behind the existing `callMandrelTool` API so Squire tools do not change. When that exists, `MANDREL_TRANSPORT=mcp` can become an executable transport instead of strict deny mode.
