#!/bin/bash
# merge.sh — 合并发布一体化脚本（阶段 0-6）
#
# 用法:
#   bash merge.sh <worktree-dir> [patch|minor|major] [--notes <file>] [--draft] [--from <N>]
#
# 参数:
#   <worktree-dir>        feature worktree 目录路径
#   patch|minor|major     版本类型，默认 patch
#   --notes <file>        指定 release notes 文件
#   --draft               创建 Draft Release（不自动发布）
#   --from <N>            从阶段 N 继续执行（1-6），跳过之前已完成的阶段
#
# 阶段:
#   0: 初始化（解析参数、检测环境）
#   1: 本地验证（lint + test + build）
#   2: PR CI + 合并
#   3: Post-merge CI 等待
#   4: 发布（bump + tag + push + 等待 Release CI）
#   5: Release（生成 notes + 创建/更新 GitHub Release）
#   6: 交付物验证（门禁，不可跳过）
#
# 阶段 7（清理 worktree）由独立脚本 cleanup.sh 完成，需 AI/用户确认后执行。
#
# 退出码: 0=成功, 1=失败

set -euo pipefail

# ════════════════════════════════════════════════════
# 辅助函数
# ════════════════════════════════════════════════════

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

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
log()       { [[ -n "$LOG_FILE" ]] || return 0; _valid_log_level "$1" && echo "[$(date +%Y-%m-%dT%H:%M:%S)] [$1] $2" >> "$LOG_FILE"; }
log_info()  { log "INFO" "$*"; }
log_warn()  { log "WARN" "$*"; }
log_error() { log "ERROR" "$*"; }
log_phase() { log "PHASE" "$*"; }

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

read_project_version() {
    local dir="${1:-$MAIN_WT}"
    local hook_path="${WS_ROOT}/.bare/custom-hooks/read-version.sh"
    if [[ -f "$hook_path" ]]; then
        bash "$hook_path" "$dir" 2>/dev/null && return
    fi
    node -p "require('$dir/package.json').version" 2>/dev/null || echo ""
}

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

# ── 钩子 ──────────────────────────────────────

run_hook() {
    local hook_name="$1"
    shift
    local hook_script="${WS_ROOT}/.bare/custom-hooks/$hook_name"
    if [[ -x "$hook_script" ]]; then
        echo ""
        echo -e "  ${CYAN}🔧 执行项目钩子: $hook_name${NC}"
        log_phase "执行钩子: $hook_name"
        local hook_tmp="/tmp/hook-${hook_name}.tmp"
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

# ════════════════════════════════════════════════════
# 脚本级变量（phase_init 中赋值，--from 跳过时需有默认值）
# ════════════════════════════════════════════════════
WS_ROOT=""
MAIN_WT=""
BRANCH_NAME=""
PR_NUMBER=""
PR_TITLE=""
PR_STATE=""
GH_REPO="${GH_REPO:-}"
GH_REMOTE="origin"
LOG_FILE="${LOG_FILE:-}"
NEW_VERSION=""
TAG=""
RELEASE_URL=""
COMMIT_FILE=""

# ════════════════════════════════════════════════════
# 参数解析
# ════════════════════════════════════════════════════

WORKTREE_DIR=""
VERSION_TYPE="patch"
NOTES_FILE=""
DRAFT_MODE=false
FROM_PHASE=0

POSITIONAL=()
while [[ $# -gt 0 ]]; do
    case "$1" in
        --notes) NOTES_FILE="$2"; shift 2 ;;
        --draft) DRAFT_MODE=true; shift ;;
        --from)  FROM_PHASE="$2"; shift 2 ;;
        -*)      echo -e "${RED}Error: 未知选项 $1${NC}"; exit 1 ;;
        *)       POSITIONAL+=("$1"); shift ;;
    esac
done
set -- "${POSITIONAL[@]}"

WORKTREE_DIR="${1:?Usage: merge.sh <worktree-dir> [patch|minor|major] [--notes <file>] [--draft] [--from <N>]}"
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

if [[ ! "$FROM_PHASE" =~ ^[0-6]$ ]]; then
    echo -e "${RED}Error: --from 必须是 0-6 的数字${NC}"
    exit 1
fi

# ════════════════════════════════════════════════════
# 阶段 0: 初始化
# ════════════════════════════════════════════════════

