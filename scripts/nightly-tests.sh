#!/bin/bash
# Nightly full test run — unit (vitest) + the whole e2e suite against the
# isolated embedded Postgres. Driven by the launchd agent
# ~/Library/LaunchAgents/com.pupmanager.nightly-tests.plist.
#
# Runs against whatever is checked out at the time, so the log records the
# branch + commit. Read the tail of the log in the morning:
#   tail -40 ~/Library/Logs/pupmanager-nightly-tests.log
#
# Unload with: launchctl bootout gui/$(id -u)/com.pupmanager.nightly-tests

set -uo pipefail

REPO="/Users/karl/pupmanager"
LOG="$HOME/Library/Logs/pupmanager-nightly-tests.log"
cd "$REPO" || exit 1

# npm/node live under the user's shell setup, not launchd's bare PATH.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

say() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >>"$LOG"; }

say "───────────────────────────────────────────────"
say "START  branch=$(git rev-parse --abbrev-ref HEAD)  commit=$(git rev-parse --short HEAD)"

unit_out=$(npx vitest run 2>&1)
unit_rc=$?
say "UNIT   rc=$unit_rc  $(echo "$unit_out" | grep -E '^\s+Tests ' | tail -1 | xargs)"
[ $unit_rc -ne 0 ] && echo "$unit_out" | tail -60 >>"$LOG"

# The e2e run builds into .next-e2e, so it never disturbs a running dev server.
e2e_out=$(npm run test:e2e:full 2>&1)
e2e_rc=$?
say "E2E    rc=$e2e_rc  $(echo "$e2e_out" | grep -E '^\s+[0-9]+ (passed|failed)' | tail -1 | xargs)"
[ $e2e_rc -ne 0 ] && echo "$e2e_out" | grep -E '✘|Error:|failed' | tail -60 >>"$LOG"

if [ $unit_rc -eq 0 ] && [ $e2e_rc -eq 0 ]; then
  say "DONE   all green"
else
  say "DONE   FAILURES — see above"
fi
