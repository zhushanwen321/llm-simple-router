#!/bin/bash
# stages/7-cleanup.sh — 清理 worktree + 同步其他 worktree
#
# 用法: stages/7-cleanup.sh [--state <file>]
#
# ⚠️  前置条件: 阶段 6 交付物确认必须通过（checkpoint deliverables-verified 存在）
#     如果未通过，本脚本拒绝执行。
#
# 退出码: 0=成功, 1=失败

set -euo pipefail

STAGES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
source "$STAGES_DIR/../lib/common.sh"

_sf=""
while [[ $# -gt 0 ]]; do case "$1" in --state) _sf="$2"; shift 2 ;; *) shift ;; esac; done

load_state "$(resolve_state_file "$_sf")"

# ── 门禁: 交付物确认 ──────────────────────────────
if ! is_checkpoint "deliverables-verified"; then
    echo ""
    echo -e "${RED}${BOLD}⛔ 安全阻断：交付物未确认！${NC}"
    echo ""
    echo "  清理 worktree 前必须先通过交付物确认。"
    echo "  执行: stages/6-verify.sh"
    echo ""
    echo -e "  ${RED}${BOLD}禁止绕过此检查。${NC}"
    exit 1
fi

echo ""
echo -e "${BOLD}═══ 阶段 7/7: 清理 ═══${NC}"
log_phase "阶段 7: 清理"

cd "$WS_ROOT"

# ── 删除 feature worktree ──────────────────────────
if [[ -f "$SKILL_DIR/../remove-worktree/remove-worktree.sh" ]]; then
    bash "$SKILL_DIR/../remove-worktree/remove-worktree.sh" "$BRANCH_NAME" --force --skip-sync 2>&1 || {
        echo -e "${YELLOW}Warning: worktree 清理失败，可手动处理${NC}"
    }
else
    echo -e "${YELLOW}⚠️  未找到 remove-worktree 脚本${NC}"
    echo "  手动删除: git -C ${WS_ROOT}/.bare worktree remove ${WORKTREE_DIR}"
fi

# ── 同步其他 worktree ──────────────────────────────
echo ""
echo "  同步其他 worktree..."
for _wt_entry in "$WS_ROOT"/*/; do
    _wt_name="${_wt_entry%/}"
    [[ "$_wt_name" == *"/main" ]] && continue
    [[ "$_wt_name" == *"/master" ]] && continue
    _wt_base=$(basename "$_wt_name")
    [[ "$_wt_base" == ".bare" ]] && continue
    [[ "$_wt_base" == "node_modules" ]] && continue
    [[ -d "$_wt_name" ]] || continue

    _branch=$(git -C "$_wt_name" rev-parse --abbrev-ref HEAD 2>/dev/null) || continue
    [[ -z "$_branch" ]] && continue
    [[ "$_branch" == "main" || "$_branch" == "master" ]] && continue

    echo "    同步 $_wt_name ($_branch)..."
    (
        cd "$_wt_name"
        git fetch "$GH_REMOTE" main 2>&1 | tail -1
        git merge --no-ff "$GH_REMOTE/main" 2>&1 | tail -1 || {
            echo -e "    ${YELLOW}冲突: $_wt_name${NC}"
        }
    )
done

# ── 清理临时文件和断点 ────────────────────────────
rm -f "$WS_ROOT/.release-notes-auto.md" "$WS_ROOT/.release-commits.txt"
rm -f "$STATE_FILE"
clear_checkpoints

# ── 日志轮转 ────────────────────────────────────
if [[ -n "$LOG_FILE" ]] && [[ -d "$(dirname "$LOG_FILE")" ]]; then
    ls -1t "$(dirname "$LOG_FILE")"/*.log 2>/dev/null | tail -n +31 | xargs rm -f 2>/dev/null || true
fi

# ── 最终报告 ────────────────────────────────────
{
    echo ""
    echo "==========================================="
    echo "流程完成"
    echo "  PR: #$PR_NUMBER"
    echo "  版本: v$NEW_VERSION"
    echo "  Release: ${RELEASE_URL:-}"
    echo "  日志文件: $LOG_FILE"
    echo "==========================================="
} >> "$LOG_FILE" 2>/dev/null || true

echo ""
echo "══════════════════════════════════════════════════"
echo -e "${GREEN}${BOLD}✅ 端到端流程全部完成！${NC}"
echo "  PR: #$PR_NUMBER"
echo "  版本: v$NEW_VERSION"
echo "  Release: ${RELEASE_URL:-}"
echo "  分支: $BRANCH_NAME (已清理)"
if $DRAFT_MODE; then
    echo ""
    echo "  Draft Release 需要手动发布:"
    echo "    gh release edit $TAG ${GH_REPO:+--repo $GH_REPO} --draft=false"
fi
echo "══════════════════════════════════════════════════"