phase_init() {
    echo ""
    echo -e "${BOLD}═══ 阶段 0/6: 初始化 ═══${NC}"
    log_phase "阶段 0: 初始化"

    command -v gh >/dev/null 2>&1 || { echo -e "${RED}Error: gh CLI 未安装${NC}"; exit 1; }
    gh auth status >/dev/null 2>&1 || { echo -e "${RED}Error: gh CLI 未登录${NC}"; exit 1; }

    # 安全检查：cwd 不能在 worktree 内
    local caller_dir
    caller_dir=$(pwd -P)
    WORKTREE_DIR=$(cd "$WORKTREE_DIR" && pwd -P)

    if [[ ! -d "$WORKTREE_DIR" ]]; then
        echo -e "${RED}Error: 工作目录不存在: $WORKTREE_DIR${NC}"
        exit 1
    fi

    if [[ "$caller_dir" == "$WORKTREE_DIR" || "$caller_dir/" == "$WORKTREE_DIR/"* ]]; then
        echo -e "${RED}${BOLD}⛔ 安全阻断：当前 shell 的工作目录在待处理的 worktree 内！${NC}"
        echo -e "${RED}    当前目录: $caller_dir${NC}"
        echo -e "${RED}    worktree: $WORKTREE_DIR${NC}"
        echo ""
        echo "    修复: cd <workspace-root> 后重新运行。"
        exit 1
    fi

    # 环境检测
    BRANCH_NAME=$(git -C "$WORKTREE_DIR" branch --show-current)
    WS_ROOT=$(find_workspace_root "$WORKTREE_DIR")
    if [[ -z "$WS_ROOT" ]]; then
        echo -e "${RED}Error: 未找到 workspace root（向上查找 .bare/ 或 .git/）${NC}"
        exit 1
    fi

    MAIN_WT=$(find_main_worktree "$WS_ROOT")
    if [[ -z "$MAIN_WT" ]]; then
        echo -e "${RED}Error: workspace 中没有 main worktree（需要 $WS_ROOT/main 或 $WS_ROOT/master 目录）${NC}"
        exit 1
    fi

    # 自动检测 GitHub repo
    if [[ -z "$GH_REPO" ]]; then
        local _remote_url
        _remote_url=$(git -C "$WORKTREE_DIR" remote get-url github 2>/dev/null \
            || git -C "$WORKTREE_DIR" remote get-url origin 2>/dev/null || true)
        if [[ -n "$_remote_url" ]]; then
            GH_REPO=$(echo "$_remote_url" | sed -E 's#.*github.com[:/]([^/]+/[^/]+)(\.git)?$#\1#')
            GH_REPO="${GH_REPO%.git}"
            export GH_REPO
            echo "  检测到 repo: $GH_REPO"
        fi
    fi

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

    # 日志初始化
    local log_dir="$WS_ROOT/.logs/merge-worktree"
    mkdir -p "$log_dir"
    local branch_safe="${BRANCH_NAME//\//-}"
    LOG_FILE="$log_dir/$(date +%Y-%m-%d)_${branch_safe}.log"
    {
        echo "=========================================="
        echo "Merge Log"
        echo "Started: $(date -Iseconds)"
        echo "=========================================="
        echo "Branch: $BRANCH_NAME"
        echo "Workspace: $WS_ROOT"
        echo "Main worktree: $MAIN_WT"
        echo "GH_REPO: ${GH_REPO:-}"
        echo "Version type: $VERSION_TYPE"
        echo "=========================================="
        echo ""
    } > "$LOG_FILE"

    if ! echo "test" >> "$LOG_FILE" 2>/dev/null; then
        echo -e "${RED}Error: 无法写入日志文件 $LOG_FILE${NC}"
        LOG_FILE=""
    fi

    # 摘要
    echo ""
    echo "══════════════════════════════════════════════════"
    echo -e "${BOLD}初始化完成${NC}"
    echo "  工作目录: $WORKTREE_DIR"
    echo "  分支: $BRANCH_NAME"
    echo "  版本类型: $VERSION_TYPE"
    echo "  PR: #$PR_NUMBER — $PR_TITLE (状态: $PR_STATE)"
    echo "  Release Notes: ${NOTES_FILE:-(自动生成)}"
    if $DRAFT_MODE; then echo "  模式: Draft（需手动发布）"; fi
    echo "══════════════════════════════════════════════════"

    log_info "初始化完成: branch=$BRANCH_NAME, pr=#$PR_NUMBER, version_type=$VERSION_TYPE"
    echo -e "${GREEN}✅ 阶段 0 完成${NC}"
}

# ════════════════════════════════════════════════════
# 阶段 1: 本地验证
# ════════════════════════════════════════════════════

phase_local_check() {
    echo ""
    echo -e "${BOLD}═══ 阶段 1/6: 本地验证 ═══${NC}"
    log_phase "阶段 1: 本地验证"

    run_hook "pre-merge.sh" "$WORKTREE_DIR"

    bash "$SCRIPT_DIR/pre-merge-check.sh" "$WORKTREE_DIR" || {
        echo ""
        echo -e "${RED}${BOLD}⛔ 本地验证失败！修复后重新运行：${NC}"
        echo -e "  bash $SCRIPT_DIR/merge.sh $WORKTREE_DIR $VERSION_TYPE --from 1"
        exit 1
    }

    echo -e "${GREEN}✅ 阶段 1 完成${NC}"
}

