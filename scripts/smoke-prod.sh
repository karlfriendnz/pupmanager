#!/usr/bin/env bash
# Hits every page route against production and asserts each returns a non-5xx.
# Mirrors tests/smoke/pages.spec.ts but talks to the live app rather than a
# spawned dev server, so it doubles as a deploy validation gate.
#
# Usage:
#   ./scripts/smoke-prod.sh                     # default: app.pupmanager.com
#   ./scripts/smoke-prod.sh https://other-url   # any base URL
#
# Exit code 0 = all green. Non-zero = at least one route 5xx'd.

set -euo pipefail

BASE="${1:-https://app.pupmanager.com}"

PUBLIC_ROUTES=(
  /login /register /forgot-password /verify-email /invite
)

# These all redirect to /login when unauth (307) — what we're guarding against
# is a 5xx, which means the route or middleware crashed before any auth check.
PROTECTED_ROUTES=(
  /dashboard /clients /clients/invite
  /schedule /packages /templates /templates/new
  /products /achievements /enquiries
  /messages /settings /help /ai-tools
  /forms/intake /forms/intake/preview
  /forms/embed/new /forms/session/new
  /progress
  /home /my-sessions /my-availability
  /my-shop /my-help /my-profile /my-messages /notifications
  / /preview-as
  /clients/cmnotreal /sessions/cmnotreal /preview-as/cmnotreal
)

# /form/[unknown] should specifically be a 404 (public page, intentionally
# rejecting unknown ids).
EXACT_404=(
  /form/notarealid
)

fail=0
pass=0
echo "Smoke: $BASE"
echo "─────────────────────────────────────────────"

check_route() {
  local route="$1"
  local code
  # -L disabled so we see the first response code, not the redirect target.
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$BASE$route" || echo "000")
  if [[ "$code" =~ ^(200|301|302|303|307|308|401|404)$ ]]; then
    printf "  ✓ %3s %s\n" "$code" "$route"
    pass=$((pass + 1))
  else
    printf "  ✗ %3s %s\n" "$code" "$route"
    fail=$((fail + 1))
  fi
}

check_exact() {
  local route="$1"
  local expected="$2"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$BASE$route" || echo "000")
  if [[ "$code" == "$expected" ]]; then
    printf "  ✓ %3s %s (expected %s)\n" "$code" "$route" "$expected"
    pass=$((pass + 1))
  else
    printf "  ✗ %3s %s (expected %s)\n" "$code" "$route" "$expected"
    fail=$((fail + 1))
  fi
}

echo "Public:"
for r in "${PUBLIC_ROUTES[@]}"; do check_route "$r"; done

echo
echo "Protected (expect redirect):"
for r in "${PROTECTED_ROUTES[@]}"; do check_route "$r"; done

echo
echo "Exact:"
for r in "${EXACT_404[@]}"; do check_exact "$r" 404; done

echo "─────────────────────────────────────────────"
echo "  $pass pass · $fail fail"

if (( fail > 0 )); then
  echo "❌ Smoke failed — investigate before relying on this deploy."
  exit 1
fi
echo "✅ All routes healthy."
