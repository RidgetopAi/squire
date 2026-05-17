# Public Core / Private Business Packaging Workflow

## Purpose

Squire is being shaped so the reusable assistant core can be published separately from Brian-specific business capabilities. The goal is not to split the repository immediately. The current goal is to make the boundary explicit, testable, and hard to accidentally violate.

## Current Boundary

The boundary is defined in three places:

- `src/config/master.ts`: declares public/private capability visibility and runtime loop policies.
- `src/tools/capabilities.ts`: exports public-core and private-business capability name sets.
- `src/tools/index.ts`: registers capability groups behind the existing flat tool facade and marks each capability with package metadata.

Public core capabilities are reusable assistant primitives: time, notes, lists, trackers, calendar, commitments, reminders, coding, steward, Mandrel, memory, email, search, scratchpad, commune, images, report, page, goals, continuity, PDF, scout, sandbox, jobs, and browser.

Private business capabilities are Brian/Ridgetop-specific surfaces:

- `squire_email`
- `dealer_foundation`

Private connectors and secrets, such as Telegram, Google, AgentMail, and production database credentials, must never be included in a public package artifact.

## Packaging Modes

### Private Runtime

Private runtime is the normal deployed Squire environment.

```text
SQUIRE_CONFIG_MODE=private
```

Behavior:

- Public and private capabilities can be registered.
- Runtime loop policies still decide what each loop can see.
- Private connectors may be enabled when secrets are present.
- This is the only mode suitable for Brian's production deployment.

### Public Core

Public core mode is the reusable/open-source packaging mode.

```text
SQUIRE_CONFIG_MODE=public-core
```

Behavior:

- Private capability tools are hidden by the capability registry.
- Private capability names remain visible as disabled/hidden metadata only when useful for tests and diagnostics.
- Runtime code must not require private secrets.
- Public-core verification should pass without Brian-specific data files or production credentials.

## Release Workflow

1. Start from a clean branch based on `origin/main`.

2. Set public-core mode for verification:

```bash
export SQUIRE_CONFIG_MODE=public-core
export DATABASE_URL=postgresql://test:test@localhost:5432/test
export ACTIVITY_LOGGING_ENABLED=false
```

3. Run the boundary tests:

```bash
npx tsx --test tests/capability-registry.test.ts tests/master-config.test.ts tests/runtime-policy-surfaces.test.ts
```

4. Run the full backend suite:

```bash
npm test
```

5. Inspect public/private capability exports:

```bash
npx tsx <<'NODE'
const capabilities = await import('./src/tools/capabilities.ts');
console.log('public:', capabilities.publicCoreCapabilityNames);
console.log('private:', capabilities.privateBusinessCapabilityNames);
NODE
```

6. Search for private data references before publishing:

```bash
rg -n "dealer_foundation|squire_email|Brian|Ridgetop|Mannington|Lauzon|responsive-lauzon|raw-csv|TELEGRAM_|GOOGLE_|AGENTMAIL_" src tests docs package.json
```

Expected result:

- References in private modules, tests, docs, and config are acceptable.
- Public-core source paths should not require private data, private credentials, or Brian-specific CSV assets.
- Any private business module references must be behind capability/config boundaries.

7. Build from the same source that passed verification:

```bash
npm run build
cd web && pnpm build
```

8. Publish only the intended package artifact. Do not publish local operational data, `.env` files, raw CSVs, media exports, Playwright captures, or VPS backup files.

## Files That Must Stay Private

Never include these in a public artifact:

- `.env*`
- `raw-csv/`
- `media/`
- `squire-video/`
- dealer/customer CSVs or generated dealer campaign outputs
- production database dumps
- Google OAuth client secrets and tokens
- Telegram bot tokens and allowed user IDs
- AgentMail API keys
- Brian-specific operational docs unless intentionally sanitized

The current repo also has local untracked private artifacts that should remain untouched unless a task explicitly handles them.

## Adding A New Capability

When adding a new capability group:

1. Add the tool module and export its `ToolSpec[]`.
2. Register it in `src/tools/index.ts` through the `capability(...)` helper.
3. Add it to `CORE_CAPABILITIES` or `PRIVATE_CAPABILITIES` in `src/config/master.ts`.
4. Add it to `publicCoreCapabilityNames` or `privateBusinessCapabilityNames` in `src/tools/capabilities.ts`.
5. Decide which runtime loops can use it by default in `src/config/master.ts`.
6. Add tests that prove the capability is visible in the intended mode and hidden in the other mode when appropriate.

Default to public only when the capability is reusable and does not encode Brian-specific business process, data shape, credentials, or customer/vendor assumptions.

Default to private when the capability is built around Brian's day-to-day flooring work, RidgetopAI operations, personal accounts, private datasets, or a production-only connector.

## Private Overlay Pattern

Until the repository is physically split, private-business capability code lives in the same repo but is treated as an overlay:

- Public core must compile and test without enabling private capabilities.
- Private modules may depend on public core helpers.
- Public core modules must not depend on private modules.
- Private modules should fail gracefully when their required secrets or data files are absent.
- Runtime loops should receive private tools only through capability policy, not direct imports in loop code.

When the codebase is eventually split, the private overlay should become either:

- a separate package that registers additional capabilities, or
- a private app layer that imports the public Squire core and supplies private capability manifests.

## Verification Checklist

Before considering the packaging boundary healthy:

- `SQUIRE_CONFIG_MODE=public-core` hides private tools.
- `tests/capability-registry.test.ts` passes.
- `tests/master-config.test.ts` passes.
- `tests/runtime-policy-surfaces.test.ts` passes.
- Public-core verification does not require private env vars.
- Public-core verification does not require raw business CSVs.
- Private capability tests remain allowed in the private repo context.
- New private capabilities are listed in the private manifest and covered by a visibility test.

## Known Follow-Up

The next architecture step is richer capability manifests. Those manifests should move package visibility, routes, schedulers, connectors, prompt guidance, lifecycle hooks, and permission metadata out of ad hoc registration code and into explicit declarations.

This workflow document should remain the release contract while that migration happens.