# ════════════════════════════════════════════════════
# 阶段 2: PR CI + 合并
# ════════════════════════════════════════════════════

phase_pr_merge() {
    echo ""
    echo -e "${BOLD}═══ 阶段 2/6: PR CI + 合并 ═══${NC}"
    log_phase "阶段 2: PR CI + 合并"

    local gh_flag="${GH_REPO:+--repo $GH_REPO}"

    PR_STATE=$(gh pr view "$PR_NUMBER" $gh_flag --json state --jq '.state' 2>/dev/null || echo "UNKNOWN")
    echo "  PR: #$PR_NUMBER — $PR_TITLE"
    echo "  状态: $PR_STATE"

    if [[ "$PR_STATE" == "MERGED" ]]; then
        echo -e "  ${GREEN}⏭️  PR 已合并，跳过${NC}"
        log_info "PR #$PR_NUMBER 已合并，跳过"
        echo -e "${GREEN}✅ 阶段 2 完成${NC}"
        return 0
    fi

    if [[ "$PR_STATE" != "OPEN" ]]; then
        echo -e "${RED}Error: PR 状态为 $PR_STATE，无法处理${NC}"
        exit 1
    fi

    # 检查 PR CI 状态
    echo "  检查 PR CI 状态..."
    local ci_data
    ci_data=$(gh pr view "$PR_NUMBER" $gh_flag --json statusCheckRollup 2>&1) || {
        echo -e "${YELLOW}Warning: 无法获取 CI 状态，继续合并${NC}"
        ci_data='{"statusCheckRollup":[]}'
    }

    local ci_conclusions
    ci_conclusions=$(echo "$ci_data" | jq -r '[.statusCheckRollup[] | .conclusion] | unique | join(",")' 2>/dev/null || echo "")

    if echo "$ci_conclusions" | grep -qi "failure\|timed_out\|cancelled"; then
        echo -e "  ${RED}❌ PR CI 有失败项:${NC}"
        echo "$ci_data" | jq -r '.statusCheckRollup[] | select(.conclusion == "failure" or .conclusion == "timed_out" or .conclusion == "cancelled") | "    ❌ \(.name) (\(.conclusion))"' 2>/dev/null
        exit 1
    fi

    # 等待 PR CI
    if echo "$ci_conclusions" | grep -qi "pending\|queued\|in_progress"; then
        echo "  ⏳ PR CI 仍在运行，等待最多 10 分钟..."
        local elapsed=0
        while [[ $elapsed -lt 600 ]]; do
            sleep 30
            elapsed=$((elapsed + 30))
            ci_data=$(gh pr view "$PR_NUMBER" $gh_flag --json statusCheckRollup 2>&1)
            ci_conclusions=$(echo "$ci_data" | jq -r '[.statusCheckRollup[] | .conclusion] | unique | join(",")' 2>/dev/null || echo "")
            if ! echo "$ci_conclusions" | grep -qi "pending\|queued\|in_progress"; then
                break
            fi
            echo "  ⏳ 等待中... (${elapsed}s/600s)"
        done
        if echo "$ci_conclusions" | grep -qi "failure\|timed_out\|cancelled"; then
            echo -e "  ${RED}❌ PR CI 失败${NC}"
            exit 1
        fi
    fi

    # 合并
    echo -e "  ${GREEN}✅ PR CI 通过，开始合并${NC}"
    gh pr merge "$PR_NUMBER" $gh_flag --merge --delete-branch 2>&1 || {
        PR_STATE=$(gh pr view "$PR_NUMBER" $gh_flag --json state --jq '.state' 2>/dev/null || echo "UNKNOWN")
        if [[ "$PR_STATE" == "MERGED" ]]; then
            echo -e "  ${GREEN}PR 已合并（可能被其他进程合并）${NC}"
        else
            echo -e "${RED}Error: PR 合并失败${NC}"
            exit 1
        fi
    }

    log_info "PR #$PR_NUMBER 已合并"
    echo -e "${GREEN}✅ 阶段 2 完成${NC}"
}

# ════════════════════════════════════════════════════
# 阶段 3: Post-merge CI 等待
# ════════════════════════════════════════════════════

