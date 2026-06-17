#!/bin/bash
# wait-for-ci.sh — 等待 GitHub Actions CI 完成
#
# 用法: wait-for-ci.sh <commit-sha> [--timeout 1800] [--workflow <name>] [--verify-release <tag> [--repo <owner/repo>]]
#
# 场景 1: gh pr merge 后，push 到 main 触发 ci.yml
# 场景 2: 推送修复后等待 CI 重新运行
# 场景 3: CI 通过后验证 Draft Release 产物（--verify-release v1.2.3）
#
# Exit codes:
#   0 = CI 全部通过
#   1 = CI 失败（必须修复后重跑）
#   2 = CI 超时（需要用户确认是否继续）
#   3 = 项目无 CI（安全跳过，无需等待）
#
# AI 行为约束：
#   - 此脚本不可跳过
#   - CI 失败时必须在 main 上修复后重新运行
#   - 不能因为"CI 不是你触发的"就跳过

set -euo pipefail

# ── 日志支持（由 merge-and-publish.sh 通过 MERGE_LOG_FILE 环境变量注入）──
_ci_log() {
    [[ -n "${MERGE_LOG_FILE:-}" ]] && echo "[$(date +%Y-%m-%dT%H:%M:%S)] [CI] $*" >> "$MERGE_LOG_FILE" || true
}

REF="${1:?Usage: wait-for-ci.sh <commit-sha> [--timeout 1800] [--workflow <name>] [--verify-release <tag>]}"
shift || true

TIMEOUT=1800          # 默认 30 分钟（Docker build 可能较久）
WORKFLOW=""           # 可选过滤特定 workflow
VERIFY_RELEASE_TAG="" # 可选：CI 通过后验证 Draft Release 产物
GH_REPO=""            # 可选：gh --repo 参数

while [[ $# -gt 0 ]]; do
    case "$1" in
        --timeout)         TIMEOUT="$2"; shift 2 ;;
        --workflow)        WORKFLOW="$2"; shift 2 ;;
        --verify-release)  VERIFY_RELEASE_TAG="$2"; shift 2 ;;
        --repo)            GH_REPO="$2"; shift 2 ;;
        *)                 echo "Unknown option: $1"; exit 1 ;;
    esac
done

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

GH_FLAG=""
if [[ -n "$GH_REPO" ]]; then
    GH_FLAG="--repo $GH_REPO"
fi

command -v gh >/dev/null 2>&1 || { echo "Error: gh CLI 未安装"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "Error: gh CLI 未登录"; exit 1; }

echo -e "${BOLD}等待 CI 完成...${NC}"
_ci_log "等待 CI: commit=$REF, workflow=${WORKFLOW:-all}, timeout=${TIMEOUT}s"
echo "  Commit: $REF"
if [[ -n "$WORKFLOW" ]]; then
    echo "  Workflow: $WORKFLOW"
fi
echo "  超时: ${TIMEOUT}s"
echo ""

# ── 前置检查：项目是否有 CI workflow？──────────────────────────
# 检测 GitHub 上是否有 active 的 workflow，避免对无 CI 项目空等
HAS_CI=true
WORKFLOW_COUNT=0
if [[ -n "$WORKFLOW" ]]; then
    # 指定了具体 workflow，直接检查它是否存在
    WF_CHECK=$(gh run list --workflow "$WORKFLOW" $GH_FLAG --limit 1 --json databaseId 2>/dev/null || echo "[]")
    if [[ "$WF_CHECK" == "[]" ]] || [[ "$WF_CHECK" == "" ]]; then
        echo -e "  ${YELLOW}⚠️  未找到 workflow \"$WORKFLOW\"，检查是否拼写错误或已被删除${NC}"
        _ci_log "前置检查: workflow \"$WORKFLOW\" 未找到"
        HAS_CI=false
    fi
fi

