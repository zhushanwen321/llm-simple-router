#!/bin/bash
# stages/0-init.sh — 初始化：解析参数、检测环境、创建状态文件
#
# 用法: stages/0-init.sh <worktree-dir> [patch|minor|major] [--notes <file>] [--draft]
#
# 退出码: 0=成功, 1=失败

set -euo pipefail

STAGES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
source "$STAGES_DIR/../lib/common.sh"

# ── 参数解析 ──────────────────────────────────────
WORKTREE_DIR=""
VERSION_TYPE="patch"
NOTES_FILE=""
DRAFT_MODE=false

POSITIONAL=()
while [[ $# -gt 0 ]]; do
    case "$1" in
        --notes) NOTES_FILE="$2"; shift 2 ;;
        --draft) DRAFT_MODE=true; shift ;;
        -*)      echo -e "${RED}Error: 未知选项 $1${NC}"; exit 1 ;;
        *)       POSITIONAL+=("$1"); shift ;;
    esac
done
set -- "${POSITIONAL[@]}"

WORKTREE_DIR="${1:?Usage: 0-init.sh <worktree-dir> [patch|minor|major] [--notes <file>] [--draft]}"
shift || true
VERSION_TYPE="${1:-patch}"

if [[ ! "$VERSION_TYPE" =~ ^(patch|minor|major)$ ]]; then
    echo -e "${RED}Error: 版本类型必须是 patch|minor|major${NC}"
    exit 1
fi

if [[ -n "$NOTES_FILE" ]] && [[ ! -f "$NOTES_FILE" ]]; then
    echo -e "${RED}Error: Release notes 文件不存在: $NOTES_FILE${NC}"
    exit 1
fi

command -v gh >/dev/null 2>&1 || { echo -e "${RED}Error: gh CLI 未安装${NC}"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo -e "${RED}Error: gh CLI 未登录${NC}"; exit 1; }

# ── 安全检查：cwd 不能在 worktree 内 ────────────
CALLER_DIR=$(pwd -P)
WORKTREE_DIR=$(cd "$WORKTREE_DIR" && pwd -P)

if [[ ! -d "$WORKTREE_DIR" ]]; then
    echo -e "${RED}Error: 工作目录不存在: $WORKTREE_DIR${NC}"
    exit 1
fi

if [[ "$CALLER_DIR" == "$WORKTREE_DIR" || "$CALLER_DIR/" == "$WORKTREE_DIR/"* ]]; then
    echo -e "${RED}${BOLD}⛔ 安全阻断：当前 shell 的工作目录在待处理的 worktree 内！${NC}"
    echo -e "${RED}    当前目录: $CALLER_DIR${NC}"
    echo -e "${RED}    worktree: $WORKTREE_DIR${NC}"
    echo ""
    echo "    脚本最后会删除此 worktree，如果 cwd 在里面，删除后 shell 会卡死。"
    echo "    修复: cd <workspace-root> 后重新运行。"
    exit 1
fi

# ── 环境检测 ──────────────────────────────────────
BRANCH_NAME=$(git -C "$WORKTREE_DIR" branch --show-current)
WS_ROOT=$(find_workspace_root "$WORKTREE_DIR")

if [[ -z "$WS_ROOT" ]]; then
    echo -e "${RED}Error: 未找到 workspace root（向上查找 .bare/ 或 .git/）${NC}"
    exit 1
fi

MAIN_WT=$(find_main_worktree "$WS_ROOT")
if [[ -z "$MAIN_WT" ]]; then
    echo -e "${RED}Error: workspace 中没有 main worktree（需要 $WS_ROOT/main 或 $WS_ROOT/master 目录）${NC}"
    echo "  bare repo workspace 模式要求必须有 main worktree 用于 bump/tag/push。"
    echo "  创建: cd $WS_ROOT && git-cwt main"
    exit 1
fi

