#!/bin/bash
# stages/2-pr-merge.sh — PR CI 检查 + 合并
#
# 用法: stages/2-pr-merge.sh [--state <file>]
#
# 幂等：PR state = MERGED 则跳过
# 退出码: 0=成功, 1=失败

set -euo pipefail

STAGES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
source "$STAGES_DIR/../lib/common.sh"

_sf=""
while [[ $# -gt 0 ]]; do case "$1" in --state) _sf="$2"; shift 2 ;; *) shift ;; esac; done

load_state "$(resolve_state_file "$_sf")"

GH_FLAG="${GH_REPO:+--repo $GH_REPO}"

echo ""
echo -e "${BOLD}═══ 阶段 2/7: PR CI + 合并 ═══${NC}"
log_phase "阶段 2: PR CI + 合并"

PR_STATE=$(gh pr view "$PR_NUMBER" $GH_FLAG --json state --jq '.state' 2>/dev/null || echo "UNKNOWN")
echo "  PR: #$PR_NUMBER — $PR_TITLE"
echo "  状态: $PR_STATE"

if [[ "$PR_STATE" == "MERGED" ]]; then
    echo -e "  ${GREEN}⏭️  PR 已合并，跳过${NC}"
    log_info "PR #$PR_NUMBER 已合并，跳过"
    echo -e "${GREEN}✅ 阶段 2 完成${NC}"
    exit 0
fi

if [[ "$PR_STATE" != "OPEN" ]]; then
    echo -e "${RED}Error: PR 状态为 $PR_STATE，无法处理${NC}"
    exit 1
fi

# 检查 PR CI 状态
echo "  检查 PR CI 状态..."
CI_DATA=$(gh pr view "$PR_NUMBER" $GH_FLAG --json statusCheckRollup 2>&1) || {
    echo -e "${YELLOW}Warning: 无法获取 CI 状态，继续合并${NC}"
    CI_DATA='{"statusCheckRollup":[]}'
}

CI_CONCLUSIONS=$(echo "$CI_DATA" | jq -r '[.statusCheckRollup[] | .conclusion] | unique | join(",")' 2>/dev/null || echo "")

if echo "$CI_CONCLUSIONS" | grep -qi "failure\|timed_out\|cancelled"; then
    echo -e "  ${RED}❌ PR CI 有失败项:${NC}"
    echo "$CI_DATA" | jq -r '.statusCheckRollup[] | select(.conclusion == "failure" or .conclusion == "timed_out" or .conclusion == "cancelled") | "    ❌ \(.name) (\(.conclusion))"' 2>/dev/null
    exit 1
fi

# 等待 PR CI
if echo "$CI_CONCLUSIONS" | grep -qi "pending\|queued\|in_progress"; then
    echo "  ⏳ PR CI 仍在运行，等待最多 10 分钟..."
    ELAPSED=0
    while [[ $ELAPSED -lt 600 ]]; do
        sleep 30
        ELAPSED=$((ELAPSED + 30))
        CI_DATA=$(gh pr view "$PR_NUMBER" $GH_FLAG --json statusCheckRollup 2>&1)
        CI_CONCLUSIONS=$(echo "$CI_DATA" | jq -r '[.statusCheckRollup[] | .conclusion] | unique | join(",")' 2>/dev/null || echo "")
        if ! echo "$CI_CONCLUSIONS" | grep -qi "pending\|queued\|in_progress"; then
            break
        fi
        echo "  ⏳ 等待中... (${ELAPSED}s/600s)"
    done
    if echo "$CI_CONCLUSIONS" | grep -qi "failure\|timed_out\|cancelled"; then
        echo -e "  ${RED}❌ PR CI 失败${NC}"
        exit 1
    fi
fi

# 合并
echo -e "  ${GREEN}✅ PR CI 通过，开始合并${NC}"
gh pr merge "$PR_NUMBER" $GH_FLAG --merge --delete-branch 2>&1 || {
    PR_STATE=$(gh pr view "$PR_NUMBER" $GH_FLAG --json state --jq '.state' 2>/dev/null || echo "UNKNOWN")
    if [[ "$PR_STATE" == "MERGED" ]]; then
        echo -e "  ${GREEN}PR 已合并（可能被其他进程合并）${NC}"
    else
        echo -e "${RED}Error: PR 合并失败${NC}"
        exit 1
    fi
}

log_info "PR #$PR_NUMBER 已合并"
save_state "$STATE_FILE"
echo -e "${GREEN}✅ 阶段 2 完成${NC}"