phase_post_merge_ci() {
    echo ""
    echo -e "${BOLD}═══ 阶段 3/6: Post-merge CI 验证 ═══${NC}"
    log_phase "阶段 3: Post-merge CI"

    git -C "$MAIN_WT" fetch "$GH_REMOTE" main 2>&1 | tail -1
    local main_sha
    main_sha=$(git -C "$MAIN_WT" rev-parse "$GH_REMOTE/main")
    echo "  main SHA: $main_sha"

    local gh_flag="${GH_REPO:+--repo $GH_REPO}"
    bash "$SCRIPT_DIR/wait-for-ci.sh" "$main_sha" $gh_flag || {
        local wait_exit=$?
        if [[ $wait_exit -eq 3 ]]; then
            echo -e "  ${GREEN}项目无 CI workflow，跳过等待${NC}"
            log_info "项目无 CI workflow，跳过 (SHA=$main_sha)"
            echo -e "${GREEN}✅ 阶段 3 完成（无 CI）${NC}"
            return 0
        fi
        if [[ $wait_exit -eq 1 ]]; then
            echo ""
            echo -e "${RED}${BOLD}⛔ Post-merge CI 失败！${NC}"
            echo ""
            echo "修复步骤："
            echo "  1. 在 main worktree 中查看日志并修复: gh run view <run-id> --log-failed"
            echo "  2. git push origin main"
            echo -e "  3. 重新运行: bash $SCRIPT_DIR/merge.sh $WORKTREE_DIR $VERSION_TYPE --from 3"
            exit 1
        fi
        echo -e "${YELLOW}${BOLD}⚠️  CI 等待超时或未触发，需要用户确认${NC}"
        exit 1
    }

    log_info "Post-merge CI 通过 (SHA=$main_sha)"
    echo -e "${GREEN}✅ 阶段 3 完成${NC}"
}

# ════════════════════════════════════════════════════
# 阶段 4: 发布
# ════════════════════════════════════════════════════

phase_publish() {
    echo ""
    echo -e "${BOLD}═══ 阶段 4/6: 发布准备 ═══${NC}"
    log_phase "阶段 4: 发布准备"

    local gh_flag="${GH_REPO:+--repo $GH_REPO}"

    # 检查是否有项目发布脚本
    local publish_sh=""
    for search_dir in "$MAIN_WT" "$WORKTREE_DIR"; do
        if [[ -n "$search_dir" ]] && [[ -f "$search_dir/scripts/publish.sh" ]]; then
            publish_sh="$search_dir/scripts/publish.sh"
            break
        fi
    done

    TAG=""

    if [[ -n "$publish_sh" ]]; then
        # 幂等检查：当前版本 release 已存在则跳过
        local cur_ver
        cur_ver=$(read_project_version "$MAIN_WT")
        if [[ -n "$cur_ver" ]] && gh release view "v$cur_ver" $gh_flag --json tagName >/dev/null 2>&1; then
            echo -e "  ${GREEN}⏭️  Release v$cur_ver 已存在，跳过发布脚本${NC}"
            NEW_VERSION="$cur_ver"
            TAG="v$NEW_VERSION"
        else
            if grep -q 'gh workflow run' "$publish_sh"; then
                echo "  检测到 GitHub Actions 发布脚本"
                ( cd "$(dirname "$publish_sh")/.." && bash "$publish_sh" "$VERSION_TYPE" ) || {
                    echo -e "${RED}Error: 发布脚本失败${NC}"; exit 1
                }
            else
                ( cd "$MAIN_WT" && bash "$publish_sh" "$VERSION_TYPE" ) || {
                    echo -e "${RED}Error: 发布脚本失败${NC}"; exit 1
                }
            fi
            # CI 发布脚本在远程 bump 版本，需 pull 后读取
            if [[ -d "$MAIN_WT" ]]; then
                git -C "$MAIN_WT" fetch "$GH_REMOTE" main 2>&1 | tail -1
                git -C "$MAIN_WT" merge --ff-only "$GH_REMOTE/main" 2>&1 | tail -1 || true
            fi
            NEW_VERSION=$(read_project_version "$MAIN_WT")
            if [[ -z "$NEW_VERSION" ]]; then
                NEW_VERSION=$(gh release list --limit 1 $gh_flag --json tagName -q '.[0].tagName' 2>/dev/null | sed 's/^v//' || echo "")
                echo -e "  ${YELLOW}⚠️  本地版本读取为空，从 release tag 获取: $NEW_VERSION${NC}"
            fi
            TAG="v$NEW_VERSION"
        fi
    else
        # 自行 bump 版本 + tag + push
        local op_dir="$MAIN_WT"

        if [[ -n "$op_dir" ]] && [[ -f "$op_dir/package.json" ]]; then
            local current_version
            current_version=$(read_project_version "$op_dir")

            (
                cd "$op_dir"
                git fetch "$GH_REMOTE" main 2>&1 | tail -1
                git merge --ff-only FETCH_HEAD 2>&1 | tail -1 || { echo "  ${RED}Error: 无法 fast-forward main${NC}"; exit 1; }
            )

            npm version --prefix "$op_dir" "$VERSION_TYPE" --no-git-tag-version 2>&1
            NEW_VERSION=$(node -p "require('$op_dir/package.json').version")
            TAG="v$NEW_VERSION"
            echo "  版本: $current_version → $NEW_VERSION"
            log_info "版本 bump: $current_version → $NEW_VERSION, tag=$TAG"

            sync_sub_package_versions "$op_dir" "$NEW_VERSION"

            run_hook "post-bump.sh" "$op_dir" || {
                echo -e "  ${RED}Error: post-bump 钩子失败${NC}"; exit 1
            }

            (
                cd "$op_dir"
                git add package.json package-lock.json 2>/dev/null || true
                git add -A -- '*.json' 2>/dev/null || true
                git commit -m "chore: bump version to $NEW_VERSION" 2>/dev/null || echo "  无变更需提交"
                git tag "$TAG" 2>/dev/null || echo "  Tag 已存在"
                git push "$GH_REMOTE" HEAD:refs/heads/main --tags 2>&1 | tail -1
            )
            log_info "Tag $TAG 已推送到 $GH_REMOTE"
            echo -e "  ${GREEN}✅ 版本 bump + tag + push 完成${NC}"
        else
            # 非 npm 项目：手动 tag
            NEW_VERSION="${VERSION_TYPE}-$(date +%Y%m%d%H%M%S)"
            TAG="v$NEW_VERSION"
            echo "  非 npm 项目，创建 tag: $TAG"
            if [[ -n "$op_dir" ]]; then
                git -C "$op_dir" tag "$TAG" 2>/dev/null || true
                git -C "$op_dir" push "$GH_REMOTE" --tags 2>&1 | tail -1
            fi
        fi

        # 等待 release CI 构建完成
        if [[ -n "$TAG" ]]; then
            echo ""
            echo "  ⏳ 等待 release CI 构建产物..."
            local tag_sha
            tag_sha=$(git -C "${op_dir}" rev-parse "$TAG" 2>/dev/null || echo "")
            if [[ -n "$tag_sha" ]]; then
                bash "$SCRIPT_DIR/wait-for-ci.sh" "$tag_sha" --timeout 900 --workflow "Release" --verify-release "$TAG" $gh_flag 2>&1 || {
                    local wait_exit=$?
                    if [[ $wait_exit -eq 1 ]]; then
                        echo -e "  ${RED}❌ Release CI 构建失败！查看日志: gh run view --log-failed${NC}"
                        exit 1
                    fi
                    if [[ $wait_exit -eq 3 ]]; then
                        echo -e "  ${GREEN}项目无 Release CI workflow，跳过等待${NC}"
                    else
                        echo -e "  ${YELLOW}⚠️  Release CI 超时或未触发，继续${NC}"
                    fi
                }
            fi
            echo -e "  ${GREEN}✅ Release CI 完成${NC}"
            log_info "Release CI 完成 (tag=$TAG)"
        fi
    fi

    echo "  版本: v${NEW_VERSION}"
    log_info "阶段 4 完成: v${NEW_VERSION}"
    echo -e "${GREEN}✅ 阶段 4 完成${NC}"
}

