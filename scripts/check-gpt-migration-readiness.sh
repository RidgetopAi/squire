#!/usr/bin/env bash
# Check whether an environment is ready for the GPT/Codex migration cutover.

set -euo pipefail

ENV_FILE="${1:-.env}"
STATUS=0

warn() {
  printf 'WARN: %s\n' "$1"
}

fail() {
  printf 'FAIL: %s\n' "$1"
  STATUS=1
}

pass() {
  printf 'PASS: %s\n' "$1"
}

env_value() {
  local name="$1"
  if [ ! -f "$ENV_FILE" ]; then
    return 0
  fi
  grep -E "^${name}=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- || true
}

has_real_value() {
  local value="$1"
  [ -n "$value" ] && [[ "$value" != your_* ]] && [ "$value" != "placeholder" ]
}

printf 'Squire GPT migration readiness\n'
printf 'Environment: %s\n\n' "$ENV_FILE"

if [ ! -f "$ENV_FILE" ]; then
  fail "Environment file not found"
else
  pass "Environment file exists"
fi

if grep -q 'grok-4-1-fast-reasoning' "$ENV_FILE" 2>/dev/null; then
  fail "Deprecated grok-4-1-fast-reasoning is still configured"
else
  pass "Deprecated Grok 4.1 fast reasoning model is not configured"
fi

if has_real_value "$(env_value OPENAI_API_KEY)"; then
  pass "OPENAI_API_KEY is configured"
else
  fail "OPENAI_API_KEY is required for OpenAI API slots"
fi

main_provider="$(env_value LLM_PROVIDER)"
main_model="$(env_value LLM_MODEL)"
smart_provider="$(env_value ROUTING_SMART_PROVIDER)"
smart_model="$(env_value ROUTING_SMART_MODEL)"
if [ -z "$main_provider" ] || [ "$main_provider" = "openai" ]; then
  pass "Main chat provider resolves to openai default or explicit value"
else
  fail "Main chat LLM_PROVIDER is '$main_provider' instead of openai"
fi

if [ -z "$main_model" ] || [ "$main_model" = "gpt-5.5" ]; then
  pass "Main chat model resolves to gpt-5.5 default or explicit value"
else
  fail "Main chat LLM_MODEL is '$main_model' instead of gpt-5.5"
fi

if [ -z "$smart_provider" ] || [ "$smart_provider" = "openai" ]; then
  pass "Smart routing provider resolves to openai default or explicit value"
else
  fail "ROUTING_SMART_PROVIDER is '$smart_provider' instead of openai"
fi

if [ -z "$smart_model" ] || [ "$smart_model" = "gpt-5.5" ]; then
  pass "Smart routing model resolves to gpt-5.5 default or explicit value"
else
  fail "ROUTING_SMART_MODEL is '$smart_model' instead of gpt-5.5"
fi

if command -v codex >/dev/null 2>&1; then
  pass "Codex CLI is installed"
  if codex login status >/dev/null 2>&1; then
    pass "Codex CLI is authenticated"
  elif command -v sudo >/dev/null 2>&1 && sudo -u ridgetop -H codex login status >/dev/null 2>&1; then
    pass "Codex CLI is authenticated for ridgetop"
  else
    fail "Codex CLI is installed but not authenticated"
  fi
else
  warn "Codex CLI not found on PATH"
fi

if [ -d /opt/squire-db-backups ] && find /opt/squire-db-backups -maxdepth 1 -name '*.dump' -size +0c | grep -q .; then
  pass "Non-empty DB dump exists in /opt/squire-db-backups"
else
  warn "No non-empty DB dump found in /opt/squire-db-backups"
fi

printf '\n'
if [ "$STATUS" -eq 0 ]; then
  printf 'Ready for GPT migration cutover checks.\n'
else
  printf 'Not ready for cutover. Fix FAIL items first.\n'
fi

exit "$STATUS"
