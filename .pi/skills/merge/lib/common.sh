#!/bin/bash
# lib/common.sh — merge-worktree 共享函数与状态管理
# 由各阶段脚本 source，不直接执行。

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd -P)"

# ── 颜色 ──────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
CYAN='\033[0;36m'
NC='\033[0m'

# ── 日志 ──────────────────────────────────────
LOG_FILE="${LOG_FILE:-}"

_valid_log_level() { case "$1" in INFO|WARN|ERROR|PHASE|CMD|HOOK|CHECK|CI) return 0 ;; *) return 1 ;; esac; }
log()       { [[ -n "$LOG_FILE" ]] && _valid_log_level "$1" && echo "[$(date +%Y-%m-%dT%H:%M:%S)] [$1] $2" >> "$LOG_FILE"; }
log_info()  { log "INFO" "$*"; }
log_warn()  { log "WARN" "$*"; }
log_error() { log "ERROR" "$*"; }
log_phase() { log "PHASE" "$*"; }
log_cmd()   { log "CMD" "$*"; }

# ── 状态管理 ──────────────────────────────────────
# 状态文件：key="value" 格式，可被 bash source
# 位于 $WS_ROOT/.merge-worktree-state.env

STATE_FILE=""

# 所有阶段共享的状态变量名
STATE_VARS=(
    WS_ROOT BRANCH_NAME WORKTREE_DIR MAIN_WT CALLER_DIR
    GH_REPO GH_REMOTE PR_NUMBER PR_TITLE
    VERSION_TYPE NOTES_FILE DRAFT_MODE
    NEW_VERSION TAG RELEASE_URL
    LOG_FILE CHECKPOINT_DIR
)

save_state() {
    [[ -z "$STATE_FILE" ]] && return 1
    {
        echo "# merge-worktree state - $(date -Iseconds)"
        for var in "${STATE_VARS[@]}"; do
            printf '%s="%s"\n' "$var" "${!var:-}"
        done
    } > "$STATE_FILE"
}

load_state() {
    local sf="${1:-$STATE_FILE}"
    if [[ -z "$sf" ]]; then
        sf=$(find_state_file)
    fi
    if [[ ! -f "$sf" ]]; then
        echo -e "${RED}Error: 状态文件不存在。先运行 stages/0-init.sh${NC}" >&2
        exit 1
    fi
    STATE_FILE="$sf"
    set -a
    source "$sf"
    set +a
    export MERGE_LOG_FILE="${LOG_FILE:-}"
}

# 从当前目录向上查找状态文件
find_state_file() {
    local dir="$(pwd -P)"
    while [[ "$dir" != "/" ]]; do
        if [[ -f "$dir/.merge-worktree-state.env" ]]; then
            echo "$dir/.merge-worktree-state.env"
            return
        fi
        dir="$(dirname "$dir")"
    done
    echo ""
}

# 从 --state 参数或自动检测获取状态文件路径
resolve_state_file() {
    local explicit="${1:-}"
    if [[ -n "$explicit" ]]; then
        echo "$explicit"
        return
    fi
    local found
    found=$(find_state_file)
    if [[ -z "$found" ]]; then
        echo -e "${RED}Error: 未找到 .merge-worktree-state.env${NC}" >&2
        echo "  cd <workspace-root> 或传 --state <file>" >&2
        exit 1
    fi
    echo "$found"
}

# ── Workspace 检测 ──────────────────────────────

find_workspace_root() {
    local dir
    dir=$(cd "${1:-$(pwd)}" && pwd -P)
    while [[ "$dir" != "/" ]]; do
        if [[ -d "$dir/.bare" ]] || [[ -d "$dir/.git" ]]; then
            echo "$dir"
            return
        fi
        dir="$(dirname "$dir")"
    done
    echo ""
}

find_main_worktree() {
    local ws_root="$1"
    for wt_name in main master; do
        if [[ -d "$ws_root/$wt_name" ]]; then
            echo "$ws_root/$wt_name"
            return
        fi
    done
    echo ""
}

find_pr_for_branch() {
    local branch="$1"
    [[ -z "$branch" ]] && return
    local repo_flag="${GH_REPO:+--repo $GH_REPO}"
    local pr_num
    pr_num=$(gh pr list $repo_flag --state all --head "$branch" --json number --jq '.[0].number' 2>/dev/null) || true
    echo "${pr_num:-}"
}

# ── 版本管理 ──────────────────────────────────────

sync_sub_package_versions() {
    local base_dir="$1"
    local version="$2"
    local sub_projects=("src-electron")
    for sub in "${sub_projects[@]}"; do
        local sub_pkg="$base_dir/$sub/package.json"
        if [[ -f "$sub_pkg" ]]; then
            local sub_ver
            sub_ver=$(node -p "require('$sub_pkg').version")
            if [[ "$sub_ver" != "$version" ]]; then
                npm version --prefix "$base_dir/$sub" "$version" --no-git-tag-version 2>&1
                echo "  同步 $sub/package.json: $sub_ver → $version"
            fi
        fi
    done
}

