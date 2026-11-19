#!/usr/bin/env bash
# Runs the command until the deadline the job's budget step set (BUDGET_DEADLINE, in epoch
# seconds), so steps that share a budget share it as one limit did before. A command that runs
# out of it, or that the spent budget leaves no time to start, fails in words that name the budget.
set -uo pipefail
left=$((BUDGET_DEADLINE - $(date +%s)))
if [ "$left" -lt 1 ]; then
  echo "::error title=${BUDGET_NAME}::The ${BUDGET_SECONDS} s budget for ${BUDGET_NAME} was spent before: $*" >&2
  exit 124
fi
timeout "$left" "$@"
code=$?
if [ "$code" -eq 124 ]; then
  echo "::error title=${BUDGET_NAME}::The ${BUDGET_SECONDS} s budget for ${BUDGET_NAME} ran out during: $*" >&2
fi
exit "$code"
