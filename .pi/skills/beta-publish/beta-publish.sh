#!/bin/bash
# beta-publish.sh — Beta prerelease 发布
#
# 用法: bash beta-publish.sh [-y] [目标版本号]
# 示例: bash beta-publish.sh 1.0.3
#       bash beta-publish.sh -y          # 跳过交互确认（AI/CI 调用）
#       bash beta-publish.sh              # 自动 patch bump
#
# 流程:
#   1. 前置检查（gh CLI、工作区状态、当前分支）
#   2. 确定目标版本号
#   3. 确认发布
#   4. 清理历史 beta 分支
#   5. 提交推送本地变更
#   6. 创建并推送 beta 分支（触发 CI）
#   7. 切回原分支
#   8. 等待 CI 结果
#   9. 打印安装说明
#
# 前提: gh CLI 已登录，在 worktree 根目录执行

set -euo pipefail

AUTO_YES=false
TARGET_VERSION=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -y|--yes) AUTO_YES=true; shift ;;
    -*) echo "未知选项: $1"; exit 1 ;;
    *)  TARGET_VERSION="$1"; shift ;;
  esac
done

# ── 颜色定义 ──────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}ℹ${NC} $*"; }
ok()    { echo -e "${GREEN}✅${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC} $*"; }
error() { echo -e "${RED}❌${NC} $*"; }

# ── 步骤 1: 前置检查 ───────────────────────────────

info "=== 步骤 1: 前置检查 ==="

# 检查 gh CLI
if ! command -v gh >/dev/null 2>&1; then
  error "gh CLI 未安装"
  exit 1
fi
if ! gh auth status >/dev/null 2>&1; then
  error "gh CLI 未登录"
  exit 1
fi
ok "gh CLI 就绪"

# 检查 router/package.json 存在
if [[ ! -f "router/package.json" ]]; then
  error "未找到 router/package.json，请在 worktree 根目录执行"
  exit 1
fi

# 记录当前分支
ORIGINAL_BRANCH=$(git branch --show-current)
if [[ -z "$ORIGINAL_BRANCH" ]]; then
  error "无法获取当前分支（detached HEAD？）"
  exit 1
fi
info "当前分支: $ORIGINAL_BRANCH"
echo ""

# ── 步骤 2: 确定目标版本号 ────────────────────────

info "=== 步骤 2: 确定目标版本号 ==="

CURRENT_VERSION=$(jq -r '.version' router/package.json)
info "当前版本: $CURRENT_VERSION"

