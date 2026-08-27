#!/usr/bin/env bash
# One sweep pass, or a loop of them.
#
# Driven by `.github/workflows/scheduled-notifications.yml`, which decides
# which pass to run and how long to keep running it:
#
#   MODE                    dispatch | maintenance | materialise | full
#   SWEEP_MINUTES           0 for a single pass; a duration to loop for
#   SWEEP_INTERVAL_SECONDS  how long to sleep between passes of a loop
#
# The three schedules cost very different amounts and the endpoint is the one
# that knows it, so this script has no opinion about any of that — it presents
# the bearer token, reports what came back, and fails the run only on a
# rejected token or five consecutive bad passes. One bad pass is a cold start
# or a blip, and the sweep's own watermark means the next one covers whatever
# it missed.
set -uo pipefail

# Whatever goes wrong here has to be readable without opening the job log.
# GitHub renders `::error::` on the run's own summary page, next to the red
# cross, which is the one screen somebody actually looks at.
fail() {
  echo "::error title=Sweep failed::$1"
  exit 1
}

if [ -z "${CRON_SECRET}" ]; then
  fail "CRON_SECRET repository secret is not set — the endpoint would answer 401."
fi

deadline=$(( $(date +%s) + SWEEP_MINUTES * 60 ))
failures=0
passes=0

while : ; do
  status=$(curl --silent --show-error --location \
    --max-time 120 \
    --output response.json \
    --write-out '%{http_code}' \
    --header "Authorization: Bearer ${CRON_SECRET}" \
    "${APP_URL}/api/cron/notifications?mode=${MODE}") || status="000"

  passes=$(( passes + 1 ))
  body=$(head -c 600 response.json)
  echo "[$(date -u +%H:%M:%SZ)] ${MODE} HTTP ${status} ${body}"

  if [ "${status}" = "401" ] || [ "${status}" = "403" ]; then
    fail "HTTP ${status} — the endpoint rejected the bearer token. The CRON_SECRET repository secret and the CRON_SECRET environment variable in the Vercel production deployment are not the same value. Response: ${body}"
  fi

  if [ "${status}" = "000" ]; then
    fail "The request to ${APP_URL}/api/cron/notifications?mode=${MODE} did not complete at all — the host is unreachable or timed out."
  fi

  # The daily Firestore read cap. Not a failure of this run: the sweep throws
  # before advancing its watermark, so the first pass after the counter resets
  # covers everything the exhausted ones could not read. Failing here would turn
  # one spent quota into a wall of red runs for the rest of the day.
  if [ "${status}" = "503" ]; then
    echo "::warning title=Quota exhausted::The Firestore daily read limit is spent, so the ${MODE} pass read nothing. It resets at 10:00 Kyiv time and the next pass picks up where this one stopped."
    failures=0
    [ "${SWEEP_MINUTES}" = "0" ] && break
    sleep "${SWEEP_INTERVAL_SECONDS}"
    continue
  fi

  if [ "${status}" != "200" ]; then
    failures=$(( failures + 1 ))
    if [ "${failures}" -ge 5 ]; then
      fail "Five consecutive failed ${MODE} sweeps. Last response: HTTP ${status} ${body}"
    fi
    # A single pass has no next attempt to recover in, so it fails loudly.
    if [ "${SWEEP_MINUTES}" = "0" ]; then
      fail "The ${MODE} pass answered HTTP ${status}: ${body}"
    fi
  else
    failures=0
  fi

  [ "$(date +%s)" -ge "${deadline}" ] && break
  sleep "${SWEEP_INTERVAL_SECONDS}"
done

echo "Completed ${passes} ${MODE} sweep(s)."