if $HAS_CI; then
    # 获取所有 active workflow 列表
    WF_LIST=$(gh workflow list $GH_FLAG --all --json name,state 2>/dev/null || echo "[]")
    if [[ "$WF_LIST" != "[]" ]] && [[ "$WF_LIST" != "" ]]; then
        WORKFLOW_COUNT=$(echo "$WF_LIST" | jq '[.[] | select(.state == "active")] | length')
        ACTIVE_WFS=$(echo "$WF_LIST" | jq -r '[.[] | select(.state == "active") | .name] | join(", ")')
        echo "  检测到 $WORKFLOW_COUNT 个 active workflow: $ACTIVE_WFS"
        _ci_log "前置检查: $WORKFLOW_COUNT 个 active workflow"
    else
        echo -e "  ${YELLOW}⚠️  未检测到任何 workflow${NC}"
        _ci_log "前置检查: 无 workflow"
        HAS_CI=false
    fi
fi

if ! $HAS_CI || [[ "$WORKFLOW_COUNT" -eq 0 ]]; then
    echo -e "  ${GREEN}✅ 项目无 CI workflow，跳过等待${NC}"
    _ci_log "跳过: 项目无 CI workflow"
    exit 3
fi

echo ""

ELAPSED=0
POLL_INTERVAL=30
TRIGGER_WAIT=120   # CI 触发检测窗口：120s（4 次 × 30s）
FIRST_POLL=true