if [[ -n "$TARGET_VERSION" ]]; then
  # 用户指定了版本号，校验格式
  if ! [[ "$TARGET_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    error "版本号格式错误: $TARGET_VERSION（需要 X.Y.Z）"
    exit 1
  fi
  # 校验不能等于当前版本
  if [[ "$TARGET_VERSION" == "$CURRENT_VERSION" ]]; then
    error "目标版本 $TARGET_VERSION 等于当前版本，beta 应面向下一个版本"
    exit 1
  fi
else
  # 自动 patch bump
  IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"
  TARGET_VERSION="${MAJOR}.${MINOR}.$((PATCH + 1))"
fi

ok "目标版本: $TARGET_VERSION"
BETA_BRANCH="beta-${TARGET_VERSION}"
info "Beta 分支: $BETA_BRANCH"
echo ""

# ── 步骤 3: 确认发布 ──────────────────────────────

info "=== 步骤 3: 确认发布 ==="
echo "  当前版本:   $CURRENT_VERSION"
echo "  Beta 目标:  $TARGET_VERSION"
echo "  分支名:     $BETA_BRANCH"
echo "  npm tag:    beta"
echo "  CI 将发布:  ${TARGET_VERSION}-beta.{SHA}"
echo ""
echo -n "确认发布？[y/N] "
if [[ "$AUTO_YES" == true ]]; then
  echo "y (auto)"
else
  read -r answer
  if [[ "$answer" != "y" && "$answer" != "Y" ]]; then
    info "已取消"
    exit 0
  fi
fi
echo ""

# ── 步骤 4: 清理历史 beta 分支 ────────────────────

info "=== 步骤 4: 清理历史 beta 分支 ==="

# 列出远程 beta 分支
REMOTE_BETAS=$(git ls-remote --heads origin 'refs/heads/beta-*' 2>/dev/null | sed 's|.*refs/heads/||' || true)
if [[ -n "$REMOTE_BETAS" ]]; then
  info "远程 beta 分支:"
  echo "$REMOTE_BETAS" | while read -r branch; do
    echo "  - $branch"
  done
  # 逐个删除远程分支
  echo "$REMOTE_BETAS" | while read -r branch; do
    git push origin --delete "$branch" 2>/dev/null && ok "已删除远程分支: $branch" || warn "删除远程分支失败: $branch"
  done
else
  info "无远程 beta 分支需要清理"
fi

# 清理本地 beta 分支（已合并的）
LOCAL_BETAS=$(git branch --list 'beta-*' | sed 's/^[* ]*//' || true)
if [[ -n "$LOCAL_BETAS" ]]; then
  info "本地 beta 分支:"
  echo "$LOCAL_BETAS" | while read -r branch; do
    echo "  - $branch"
  done
  echo "$LOCAL_BETAS" | while read -r branch; do
    git branch -D "$branch" 2>/dev/null && ok "已删除本地分支: $branch" || warn "删除本地分支失败: $branch"
  done
else
  info "无本地 beta 分支需要清理"
fi

# 清理远程跟踪引用
git remote prune origin >/dev/null 2>&1 || true
ok "清理完成"
echo ""

# ── 步骤 5: 提交推送本地变更 ──────────────────────

info "=== 步骤 5: 提交推送本地变更 ==="

# 检查是否有未提交变更（含 untracked files）
if [ -n "$(git status --porcelain)" ]; then
  echo ""
  warn "有未提交的变更:"
  git status --short
  echo ""
  if [[ "$AUTO_YES" == true ]]; then
    echo "  → 自动提交"
    git add -A
    git commit -m "chore: beta ${TARGET_VERSION} preparation"
    ok "已自动提交"
  else
    echo -n "是否自动提交并推送？[y/N] "
    read -r auto_commit
    if [[ "$auto_commit" == "y" || "$auto_commit" == "Y" ]]; then
      git add -A
      git commit -m "chore: beta ${TARGET_VERSION} preparation"
      ok "已自动提交"
    else
      error "请先手动提交变更后重试"
      exit 1
    fi
  fi
fi

# 检查是否有未推送的 commit
LOCAL_AHEAD=$(git rev-list "@{upstream}..HEAD" --count 2>/dev/null || echo "0")
if [[ "$LOCAL_AHEAD" -gt 0 ]]; then
  info "本地有 ${LOCAL_AHEAD} 个未推送的 commit"
  git push origin "$ORIGINAL_BRANCH"
  ok "已推送到 $ORIGINAL_BRANCH"
else
  ok "本地变更已同步"
fi
echo ""

# ── 步骤 6: 创建并推送 beta 分支 ─────────────────

info "=== 步骤 6: 创建并推送 beta 分支 ==="

git branch "$BETA_BRANCH" HEAD
git push origin "$BETA_BRANCH"
ok "已创建并推送 $BETA_BRANCH"
echo ""

# ── 步骤 7: 切回原分支 ────────────────────────────

info "=== 步骤 7: 切回原分支 ==="
git checkout "$ORIGINAL_BRANCH"
ok "已切回 $ORIGINAL_BRANCH"
echo ""

# ── 步骤 8: 等待 CI 结果 ──────────────────────────

info "=== 步骤 8: 等待 CI 结果 ==="
info "等待 GitHub Actions 创建 workflow run..."

# 等待 run 出现（最多 60 秒）
RUN_ID=""
GH_TMP="/tmp/beta-publish-run.json"
for i in $(seq 1 12); do
  sleep 5
  gh run list \
    --workflow=publish.yml \
    --branch="$BETA_BRANCH" \
    --limit 1 \
    --json databaseId > "$GH_TMP" 2>/dev/null || true
  RUN_ID=$(jq -r '.[0].databaseId // empty' "$GH_TMP" 2>/dev/null || true)
  if [[ -n "$RUN_ID" ]]; then
    break
  fi
  echo "  ⏳ 等待中... ($((i * 5))s)"
done

if [[ -z "$RUN_ID" ]]; then
  error "未找到 workflow run，请手动检查:"
  echo "  gh run list --workflow=publish.yml --branch=$BETA_BRANCH"
  exit 1
fi

info "Run ID: $RUN_ID"
echo "  查看日志: gh run view $RUN_ID"
echo ""

# 轮询状态
GH_STATUS_TMP="/tmp/beta-publish-status.json"
while true; do
  gh run view "$RUN_ID" --json status,conclusion > "$GH_STATUS_TMP" 2>/dev/null || true
  STATE=$(jq -r '.status // empty' "$GH_STATUS_TMP" 2>/dev/null || true)
  CONCLUSION=$(jq -r '.conclusion // empty' "$GH_STATUS_TMP" 2>/dev/null || true)

  if [[ "$STATE" == "completed" ]]; then
    if [[ "$CONCLUSION" == "success" ]]; then
      ok "CI 成功完成！"
      break
    else
      error "CI 失败: $CONCLUSION"
      echo ""
      echo "=== 失败日志 ==="
      gh run view "$RUN_ID" --log-failed > /tmp/beta-publish-failed.log 2>&1 || true
      tail -40 /tmp/beta-publish-failed.log
      exit 1
    fi
  fi
  echo "  ⏳ $STATE..."
  sleep 15
done
echo ""

# ── 步骤 9: 打印安装说明 ──────────────────────────

info "=== 步骤 9: 安装说明 ==="

# 获取发布的 beta 版本号（从 CI 日志或 npm registry）
SHORT_SHA=$(git log --format='%h' -1 "$BETA_BRANCH" 2>/dev/null || echo "unknown")
BETA_VERSION="${TARGET_VERSION}-beta.${SHORT_SHA}"

echo ""
echo "============================================"
ok "Beta 发布完成！"
echo "  版本: $BETA_VERSION"
echo ""
echo "── npm ──────────────────────────────────"
echo "  滚动: npm install -g llm-simple-router@beta"
echo "  精确: npm install -g llm-simple-router@${BETA_VERSION}"
echo ""
echo "── Docker ──────────────────────────────"
echo "  GHCR 滚动: docker pull ghcr.io/zhushanwen321/llm-simple-router:beta"
echo "  GHCR 精确: docker pull ghcr.io/zhushanwen321/llm-simple-router:${BETA_VERSION}"
echo "  阿里云 ACR 滚动: docker pull <ACR_REGISTRY>/zhushanwen321/llm-simple-router:beta"
echo ""
echo "  运行: docker run -d -p 9980:9980 ghcr.io/zhushanwen321/llm-simple-router:beta"
echo ""
echo "查看所有 beta 版本:"
echo "  npm info llm-simple-router versions --json | jq '.[] | select(contains(\"beta\"))'"
echo "============================================"