read_project_version() {
    local dir="${1:-$MAIN_WT}"
    local hook_path="${WS_ROOT}/.bare/custom-hooks/read-version.sh"
    if [[ -f "$hook_path" ]]; then
        bash "$hook_path" "$dir" 2>/dev/null && return
    fi
    node -p "require('$dir/package.json').version" 2>/dev/null || echo ""
}

# ── 钩子 ──────────────────────────────────────

run_hook() {
    local hook_name="$1"
    shift
    local hook_script="${WS_ROOT}/.bare/custom-hooks/$hook_name"
    if [[ -x "$hook_script" ]]; then
        echo ""
        echo -e "  ${CYAN}🔧 执行项目钩子: $hook_name${NC}"
        log_phase "执行钩子: $hook_name"
        local hook_tmp="${CHECKPOINT_DIR:-/tmp}/hook-${hook_name}.tmp"
        local hook_exit=0
        WS_ROOT="${WS_ROOT}" BRANCH_NAME="${BRANCH_NAME:-}" \
        PR_NUMBER="${PR_NUMBER:-}" VERSION="${NEW_VERSION:-}" \
        COMMIT_FILE="${COMMIT_FILE:-}" \
        "$hook_script" "$@" > "$hook_tmp" 2>&1 || hook_exit=$?
        cat "$hook_tmp" 2>/dev/null || true
        if [[ $hook_exit -ne 0 ]]; then
            [[ -n "$LOG_FILE" ]] && { echo "--- Hook: $hook_name (FAILED exit=$hook_exit) ---" >> "$LOG_FILE"; cat "$hook_tmp" >> "$LOG_FILE" 2>/dev/null; echo "---" >> "$LOG_FILE"; }
            rm -f "$hook_tmp"
            echo -e "  ${RED}❌ 钩子 $hook_name 失败（退出码 $hook_exit）${NC}"
            log_error "钩子 $hook_name 失败（退出码 $hook_exit）"
            return 1
        fi
        [[ -n "$LOG_FILE" ]] && { echo "--- Hook: $hook_name (OK) ---" >> "$LOG_FILE"; cat "$hook_tmp" >> "$LOG_FILE" 2>/dev/null; echo "---" >> "$LOG_FILE"; }
        rm -f "$hook_tmp"
        echo -e "  ${GREEN}✅ 钩子 $hook_name 完成${NC}"
        log_info "钩子 $hook_name 完成"
    fi
}

# ── 断点 ──────────────────────────────────────

checkpoint() { mkdir -p "${CHECKPOINT_DIR}" && touch "${CHECKPOINT_DIR}/$1"; }
is_checkpoint() { [[ -f "${CHECKPOINT_DIR}/$1" ]]; }
clear_checkpoints() { rm -rf "${CHECKPOINT_DIR}"; }

# ── Release Notes 自动生成 ──────────────────────────

generate_auto_release_notes() {
    local commit_file="$1"
    local tag="$2"
    local old_tag="$3"
    local repo_url="$4"

    local features="" fixes="" perfs="" breaking=""

    while IFS= read -r line; do
        local msg="${line#*: }"
        case "$line" in
            feat:*|feat\(*:*)
                [[ -n "$features" ]] && features+=$'\n'
                features+="  - ${msg}"
                ;;
            fix:*|fix\(*:*)
                [[ -n "$fixes" ]] && fixes+=$'\n'
                fixes+="  - ${msg}"
                ;;
            perf:*|perf\(*:*)
                [[ -n "$perfs" ]] && perfs+=$'\n'
                perfs+="  - ${msg}"
                ;;
            breaking:*|breaking\(*:*)
                [[ -n "$breaking" ]] && breaking+=$'\n'
                breaking+="  - ${msg}"
                ;;
        esac
    done < "$commit_file"

    {
        echo "## What's Changed"
        echo ""
        if [[ -n "$breaking" ]]; then echo "### Breaking Changes"; echo "$breaking"; echo ""; fi
        if [[ -n "$features" ]]; then echo "### Features"; echo "$features"; echo ""; fi
        if [[ -n "$fixes" ]]; then echo "### Bug Fixes"; echo "$fixes"; echo ""; fi
        if [[ -n "$perfs" ]]; then echo "### Performance"; echo "$perfs"; echo ""; fi
        if [[ -n "$old_tag" ]] && [[ -n "$repo_url" ]]; then
            echo "**Full Changelog**: ${repo_url}/compare/${old_tag}...${tag}"
        fi
    }
}