while true; do
    # 获取该 commit 上的 workflow runs
    if [[ -n "$WORKFLOW" ]]; then
        RUNS_JSON=$(gh run list --commit "$REF" --workflow "$WORKFLOW" $GH_FLAG --json databaseId,status,conclusion,name,workflowName 2>/dev/null || echo "[]")
    else
        RUNS_JSON=$(gh run list --commit "$REF" $GH_FLAG --json databaseId,status,conclusion,name,workflowName 2>/dev/null || echo "[]")
    fi

    # 等待 CI 触发（窗口 120s，而非旧的 30s）
    if [[ "$RUNS_JSON" == "[]" ]] || [[ "$RUNS_JSON" == "" ]]; then
        if [[ $ELAPSED -lt $TRIGGER_WAIT ]]; then
            echo "  ⏳ CI 尚未触发，等待中... (${ELAPSED}s/${TIMEOUT}s, 触发窗口 ${TRIGGER_WAIT}s)"
            sleep "$POLL_INTERVAL"
            ELAPSED=$((ELAPSED + POLL_INTERVAL))
            continue
        else
            echo ""
            echo -e "  ${RED}${BOLD}⛔ ${TRIGGER_WAIT}s 后仍未检测到 CI runs${NC}"
            echo -e "  ${RED}项目有 $WORKFLOW_COUNT 个 active workflow，但该 commit 未触发任何 run。${NC}"
            echo ""
            echo "  可能原因："
            echo "    1. workflow 的触发条件不包含 push to main（如只配置了 pull_request）"
            echo "    2. workflow 的 paths 过滤排除了本次变更的文件"
            echo "    3. GitHub 队列严重延迟（罕见）"
            echo ""
            echo "  排查命令："
            echo "    gh run list --commit $REF"
            echo "    gh workflow list --all"
            echo ""
            echo -e "  ${YELLOW}请确认 CI 是否需要运行后，决定继续或修复${NC}"
            _ci_log "CI 未触发: ${TRIGGER_WAIT}s 后仍无 runs"
            exit 2  # 与超时共用 exit 2，上游应询问用户
        fi
    fi

    # 首次检测到 runs 时显示
    if $FIRST_POLL; then
        TOTAL=$(echo "$RUNS_JSON" | jq 'length')
        echo "  📋 检测到 $TOTAL 个 workflow run(s)"
        FIRST_POLL=false
    fi

    # 统计运行状态
    TOTAL=$(echo "$RUNS_JSON" | jq 'length')
    COMPLETED=$(echo "$RUNS_JSON" | jq '[.[] | select(.status == "completed")] | length')
    PENDING=$((TOTAL - COMPLETED))
    FAILURES=$(echo "$RUNS_JSON" | jq -r '[.[] | select(.status == "completed" and .conclusion != "success" and .conclusion != "skipped")] | length')
    SUCCESSES=$(echo "$RUNS_JSON" | jq -r '[.[] | select(.status == "completed" and (.conclusion == "success" or .conclusion == "skipped"))] | length')

    echo "  📊 Runs: $TOTAL total, $SUCCESSES passed, $FAILURES failed, $PENDING pending (${ELAPSED}s/${TIMEOUT}s)"

    # 全部完成
    if [[ $PENDING -eq 0 ]]; then
        if [[ $FAILURES -gt 0 ]]; then
            echo ""
            echo -e "${RED}${BOLD}⛔ CI 有失败的检查项！${NC}"
            _ci_log "CI 失败: $FAILURES failed, $SUCCESSES passed"
            echo ""
            echo "失败的 workflow runs:"
            echo "$RUNS_JSON" | jq -r '.[] | select(.status == "completed" and .conclusion != "success" and .conclusion != "skipped") | "  ❌ \(.workflowName // .name): \(.conclusion)"'

            FAILED_RUN_IDS=$(echo "$RUNS_JSON" | jq -r '.[] | select(.status == "completed" and .conclusion != "success" and .conclusion != "skipped") | .databaseId')
            echo ""
            echo "查看失败日志:"
            for run_id in $FAILED_RUN_IDS; do
                echo "  gh run view $run_id --log-failed"
            done

            echo ""
            echo -e "${RED}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
            echo -e "${RED}${BOLD}AI 行为约束（不可违反）:${NC}"
            echo "  1. 必须查看失败日志并修复问题"
            echo "  2. 修复后推送到 main，重新运行本脚本"
            echo "  3. 不得跳过 CI 失败继续 publish"
            echo "  4. 如果无法在 main 上直接修复，需要 revert 合并"
            echo -e "${RED}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
            exit 1
        else
            echo ""
            echo -e "${GREEN}${BOLD}✅ CI 全部通过！${NC} ($SUCCESSES/$TOTAL)"
            _ci_log "CI 通过: $SUCCESSES/$TOTAL (耗时 ${ELAPSED}s)"
            break
        fi
    fi

    # 超时
    if [[ $ELAPSED -ge $TIMEOUT ]]; then
        echo ""
        echo -e "${YELLOW}${BOLD}⚠️  CI 等待超时（${TIMEOUT}s）${NC}"
        _ci_log "CI 等待超时 (${TIMEOUT}s), $PENDING pending"
        echo "  仍有 $PENDING 个 workflow 在运行中"
        echo ""
        echo "  建议:"
        echo "    1. 手动检查: gh run list --commit $REF"
        echo "    2. 增加超时: wait-for-ci.sh $REF --timeout 3600"
        echo "    3. 确认通过后继续后续流程"
        exit 2  # exit 2 = timeout, AI 应询问用户
    fi

    sleep "$POLL_INTERVAL"
    ELAPSED=$((ELAPSED + POLL_INTERVAL))
done

