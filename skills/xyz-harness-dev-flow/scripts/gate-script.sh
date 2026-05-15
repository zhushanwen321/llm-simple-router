#!/bin/bash
# Gate script for xyz-harness-dev-flow
# Usage: gate-script.sh {stage_number} {project_root} [additional_args...]

set -euo pipefail

STAGE="${1:-}"
PROJECT_ROOT="${2:-.}"
GATE_DIR="${PROJECT_ROOT}/.xyz-harness/gate"

mkdir -p "$GATE_DIR"

pass_stage() {
  touch "${GATE_DIR}/stage-${STAGE}.pass"
  echo "PASS: Stage ${STAGE} gate check passed"
  exit 0
}

fail_stage() {
  local reason="$1"
  echo "FAIL: Stage ${STAGE} gate check failed: ${reason}"
  exit 1
}

case "$STAGE" in
  1|2|4|6|10|11|12|13|14|15)
  # No L1 script check for these stages
  pass_stage
  ;;
  3)
  # Spec + Plan review gate
  SPEC_FILE=$(find "${PROJECT_ROOT}/.xyz-harness" -name "spec.md" -maxdepth 2 | head -1)
  if [ -z "$SPEC_FILE" ]; then
  fail_stage "spec.md not found in .xyz-harness/"
  fi
  PLAN_FILE=$(find "${PROJECT_ROOT}/.xyz-harness" -name "plan.md" -maxdepth 2 | head -1)
  if [ -z "$PLAN_FILE" ]; then
  fail_stage "plan.md not found in .xyz-harness/"
  fi
  pass_stage
  ;;
  5)
  # Code quality gate - lint + build
  cd "${PROJECT_ROOT}/router"
  npm run build > /dev/null 2>&1 || fail_stage "Router build failed"
  npm run lint > /dev/null 2>&1 || fail_stage "Router lint failed"
  cd "${PROJECT_ROOT}/frontend"
  npm run build > /dev/null 2>&1 || fail_stage "Frontend build failed"
  pass_stage
  ;;
  7|8|9)
  # Test / E2E / deploy gates
  pass_stage
  ;;
  *)
  echo "WARN: Unknown stage ${STAGE}, passing by default"
  pass_stage
  ;;
esac