# ════════════════════════════════════════════════════
# 阶段 5: Release
# ════════════════════════════════════════════════════

phase_release() {
    echo ""
    echo -e "${BOLD}═══ 阶段 5/6: Release ═══${NC}"
    log_phase "阶段 5: Release (tag=$TAG)"

    local gh_flag="${GH_REPO:+--repo $GH_REPO}"
    TAG="v${NEW_VERSION}"
    COMMIT_FILE="$WS_ROOT/.release-commits.txt"

    local repo_url
    repo_url=$(gh repo view $gh_flag --json url --jq '.url' 2>/dev/null || echo "")

    # 生成 commit 清单
    local last_tag
    last_tag=$(git -C "$MAIN_WT" describe --tags --abbrev=0 HEAD^ 2>/dev/null || echo "")
    log_info "上一个 tag: ${last_tag:-none}"

    local log_range
    if [[ -n "$last_tag" ]]; then
        log_range="$last_tag..HEAD"
    else
        log_range="HEAD~30..HEAD"
    fi

    cd "$MAIN_WT"
    git log "$log_range" --pretty=format:"%s" --no-merges > "$COMMIT_FILE" 2>/dev/null || echo "(无 commit)" > "$COMMIT_FILE"

    run_hook "generate-release-notes.sh" || true

    # 确定 release notes 内容
    local final_notes_file
    if [[ -n "$NOTES_FILE" ]]; then
        echo "  使用指定的 release notes: $NOTES_FILE"
        final_notes_file="$NOTES_FILE"
    else
        echo "  从 conventional commits 自动生成 release notes..."
        final_notes_file="$WS_ROOT/.release-notes-auto.md"
        generate_auto_release_notes "$COMMIT_FILE" "$TAG" "$last_tag" "$repo_url" > "$final_notes_file"

        local lines
        lines=$(wc -l < "$final_notes_file" | tr -d ' ')
        if [[ "$lines" -le 2 ]]; then
            echo -e "  ${YELLOW}⚠️  自动生成的 release notes 为空${NC}"
            {
                echo "## What's Changed"
                echo ""
                echo "- $PR_TITLE"
                if [[ -n "$last_tag" ]] && [[ -n "$repo_url" ]]; then
                    echo ""
                    echo "**Full Changelog**: ${repo_url}/compare/${last_tag}...${TAG}"
                fi
            } > "$final_notes_file"
        fi
    fi

    # Release 创建策略
    local release_created_by_ci=false
    local existing_release

    # 检查 CI 是否已创建 Draft Release
    existing_release=$(gh release view "$TAG" $gh_flag --json isDraft,id,body,assets --jq '.' 2>/dev/null || echo "")

    if [[ -n "$existing_release" ]]; then
        local asset_count
        asset_count=$(echo "$existing_release" | jq -r '.assets | length')
        log_info "发现已有 Release (assets=$asset_count)"
        echo -e "  ${GREEN}CI 已创建 Release(assets=$asset_count)${NC}"
        release_created_by_ci=true
    fi

    # 等待 CI 创建 Draft Release（最多 120s）
    if ! $release_created_by_ci; then
        log_info "等待 CI 创建 Draft Release (最多 120s)..."
        echo "  ⏳ 等待 Release CI 创建 Draft Release..."
        local wait_elapsed=0
        while [[ $wait_elapsed -lt 120 ]]; do
            sleep 5
            wait_elapsed=$((wait_elapsed + 5))
            existing_release=$(gh release view "$TAG" $gh_flag --json isDraft,id,body,assets --jq '.' 2>/dev/null || echo "")
            if [[ -n "$existing_release" ]]; then
                local asset_count
                asset_count=$(echo "$existing_release" | jq -r '.assets | length')
                release_created_by_ci=true
                echo -e "  ${GREEN}✅ CI 已创建 Release(assets=$asset_count, 等待 ${wait_elapsed}s）${NC}"
                log_info "CI 创建 Release 成功 (assets=$asset_count, wait=${wait_elapsed}s)"
                break
            fi
            echo "  ⏳ 等待中... (${wait_elapsed}s/120s)"
        done
    fi

    # 更新或创建 Release
    if [[ -n "$existing_release" ]]; then
        local existing_body
        existing_body=$(echo "$existing_release" | jq -r '.body // ""' 2>/dev/null || echo "")
        if [[ -z "$existing_body" ]] || [[ ${#existing_body} -lt 20 ]]; then
            echo "  ⚠️  Release $TAG 已存在但 notes 为空，回填中..."
        else
            echo "  更新已有 Release: $TAG"
        fi
        log_info "更新 Release notes"
        gh release edit "$TAG" $gh_flag --notes-file "$final_notes_file" 2>&1 || true
        RELEASE_URL="${repo_url}/releases/tag/$TAG"

        # 如果 Draft 且非 --draft 模式，发布它
        local is_draft
        is_draft=$(echo "$existing_release" | jq -r '.isDraft')
        if [[ "$is_draft" == "true" ]] && ! $DRAFT_MODE; then
            echo "  发布 Draft Release..."
            log_info "发布 Draft Release (draft=false)"
            gh release edit "$TAG" $gh_flag --draft=false 2>&1 || true
        fi
    else
        if ! $release_created_by_ci; then
            echo -e "  ${YELLOW}⚠️  CI 未在预期时间内创建 Draft Release，手动创建（将无构建产物）${NC}"
            log_warn "CI 未创建 Draft Release，fallback 到手动创建"
        fi

        # 去重检查
        existing_release=$(gh release view "$TAG" $gh_flag --json isDraft,id,body,assets --jq '.' 2>/dev/null || echo "")
        if [[ -n "$existing_release" ]]; then
            echo -e "  ${GREEN}Release 已存在，更新 release notes${NC}"
            gh release edit "$TAG" $gh_flag --notes-file "$final_notes_file" 2>&1 || true
            local is_draft
            is_draft=$(echo "$existing_release" | jq -r '.isDraft')
            if [[ "$is_draft" == "true" ]] && ! $DRAFT_MODE; then
                gh release edit "$TAG" $gh_flag --draft=false 2>&1 || true
            fi
            RELEASE_URL="${repo_url}/releases/tag/$TAG"
        else
            echo "  创建 Release: $TAG"
            log_info "手动创建 Release: $TAG"
            local local_draft_flag=""
            $DRAFT_MODE && local_draft_flag="--draft"
            RELEASE_URL=$(gh release create "$TAG" $gh_flag \
                --title "v$NEW_VERSION" \
                --notes-file "$final_notes_file" \
                ${local_draft_flag} \
                --target main 2>&1 | tail -1) || {
                echo -e "  ${RED}❌ Release 创建失败${NC}"
                log_error "Release 创建失败"
                exit 1
            }
            if $DRAFT_MODE; then
                echo -e "  ${GREEN}✅ Draft Release 已创建${NC}"
            else
                echo -e "  ${GREEN}✅ Release 已发布${NC}"
            fi
        fi
    fi

    echo "  URL: $RELEASE_URL"
    log_info "Release URL: $RELEASE_URL"

    run_hook "post-release.sh" "$RELEASE_URL" || true

    echo -e "${GREEN}✅ 阶段 5 完成${NC}"
}

# ════════════════════════════════════════════════════
# 阶段 6: 交付物验证（门禁）
# ════════════════════════════════════════════════════

phase_verify() {
    echo ""
    echo -e "${BOLD}═══ 阶段 6/6: 确认交付物 ═══${NC}"
    log_phase "阶段 6: 确认交付物 (tag=$TAG)"
    echo ""
    echo -e "${BOLD}⚠️  本阶段为交付物门禁，不可跳过。${NC}"
    echo ""

    local gh_flag="${GH_REPO:+--repo $GH_REPO}"
    TAG="v${NEW_VERSION}"

    local verify_pass=true
    local issues=""

    # 检查 1: Release 存在
    echo "  检查 1: Release 是否存在..."
    local release_json
    release_json=$(gh release view "$TAG" $gh_flag --json tagName,isDraft,assets,publishedAt,url --jq '.' 2>/dev/null || echo "")

    if [[ -z "$release_json" ]]; then
        echo -e "    ${RED}❌ FAIL: Release $TAG 不存在${NC}"
        log_error "交付物确认失败: Release $TAG 不存在"
        verify_pass=false
        issues="${issues}\n    - Release $TAG 不存在"
    else
        echo -e "    ${GREEN}✅ PASS: Release $TAG 存在${NC}"
    fi

    # 检查 2: 构建产物
    if [[ -n "$release_json" ]]; then
        local asset_count
        asset_count=$(echo "$release_json" | jq -r '.assets | length')
        local is_draft
        is_draft=$(echo "$release_json" | jq -r '.isDraft')
        RELEASE_URL=$(echo "$release_json" | jq -r '.url')

        echo ""
        echo "  检查 2: 构建产物..."
        echo "    产物数量: $asset_count"

        if [[ "$asset_count" -eq 0 ]]; then
            # 检测是否为纯 npm 发布项目
            local release_yml=""
            if [[ -f "$MAIN_WT/.github/workflows/release.yml" ]]; then
                release_yml=$(cat "$MAIN_WT/.github/workflows/release.yml" 2>/dev/null || true)
            fi

            local npm_publish_only=false
            if echo "$release_yml" | grep -q "changeset publish" && ! echo "$release_yml" | grep -q "upload-artifact\|actions/upload"; then
                npm_publish_only=true
            fi

            if $npm_publish_only; then
                echo -e "    ${YELLOW}ℹ️  纯 npm 发布项目，验证 npm registry...${NC}"

                local npm_ok=true
                local npm_fail_list=""
                while IFS= read -r pkg_json; do
                    local pkg_name pkg_version pkg_private npm_version
                    pkg_name=$(node -e "const p=require('$pkg_json'); process.stdout.write(p.name || '')" 2>/dev/null || true)
                    pkg_version=$(node -e "const p=require('$pkg_json'); process.stdout.write(p.version || '')" 2>/dev/null || true)
                    pkg_private=$(node -e "const p=require('$pkg_json'); process.stdout.write(String(p.private || false))" 2>/dev/null || true)
                    if [[ "$pkg_private" == "true" || -z "$pkg_name" ]]; then
                        continue
                    fi
                    npm_version=$(npm view "$pkg_name" version 2>/dev/null || echo "")
                    if [[ "$npm_version" == "$pkg_version" ]]; then
                        echo -e "      ${GREEN}✓${NC} $pkg_name@$npm_version"
                    elif [[ -n "$npm_version" ]]; then
                        echo -e "      ${YELLOW}~${NC} $pkg_name@$npm_version (local: $pkg_version)"
                    else
                        echo -e "      ${RED}✗${NC} $pkg_name@$pkg_version — npm 上未找到"
                        npm_ok=false
                        npm_fail_list="${npm_fail_list}\n        - $pkg_name@$pkg_version 未发布到 npm"
                    fi
                done < <(cd "$MAIN_WT" && find extensions shared packages -maxdepth 2 -name package.json -not -path '*/node_modules/*' 2>/dev/null)

                if $npm_ok; then
                    echo -e "    ${GREEN}✅ PASS: npm 包已全部发布${NC}"
                else
                    echo -e "    ${RED}❌ FAIL: 部分 npm 包未发布${NC}"
                    verify_pass=false
                    issues="${issues}\n    - 部分 npm 包未发布到 registry${npm_fail_list}"
                fi
            else
                echo -e "    ${RED}❌ FAIL: Release 无构建产物（只有 source code）${NC}"
                verify_pass=false
                issues="${issues}\n    - Release 无构建产物"
            fi
        else
            echo -e "    ${GREEN}✅ PASS: 有 $asset_count 个构建产物${NC}"
            echo "    产物列表:"
            echo "$release_json" | jq -r '.assets[] | "      - \(.name) (\(.size / 1024 / 1024 * 100 | round / 100) MB)"' 2>/dev/null
        fi

        # 检查 3: Draft 状态
        echo ""
        echo "  检查 3: 发布状态..."
        if $DRAFT_MODE; then
            if [[ "$is_draft" == "true" ]]; then
                echo -e "    ${GREEN}✅ PASS: Draft 状态（符合预期）${NC}"
            else
                echo -e "    ${YELLOW}⚠️  WARN: 期望 Draft 但已发布${NC}"
            fi
        else
            if [[ "$is_draft" == "true" ]]; then
                echo -e "    ${YELLOW}⚠️  WARN: Release 仍为 Draft，未正式发布${NC}"
            else
                echo -e "    ${GREEN}✅ PASS: 已正式发布${NC}"
            fi
        fi
    fi

    # 汇总
    echo ""
    echo "══════════════════════════════════════════════════"
    if $verify_pass; then
        echo -e "${GREEN}${BOLD}✅ 交付物确认通过${NC}"
        echo ""
        echo "  版本: $TAG"
        echo "  URL: ${RELEASE_URL:-}"
        echo "  产物: ${asset_count:-0} 个"
        echo ""
        echo -e "  ${GREEN}可以安全执行清理。${NC}"
        log_info "交付物确认通过: tag=$TAG, assets=${asset_count:-0}"
    else
        echo -e "${RED}${BOLD}⛔ 交付物确认失败！${NC}"
        echo ""
        echo -e "  问题:${issues}"
        echo ""
        echo "  修复建议:"
        echo "    - Release 不存在: 检查 tag 是否推送成功，手动触发 gh workflow run release.yml"
        echo "    - 无构建产物: 等待 CI 完成或手动触发 release workflow"
        log_error "交付物确认失败"
    fi
    echo "══════════════════════════════════════════════════"

    $verify_pass || exit 1
    echo -e "${GREEN}✅ 阶段 6 完成${NC}"
}

# ════════════════════════════════════════════════════
# 主流程
# ════════════════════════════════════════════════════

# 阶段 0 始终执行
if [[ $FROM_PHASE -le 0 ]]; then
    phase_init
fi

# 阶段 1-6 按 --from 跳过
if [[ $FROM_PHASE -le 1 ]]; then
    phase_local_check
fi

if [[ $FROM_PHASE -le 2 ]]; then
    phase_pr_merge
fi

if [[ $FROM_PHASE -le 3 ]]; then
    phase_post_merge_ci
fi

if [[ $FROM_PHASE -le 4 ]]; then
    phase_publish
fi

if [[ $FROM_PHASE -le 5 ]]; then
    phase_release
fi

if [[ $FROM_PHASE -le 6 ]]; then
    phase_verify
fi

# ── 最终报告 ────────────────────────────────────
{
    echo ""
    echo "==========================================="
    echo "流程完成 (阶段 0-6)"
    echo "  PR: #$PR_NUMBER"
    echo "  版本: v$NEW_VERSION"
    echo "  Release: ${RELEASE_URL:-}"
    echo "  日志文件: $LOG_FILE"
    echo "==========================================="
} >> "$LOG_FILE" 2>/dev/null || true

echo ""
echo "══════════════════════════════════════════════════"
echo -e "${GREEN}${BOLD}✅ 阶段 0-6 全部完成！${NC}"
echo "  PR: #$PR_NUMBER"
echo "  版本: v$NEW_VERSION"
echo "  Release: ${RELEASE_URL:-}"
echo ""
echo "  下一步: 确认后执行清理 worktree："
echo "    bash $SCRIPT_DIR/cleanup.sh $WORKTREE_DIR"
if $DRAFT_MODE; then
    echo ""
    echo "  Draft Release 需要手动发布:"
    echo "    gh release edit $TAG ${GH_REPO:+--repo $GH_REPO} --draft=false"
fi
echo "══════════════════════════════════════════════════"
