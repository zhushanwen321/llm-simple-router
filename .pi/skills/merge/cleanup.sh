#!/bin/bash
# cleanup.sh — 清理 feature worktree + 同步其他 worktree
#
# 用法: bash cleanup.sh <worktree-dir> [--skip-sync]
#
# 参数:
#   <worktree-dir>   要清理的 feature worktree 目录路径
#   --skip-sync      跳过同步其他 worktree
#
# ⚠️  这是破坏性操作（删除 worktree），请确认后再执行！
#
# 退出码: 0=成功, 1=失败

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

# ── 参数解析 ──────────────────────────────────────
WORKTREE_DIR=""
SKIP_SYNC=false

POSITIONAL=()
while [[ $# -gt 0 ]]; do
    case "$1" in
        --skip-sync) SKIP_SYNC=true; shift ;;
        -*)          echo -e "${RED}Error: 未知选项 $1${NC}"; exit 1 ;;
        *)           POSITIONAL+=("$1"); shift ;;
    esac
done
set -- "${POSITIONAL[@]}"

WORKTREE_DIR="${1:?Usage: cleanup.sh <worktree-dir> [--skip-sync]}"
WORKTREE_DIR=$(cd "$WORKTREE_DIR" 2>/dev/null && pwd -P || echo "")

if [[ -z "$WORKTREE_DIR" || ! -d "$WORKTREE_DIR" ]]; then
    echo -e "${RED}Error: 工作目录不存在: $1${NC}"
    exit 1
fi

# ── 环境检测 ──────────────────────────────────────
WS_ROOT=""
_dir="$WORKTREE_DIR"
while [[ "$_dir" != "/" ]]; do
    if [[ -d "$_dir/.bare" ]] || [[ -d "$_dir/.git" ]]; then
        WS_ROOT="$_dir"
        break
    fi
    _dir="$(dirname "$_dir")"
done

if [[ -z "$WS_ROOT" ]]; then
    echo -e "${RED}Error: 未找到 workspace root${NC}"
    exit 1
fi

BRANCH_NAME=$(git -C "$WORKTREE_DIR" branch --show-current 2>/dev/null || echo "")

# 自动检测 GitHub remote
GH_REMOTE="origin"
if git -C "$WORKTREE_DIR" remote get-url github &>/dev/null; then
    GH_REMOTE="github"
fi

echo ""
echo -e "${BOLD}═══ 清理 Worktree ═══${NC}"
echo "  目录: $WORKTREE_DIR"
echo "  分支: ${BRANCH_NAME:-unknown}"
echo ""

# ── 1. 删除 feature worktree ──────────────────────────
if [[ -f "$SCRIPT_DIR/../remove-worktree/remove-worktree.sh" ]]; then
    bash "$SCRIPT_DIR/../remove-worktree/remove-worktree.sh" "$BRANCH_NAME" --force --skip-sync 2>&1 || {
        echo -e "${YELLOW}Warning: worktree 清理脚本失败，尝试手动删除${NC}"
        # fallback: 手动删除
        if [[ -d "$WORKTREE_DIR" ]]; then
            git -C "${WS_ROOT}/.bare" worktree remove "$WORKTREE_DIR" --force 2>&1 || {
                echo -e "${YELLOW}Warning: git worktree remove 失败，手动 rm -rf${NC}"
                rm -rf "$WORKTREE_DIR"
            }
        fi
    }
else
    echo "  使用 git worktree remove..."
    if [[ -d "$WORKTREE_DIR" ]]; then
        git -C "${WS_ROOT}/.bare" worktree remove "$WORKTREE_DIR" --force 2>&1 || {
            echo -e "${YELLOW}Warning: git worktree remove 失败，手动 rm -rf${NC}"
            rm -rf "$WORKTREE_DIR"
        }
    fi
fi
echo -e "  ${GREEN}✅ worktree 已删除${NC}"

# ── 2. 同步其他 worktree ──────────────────────────────
if ! $SKIP_SYNC; then
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
    echo -e "  ${GREEN}✅ worktree 同步完成${NC}"
else
    echo -e "  ${YELLOW}⏭️  跳过 worktree 同步${NC}"
fi

# ── 3. 清理临时文件 ────────────────────────────────
rm -f "$WS_ROOT/.release-notes-auto.md" "$WS_ROOT/.release-commits.txt"
rm -f "$WS_ROOT/.merge-worktree-state.env"
rm -rf "$WS_ROOT/.merge-checkpoints"
echo -e "  ${GREEN}✅ 临时文件已清理${NC}"

# ── 4. 日志轮转 ────────────────────────────────────
if [[ -d "$WS_ROOT/.logs/merge-worktree" ]]; then
    ls -1t "$WS_ROOT/.logs/merge-worktree"/*.log 2>/dev/null | tail -n +31 | xargs rm -f 2>/dev/null || true
fi

echo ""
echo "══════════════════════════════════════════════════"
echo -e "${GREEN}${BOLD}✅ 清理完成！${NC}"
echo "  分支: ${BRANCH_NAME:-unknown} (已清理)"
echo "══════════════════════════════════════════════════"
