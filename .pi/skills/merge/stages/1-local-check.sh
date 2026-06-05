#!/bin/bash
# stages/1-local-check.sh — 本地验证（类型检查、lint、测试、构建、git 状态）
#
# 用法: stages/1-local-check.sh [--state <file>]
#
# 幂等：checkpoint phase1-passed 存在则跳过
# 退出码: 0=通过, 1=失败

set -euo pipefail

STAGES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
source "$STAGES_DIR/../lib/common.sh"

# 解析 --state 参数
_sf=""
while [[ $# -gt 0 ]]; do case "$1" in --state) _sf="$2"; shift 2 ;; *) shift ;; esac; done

load_state "$(resolve_state_file "$_sf")"

echo ""
echo -e "${BOLD}═══ 阶段 1/7: 本地验证 ═══${NC}"
log_phase "阶段 1: 本地验证"

if is_checkpoint "phase1-passed"; then
    echo -e "${YELLOW}⏭️  跳过阶段 1（已完成）${NC}"
    log_info "跳过阶段 1（checkpoint: phase1-passed 存在）"
    echo -e "${GREEN}✅ 阶段 1 完成${NC}"
    exit 0
fi

# 执行 pre-merge 钩子
run_hook "pre-merge.sh" "$WORKTREE_DIR"

# 运行本地验证脚本
bash "$SKILL_DIR/pre-merge-check.sh" "$WORKTREE_DIR" || {
    echo ""
    echo -e "${RED}${BOLD}⛔ 本地验证失败！修复后重新运行本阶段。${NC}"
    exit 1
}

checkpoint "phase1-passed"
save_state "$STATE_FILE"

echo -e "${GREEN}✅ 阶段 1 完成${NC}"