# ── 验证 Draft Release 产物 ──────────────────────────────────────
# CI 通过后，可选检查 Draft Release 是否创建成功、产物数量是否正确
# 用法: --verify-release v1.2.3
if [[ -n "$VERIFY_RELEASE_TAG" ]]; then
    echo ""
    echo -e "${BOLD}验证 Release 产物...${NC}"
    echo "  Tag: $VERIFY_RELEASE_TAG"

    # 轮询等待 Draft Release 出现（CI 可能需要额外时间创建）
    VERIFY_ELAPSED=0
    VERIFY_TIMEOUT=120
    RELEASE_JSON=""

    while [[ $VERIFY_ELAPSED -lt $VERIFY_TIMEOUT ]]; do
        RELEASE_JSON=$(gh release view "$VERIFY_RELEASE_TAG" $GH_FLAG --json tagName,isDraft,assets --jq '{tag: .tagName, draft: .isDraft, asset_count: (.assets | length), assets: [.assets[].name]}' 2>/dev/null || echo "")
        if [[ -n "$RELEASE_JSON" ]]; then
            break
        fi
        echo "  ⏳ Release 尚未创建，等待中... (${VERIFY_ELAPSED}s/${VERIFY_TIMEOUT}s)"
        sleep 10
        VERIFY_ELAPSED=$((VERIFY_ELAPSED + 10))
    done

    if [[ -z "$RELEASE_JSON" ]]; then
        echo -e "  ${RED}❌ Release $VERIFY_RELEASE_TAG 在 ${VERIFY_TIMEOUT}s 后仍未出现${NC}"
        echo "  可能原因："
        echo "    1. CI 的 release job 创建了错误 tag 的 release（版本号不一致）"
        echo "    2. release job 被跳过或失败"
        echo "    3. tag 未正确推送"
        echo ""
        echo "  排查命令:"
        echo "    gh api repos/$GH_REPO/releases --jq '.[] | \"\\(.tag_name) draft=\\(.draft) assets=\\(.assets | length)\"' | head -5"
        exit 1
    fi

    RELEASE_TAG=$(echo "$RELEASE_JSON" | jq -r '.tag')
    IS_DRAFT=$(echo "$RELEASE_JSON" | jq -r '.draft')
    ASSET_COUNT=$(echo "$RELEASE_JSON" | jq -r '.asset_count')
    ASSET_NAMES=$(echo "$RELEASE_JSON" | jq -r '.assets | join(", ")')

    echo "  Tag: $RELEASE_TAG"
    echo "  Draft: $IS_DRAFT"
    echo "  产物数量: $ASSET_COUNT"
    echo "  产物: $ASSET_NAMES"

    # 检查 tag 是否匹配
    if [[ "$RELEASE_TAG" != "$VERIFY_RELEASE_TAG" ]]; then
        echo -e "  ${RED}❌ Release tag 不匹配: 期望 $VERIFY_RELEASE_TAG, 实际 $RELEASE_TAG${NC}"
        _ci_log "Release 验证失败: tag mismatch ($RELEASE_TAG != $VERIFY_RELEASE_TAG)"
        echo "  根因：CI 的 src-electron/package.json 版本号与根 package.json 不一致"
        echo "  修复：同步版本号后重新触发 CI"
        exit 1
    fi

    # 检查产物数量（至少应有 1 个非 source-code 产物）
    # 但 npm monorepo 项目（有 .changeset/config.json）交付物是 npm registry 包，无 GitHub assets
    HAS_CHANGESET=false
    if [[ -f ".changeset/config.json" ]]; then
        HAS_CHANGESET=true
    fi

    if [[ "$ASSET_COUNT" -eq 0 ]]; then
        if $HAS_CHANGESET; then
            echo -e "  ${GREEN}✅ npm monorepo 项目，交付物在 npm registry（阶段 6 验证）${NC}"
            _ci_log "Release 验证跳过: npm monorepo 项目，无 GitHub assets 是正常的"
        else
            echo -e "  ${YELLOW}⚠️  Release 无构建产物（只有 source code）${NC}"
            _ci_log "Release 验证失败: 无构建产物"
            echo "  可能原因：build job 失败或 artifact upload 被跳过"
            echo "  排查：gh run list --workflow Release --limit 3"
            exit 1
        fi
    fi

    echo -e "  ${GREEN}✅ Release 验证通过${NC}"
_ci_log "Release 验证通过: tag=$VERIFY_RELEASE_TAG, assets=$ASSET_COUNT"
fi

exit 0
