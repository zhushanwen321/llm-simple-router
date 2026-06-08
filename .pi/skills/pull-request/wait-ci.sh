#!/usr/bin/env bash
# 等待 PR 的 CI checks 全部完成
# 用法: bash wait-ci.sh [PR_NUMBER]
# 退出码: 0=全部成功, 1=有失败, 2=超时
set -euo pipefail

POLL_INTERVAL=30
MAX_WAIT=600  # 10 分钟

# 获取 PR 编号
if [ $# -ge 1 ]; then
  PR_NUMBER="$1"
else
  BRANCH=$(git branch --show-current)
  PR_NUMBER=$(gh pr list --head "$BRANCH" --json number --jq '.[0].number' 2>/dev/null || true)
  if [ -z "$PR_NUMBER" ]; then
    echo "❌ 未找到当前分支 ($BRANCH) 对应的 PR"
    exit 1
  fi
fi

echo "⏳ 等待 PR #$PR_NUMBER 的 CI checks（每 ${POLL_INTERVAL}s 轮询，超时 ${MAX_WAIT}s）"

elapsed=0
while [ $elapsed -lt $MAX_WAIT ]; do
  # 获取所有 check 的 name|conclusion 对（conclusion 为 null 时输出 "pending"）
  checks=$(gh pr view "$PR_NUMBER" --json statusCheckRollup \
    --jq '[.statusCheckRollup[]? | .name + "|" + ((.conclusion // "pending") | tostring)] | join("\n")' 2>/dev/null || echo "")

  if [ -z "$checks" ]; then
    echo "[${elapsed}s] 无 CI checks，可能尚未触发，继续等待..."
    sleep "$POLL_INTERVAL"
    elapsed=$((elapsed + POLL_INTERVAL))
    continue
  fi

  total=$(echo "$checks" | wc -l | tr -d ' ')

  # 用 awk 统计各状态
  stats=$(echo "$checks" | awk -F'|' '
    {
      total++
      if ($2 == "success" || $2 == "SUCCESS") ok++
      else if ($2 == "skipped" || $2 == "SKIPPED" || $2 == "cancelled" || $2 == "CANCELLED") ok++
      else if ($2 == "pending" || $2 == "queued" || $2 == "in_progress" || $2 == "null" || $2 == "") wait++
      else fail++
    }
    END {
      printf "%d %d %d %d", total, (ok+0), (wait+0), (fail+0)
    }')
  read -r ok_count wait_count fail_count _ <<< "$(echo "$stats" | awk '{print $2, $3, $4}')"
  # 重新计算：stats 格式是 "total ok wait fail"
  read -r total_count ok_count wait_count fail_count <<< "$stats"

  echo "[${elapsed}s] 总计: $total_count, 通过: $ok_count, 等待中: $wait_count, 失败: $fail_count"

  # 还有未完成的 check
  if [ "$wait_count" -gt 0 ] 2>/dev/null; then
    echo "$checks" | awk -F'|' '$2 ~ /pending|queued|in_progress|null/' | while IFS='|' read -r name status; do
      echo "  ⏳ $name: $status"
    done
    sleep "$POLL_INTERVAL"
    elapsed=$((elapsed + POLL_INTERVAL))
    continue
  fi

  # 所有 check 都已完成
  if [ "$fail_count" -eq 0 ] 2>/dev/null; then
    echo "✅ 所有 CI checks 通过 ($ok_count/$total_count)"
    exit 0
  else
    echo "❌ 部分 CI checks 失败:"
    echo "$checks" | awk -F'|' '$2 !~ /success|pending|queued|in_progress|null/' | while IFS='|' read -r name status; do
      echo "  ✗ $name: $status"
    done
    echo ""
    echo "查看详情: gh pr view $PR_NUMBER --web"
    exit 1
  fi
done

echo "❌ 等待超时 (${MAX_WAIT}s)，CI 未完成"
echo "手动查看: gh pr view $PR_NUMBER --json statusCheckRollup --jq '.statusCheckRollup[] | .name + \": \" + (.conclusion // .status // \"pending\")'"
exit 2
