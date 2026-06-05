#!/bin/bash
# stages/3-post-merge-ci.sh — 等待 Post-merge CI 通过
#
# 用法: stages/3-post-merge-ci.sh [--state <file>]
#
# 退出码: 0=CI通过, 1=CI失败/超时

set -euo pipefail

STAGES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
source "$STAGES_DIR/../lib/common.sh"

_sf=""
while [[ $# -gt 0 ]]; do case "$1" in --state) _sf="$2"; shift 2 ;; *) shift ;; esac; done

load_state "$(resolve_state_file "$_sf")"

echo ""
echo -e "${BOLD}═══ 阶段 3/7: Post-merge CI 验证 ═══${NC}"
log_phase "阶段 3: Post-merge CI"

git -C "$MAIN_WT" fetch "$GH_REMOTE" main 2>&1 | tail -1
MAIN_SHA=$(git -C "$MAIN_WT" rev-parse "$GH_REMOTE/main")
echo "  main SHA: $MAIN_SHA"

bash "$SKILL_DIR/wait-for-ci.sh" "$MAIN_SHA" || {
    WAIT_EXIT=$?
    if [[ $WAIT_EXIT -eq 3 ]]; then
        echo -e "  ${GREEN}项目无 CI workflow，跳过等待${NC}"
        log_info "项目无 CI workflow，跳过 (SHA=$MAIN_SHA)"
        save_state "$STATE_FILE"
        echo -e "${GREEN}✅ 阶段 3 完成（无 CI）${NC}"
        exit 0
    fi
    if [[ $WAIT_EXIT -eq 1 ]]; then
        echo ""
        echo -e "${RED}${BOLD}⛔ Post-merge CI 失败！${NC}"
        echo ""
        echo "修复步骤："
        echo "  1. 在 main worktree 中查看日志并修复: gh run view <run-id> --log-failed"
        echo "  2. git push origin main"
        echo "  3. 重新运行本阶段"
        exit 1
    fi
    # exit 2 = 超时或 CI 未触发
    echo -e "${YELLOW}${BOLD}⚠️  CI 等待超时或未触发，需要用户确认${NC}"
    exit 1
}

log_info "Post-merge CI 通过 (SHA=$MAIN_SHA)"
save_state "$STATE_FILE"
echo -e "${GREEN}✅ 阶段 3 完成${NC}"
