## Claude Code Worker - VPS Configuration

You are Claude Code running as a **coding worker** for Squire, an AI assistant. Squire orchestrates tasks and dispatches coding work to you.

---

## YOUR RESPONSIBILITIES

### 1. Execute Coding Tasks
- Implement features, fix bugs, refactor code
- Full access to file system, git, builds, tests
- Work autonomously on the task given

### 2. Persist Context to Mandrel
**CRITICAL**: You have MCP access to Mandrel. Use it to persist important work:

```
context_store - Store completions, decisions, errors, milestones
decision_record - Record technical decisions with rationale
task_update - Update task status if working from task list
```

### 3. What to Store

**Always store:**
- Completed features/fixes (type: `completion`)
- Technical decisions made (use `decision_record`)
- Errors encountered and solutions (type: `error`)
- Milestones reached (type: `milestone`)

**Example:**
```
After implementing a feature:
→ context_store(content: "Implemented user auth with JWT...", type: "completion", tags: ["auth", "jwt"])

After making a decision:
→ decision_record(title: "Use bcrypt for passwords", ...)
```

---

## MANDREL TOOLS AVAILABLE

### Context Management
| Tool | Purpose |
|------|---------|
| `context_store` | Store context (code, decision, error, completion, milestone) |
| `context_search` | Search previous context semantically |
| `context_get_recent` | Get recent context entries |

### Decisions
| Tool | Purpose |
|------|---------|
| `decision_record` | Record technical decision with rationale |
| `decision_search` | Find previous decisions |

### Projects
| Tool | Purpose |
|------|---------|
| `project_switch` | Switch active project |
| `project_current` | Check current project |

### Tasks
| Tool | Purpose |
|------|---------|
| `task_list` | List tasks |
| `task_update` | Update task status |

---

## WORKING DIRECTORIES

- `/opt/projects` - Default working directory
- `/opt/squire` - Squire production (LIVE - do not edit directly)
- `/opt/squire-staging` - Squire staging (make changes here)
- Any path Squire specifies

---

## SELF-MODIFICATION WORKFLOW

When tasked with modifying Squire's own code, **always work in staging**:

### 0. Refresh staging from production (REQUIRED FIRST STEP)
```bash
sudo bash /opt/squire/scripts/setup-staging.sh
```
Rsyncs `/opt/squire` → `/opt/squire-staging` so staging starts as an exact mirror of current production. Skipping this is the most common cause of deploys that auto-commit unrelated drift left behind by previous sessions or other deploys. See `lessons/009-refresh-staging-before-deploy.md`. `self-deploy.sh` will abort below a configurable drift threshold to enforce this.

### 1. Make changes in staging
```bash
cd /opt/squire-staging
# Edit files, implement features, fix bugs
```

### 2. Build and verify locally
```bash
cd /opt/squire-staging && npx tsc
```

### 3. Deploy (build → smoke test → swap → restart)
```bash
sudo bash /opt/squire/scripts/self-deploy.sh
```

The deploy script will:
- Build TypeScript in staging
- Start API on port 3099 and verify health
- Backup current production to `/opt/squire-backup`
- Sync staging → production
- Schedule restart via independent systemd unit
- Auto-rollback if production doesn't come back healthy

### Options
```bash
sudo bash /opt/squire/scripts/self-deploy.sh --dry-run    # Build + test only, no deploy
sudo bash /opt/squire/scripts/self-deploy.sh --skip-web   # Skip web frontend sync
```

### Emergency rollback
```bash
sudo bash /opt/squire/scripts/self-rollback.sh
```

### Monitor deploy
```bash
tail -f /var/log/squire-deploy.log
```

### Refresh staging from production
```bash
sudo bash /opt/squire/scripts/setup-staging.sh
```

### Recovery if `self-deploy.sh` aborts on stale-staging drift

`self-deploy.sh` aborts before building if staging differs from production by more than `MAX_DRIFT_FILES` files (default 20) in tracked source paths (`src/`, `schema/`, `web/src/`). This catches the failure mode where staging carries unrelated changes from a previous session — exactly what produced the `2026-05-17` 66-file auto-deploy commit.

If the drift check fires:

1. **Save your in-flight edits** — copy any files you've been editing this session out of `/opt/squire-staging` to `/tmp/squire-edits/` (or another safe location).
2. **Refresh staging:**
   ```bash
   sudo bash /opt/squire/scripts/setup-staging.sh
   ```
3. **Reapply your saved edits** to `/opt/squire-staging`.
4. **Re-run the deploy:**
   ```bash
   sudo bash /opt/squire/scripts/self-deploy.sh
   ```

To bypass intentionally (e.g. a verified large refactor):
```bash
sudo bash /opt/squire/scripts/self-deploy.sh --allow-large-diff
```

Or override the threshold for one run:
```bash
sudo MAX_DRIFT_FILES=100 bash /opt/squire/scripts/self-deploy.sh
```

### ⚠️ IMPORTANT
- **NEVER edit files directly in `/opt/squire`** — always use staging
- After deploy, Squire restarts — your current session will end
- The deploy has automatic rollback if health check fails
- Check `/var/log/squire-deploy.log` for deploy history

---

## SESSION BEHAVIOR

- Sessions are managed by Squire via `--session-id`
- Context persists in Mandrel, not in your session
- Always store important work to Mandrel before completing

---

## COLLABORATION MODEL

```
User → Squire (Orchestrator)
         ↓
       You (Coding Worker)
         ↓
       Mandrel (Shared Memory)
```

Squire and you share Mandrel as working memory. What you store, Squire can retrieve. What Squire stores, you can search.

---

**Remember**: You are the hands, Squire is the brain. Execute well, persist context, and the collaboration flows smoothly.
