#!/usr/bin/env bash
# Re-points dbeans.vercel.app / dbeans-api.vercel.app at whichever deployment
# Vercel just built for the current commit.
#
# Why this is needed at all: those two domains are plain vercel.app vanity
# aliases (set once via `vercel alias set`), not real Domains attached to the
# project (`vercel domains inspect dbeans.vercel.app` returns "no access" --
# it isn't a resource Vercel tracks that way). Only a project's own
# auto-generated / git-branch domains follow every new deploy automatically;
# a vanity alias like this is a static pointer that keeps serving whatever it
# was last set to until re-run. See docs/DEPLOYMENT.md's "clean vercel.app
# URL" section for the incident this caused.
#
# Run this right after `git push origin main` (once Vercel's git integration
# has picked up the push and started building).
set -euo pipefail

SHA=$(git rev-parse HEAD)
TIMEOUT_SECS=180
INTERVAL_SECS=5

realias() {
  local project="$1" domain="$2" waited=0 state url json

  echo "[$project] waiting for the deployment of ${SHA:0:12} to go Ready..."
  while true; do
    json=$(vercel list "$project" --json --meta githubCommitSha="$SHA" 2>/dev/null || echo '{}')
    state=$(node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);console.log((j.deployments&&j.deployments[0]&&j.deployments[0].state)||'')}catch(e){console.log('')}})" <<<"$json")
    url=$(node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);console.log((j.deployments&&j.deployments[0]&&j.deployments[0].url)||'')}catch(e){console.log('')}})" <<<"$json")

    if [ "$state" = "READY" ] && [ -n "$url" ]; then
      echo "[$project] ready: https://$url -> aliasing to $domain"
      vercel alias set "https://$url" "$domain"
      return 0
    fi
    if [ "$state" = "ERROR" ] || [ "$state" = "CANCELED" ]; then
      echo "[$project] deployment for ${SHA:0:12} finished as $state -- not aliasing" >&2
      return 1
    fi

    if [ "$waited" -ge "$TIMEOUT_SECS" ]; then
      echo "[$project] timed out after ${TIMEOUT_SECS}s waiting for ${SHA:0:12} (last state: ${state:-none found yet})" >&2
      return 1
    fi
    sleep "$INTERVAL_SECS"
    waited=$((waited + INTERVAL_SECS))
  done
}

status=0
realias frontend dbeans.vercel.app || status=1
realias backend dbeans-api.vercel.app || status=1

if [ "$status" -eq 0 ]; then
  echo "Both aliases now point at ${SHA:0:12}."
else
  echo "One or more re-aliases failed -- check output above." >&2
fi
exit "$status"
