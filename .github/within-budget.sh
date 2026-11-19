#!/usr/bin/env bash
# Runs the command until the deadline the job's budget step set (BUDGET_DEADLINE, in epoch
# seconds), so steps that share a budget share it as one limit did before. A command that runs
# out of it fails in words that name the budget.
set -uo pipefail
left=$((BUDGET_DEADLINE - $(date +%s)))
if [ "$left" -lt 1 ]; then left=1; fi
timeout "$left" "$@"
code=$?
if [ "$code" -eq 124 ]; then
  echo "::error title=${BUDGET_NAME}::The ${BUDGET_SECONDS} s budget for ${BUDGET_NAME} ran out during: $*" >&2
fi
exit "$code"