# 自动检测 GitHub repo
GH_REPO="${GH_REPO:-}"
if [[ -z "$GH_REPO" ]]; then
    _remote_url=$(git -C "$WORKTREE_DIR" remote get-url github 2>/dev/null \
        || git -C "$WORKTREE_DIR" remote get-url origin 2>/dev/null || true)
    if [[ -n "$_remote_url" ]]; then
        GH_REPO=$(echo "$_remote_url" | sed -E 's#.*github.com[:/]([^/]+/[^/]+)(\.git)?$#\1#')
        GH_REPO="${GH_REPO%.git}"
        export GH_REPO
        echo "  检测到 repo: $GH_REPO"
    fi
fi

# bare-repo workspace 下 origin 指向本地 bare repo，GitHub 通常是另一个 remote
GH_REMOTE="origin"
if [[ -n "$GH_REPO" ]] && git -C "$WORKTREE_DIR" remote get-url github &>/dev/null; then
    GH_REMOTE="github"
fi

# 查找 PR
PR_NUMBER=$(find_pr_for_branch "$BRANCH_NAME")
if [[ -z "$PR_NUMBER" ]]; then
    echo -e "${RED}Error: 找不到分支 '$BRANCH_NAME' 对应的 PR${NC}"
    exit 1
fi

PR_STATE=$(gh pr view "$PR_NUMBER" ${GH_REPO:+--repo $GH_REPO} --json state --jq '.state' 2>/dev/null || echo "UNKNOWN")
PR_TITLE=$(gh pr view "$PR_NUMBER" ${GH_REPO:+--repo $GH_REPO} --json title --jq '.title' 2>/dev/null || echo "")

# ── 日志初始化 ───────────────────────────────────
LOG_DIR="$WS_ROOT/.logs/merge-worktree"
mkdir -p "$LOG_DIR"
BRANCH_SAFE="${BRANCH_NAME//\//-}"
LOG_FILE="$LOG_DIR/$(date +%Y-%m-%d)_${BRANCH_SAFE}.log"
{
    echo "=========================================="
    echo "Merge Worktree Log"
    echo "Started: $(date -Iseconds)"
    echo "=========================================="
    echo "Branch: $BRANCH_NAME"
    echo "Workspace: $WS_ROOT"
    echo "Main worktree: $MAIN_WT"
    echo "GH_REPO: ${GH_REPO:-}"
    echo "Version type: $VERSION_TYPE"
    echo "Notes file: ${NOTES_FILE:-(auto)}"
    echo "Draft mode: $DRAFT_MODE"
    echo "=========================================="
    echo ""
} > "$LOG_FILE"
export MERGE_LOG_FILE="$LOG_FILE"

if ! echo "test" >> "$LOG_FILE" 2>/dev/null; then
    echo -e "${RED}Error: 无法写入日志文件 $LOG_FILE${NC}"
    LOG_FILE=""
fi

# ── 断点目录 ────────────────────────────────────
CHECKPOINT_DIR="$WS_ROOT/.merge-checkpoints/${BRANCH_SAFE}"
mkdir -p "$CHECKPOINT_DIR" 2>/dev/null || true

# ── 写入状态文件 ────────────────────────────────
STATE_FILE="$WS_ROOT/.merge-worktree-state.env"
save_state

log_info "初始化完成: branch=$BRANCH_NAME, pr=#$PR_NUMBER, version_type=$VERSION_TYPE"

# ── 输出摘要 ────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════════"
echo -e "${BOLD}初始化完成${NC}"
echo "  工作目录: $WORKTREE_DIR"
echo "  分支: $BRANCH_NAME"
echo "  版本类型: $VERSION_TYPE"
echo "  PR: #$PR_NUMBER — $PR_TITLE (状态: $PR_STATE)"
echo "  Release Notes: ${NOTES_FILE:-(自动生成)}"
if $DRAFT_MODE; then echo "  模式: Draft（需手动发布）"; fi
echo "  状态文件: $STATE_FILE"
echo "══════════════════════════════════════════════════"
echo ""
echo -e "${GREEN}✅ 阶段 0 完成。下一步: stages/1-local-check.sh${NC}"
