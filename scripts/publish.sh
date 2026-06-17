#!/bin/bash
# publish.sh — 一键发布（本地触发，GitHub Actions 执行）
# 用法: bash scripts/publish.sh [patch|minor|major]
#
# 流程:
#   1. 检查本地代码状态
#   2. 通过 GitHub Actions 触发 publish workflow
#   3. 等待并监控进度
#   4. 自动验证 npm/Docker/Release
#
# 前提: gh CLI 已登录

set -euo pipefail

VERSION_TYPE="${1:-patch}"
if [[ ! "$VERSION_TYPE" =~ ^(patch|minor|major)$ ]]; then
  echo "Error: 版本类型必须是 patch|minor|major"
  exit 1
fi

# ── 检查 gh CLI ──────────────────────────────────────
command -v gh >/dev/null 2>&1 || { echo "Error: gh CLI 未安装"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "Error: gh CLI 未登录"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "============================================"
echo "一键发布脚本"
echo "版本类型: $VERSION_TYPE"
echo "仓库: $(gh repo view --json nameWithOwner -q '.nameWithOwner')"
echo "============================================"
echo ""

# ── 步骤 1: 检查未提交变更 ─────────────────────────
echo "=== 步骤 1: 检查代码状态 ==="
cd "$REPO_ROOT"
if ! git diff --quiet HEAD 2>/dev/null; then
  echo "Warning: 有未提交的变更:"
  git status --short
  echo ""
  echo -n "是否继续？[y/N] "
  read -r answer
  if [[ "$answer" != "y" && "$answer" != "Y" ]]; then
    echo "已取消"
    exit 1
  fi
fi
echo "✅ 代码状态正常"
echo ""

# ── 步骤 1.5: 检查未发布改动 ─────────────────────────
# publish.sh 作为「已合并未发布」的兜底入口，发布前检测
# main 是否真的有未发布的合并 commit，避免无内容的新版本。
# 用 ls-remote 查远程 tag，避免 bare repo 下本地 rejected tag
# 干扰 `git fetch --tags`（rejected 会让新 tag 拉不下来）。
echo "=== 步骤 1.5: 检查未发布改动 ==="
LATEST_TAG=$(git ls-remote --tags origin 2>/dev/null \
  | grep -oE 'refs/tags/v[0-9]+\.[0-9]+\.[0-9]+$' \
  | sed 's|refs/tags/||' | sort -V | tail -1 || echo "")
if [[ -z "$LATEST_TAG" ]]; then
  echo "  (无历史 tag，首次发布)"
else
  # fetch main 分支（不碰 tags，不受 rejected tag 影响）+ 单独 fetch latest tag
  git fetch origin main 2>/dev/null || true
  git fetch origin tag "$LATEST_TAG" 2>/dev/null || true
  TAG_COMMIT=$(git rev-parse "$LATEST_TAG^{commit}" 2>/dev/null || echo "")
  MAIN_COMMIT=$(git rev-parse origin/main 2>/dev/null || echo "")
  if [[ -z "$TAG_COMMIT" || -z "$MAIN_COMMIT" ]]; then
    echo "  ⚠️  无法读取 commit，跳过检查"
  elif [[ "$TAG_COMMIT" == "$MAIN_COMMIT" ]]; then
    echo "  ⚠️  main HEAD 与最新 tag $LATEST_TAG 一致，没有未发布改动"
    echo "      继续发布会产生仅 bump 版本号的无内容新版本"
    echo -n "  是否仍要发布？[y/N] "
    read -r answer
    if [[ "$answer" != "y" && "$answer" != "Y" ]]; then
      echo "已取消"
      exit 0
    fi
  elif git merge-base --is-ancestor "$TAG_COMMIT" "$MAIN_COMMIT" 2>/dev/null; then
    AHEAD=$(git rev-list "$LATEST_TAG..origin/main" --count 2>/dev/null || echo "?")
    echo "  ✅ main 领先 $LATEST_TAG 共 $AHEAD 个 commit，有未发布改动"
  else
    echo "  ⚠️  main 与 $LATEST_TAG 已分叉，请检查 git log 确认"
    echo -n "  是否仍要发布？[y/N] "
    read -r answer
    if [[ "$answer" != "y" && "$answer" != "Y" ]]; then
      echo "已取消"
      exit 0
    fi
  fi
fi
echo ""

# ── 步骤 2: 触发 Publish workflow ────────────────────
echo "=== 步骤 2: 触发 GitHub Actions Publish workflow ==="
WORKFLOW_RUN=$(gh workflow run publish.yml --ref main -f bump_type="$VERSION_TYPE" 2>&1)
echo "$WORKFLOW_RUN"

# 从输出提取 run ID
RUN_ID=$(echo "$WORKFLOW_RUN" | grep -oE '[0-9]+$')
if [[ -z "$RUN_ID" ]]; then
  echo "Error: 无法获取 workflow run ID"
  exit 1
fi
echo "Run ID: $RUN_ID"
echo ""

# ── 步骤 3: 等待完成 ────────────────────────────────
echo "=== 步骤 3: 等待 Workflow 完成 ==="
echo "监控中..."
while true; do
  STATUS=$(gh run view "$RUN_ID" --json conclusion,status -q '{status: .status, conclusion: .conclusion}' 2>/dev/null || echo "")
  if [[ -z "$STATUS" ]]; then
    echo "  ⏳ 等待中..."
    sleep 15
    continue
  fi
  STATE=$(echo "$STATUS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['status'])")
  CONCLUSION=$(echo "$STATUS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('conclusion',''))")
  
  if [[ "$STATE" == "completed" ]]; then
    if [[ "$CONCLUSION" == "success" ]]; then
      echo "  ✅ Workflow 成功完成！"
      break
    else
      echo "  ❌ Workflow 失败: $CONCLUSION"
      echo ""
      echo "=== 失败日志 ==="
      gh run view "$RUN_ID" --log-failed 2>&1 | tail -30
      exit 1
    fi
  fi
  echo "  ⏳ $STATE..."
  sleep 30
done
echo ""

# ── 步骤 4: 验证 ────────────────────────────────────
echo "=== 步骤 4: 验证发布结果 ==="
echo ""

# 获取新版本号
NEW_VERSION=$(gh release list --limit 1 --json tagName -q '.[0].tagName' | sed 's/^v//')
echo "版本: $NEW_VERSION"

# 验证 npm（@llm-router/core 已废弃，独立版本，不做版本一致性校验）
echo -n "检查 llm-simple-router: "
ROUTER_VER=$(npm info llm-simple-router version 2>/dev/null || echo "FAILED")
if [[ "$ROUTER_VER" == "$NEW_VERSION" ]]; then
  echo "✅ $ROUTER_VER"
else
  echo "❌ 期望 $NEW_VERSION, 实际 $ROUTER_VER"
fi

# 验证 GitHub Release
echo -n "检查 Release Asset: "
ASSETS=$(gh release view "v$NEW_VERSION" --json assets -q '[.assets[].name] | join(", ")' 2>/dev/null || echo "FAILED")
if echo "$ASSETS" | grep -q "llm-simple-router-linux-x64.tar.gz"; then
  echo "✅ $ASSETS"
else
  echo "❌ $ASSETS"
fi

# 验证 Docker (GHCR)
# image 命名约定: ghcr.io/${{ github.repository }}，故 package 名 = repo 名
# 阿里云 ACR 无公开查询 API，与 GHCR 在同一 workflow 步骤推送，
# workflow success 即保证 ACR 已推（CI 失败会让整条流水线失败）。
echo -n "检查 Docker (GHCR): "
REPO_SLUG=$(gh repo view --json nameWithOwner -q '.nameWithOwner' 2>/dev/null || echo "")
REPO_OWNER="${REPO_SLUG%/*}"
REPO_NAME="${REPO_SLUG#*/}"
GHCR_TAG_FOUND=$(gh api "/users/$REPO_OWNER/packages/container/$REPO_NAME/versions" \
  --paginate --jq '.[] | .metadata.container.tags[]?' 2>/dev/null \
  | grep -Fx "v$NEW_VERSION" || true)
if [[ -n "$GHCR_TAG_FOUND" ]]; then
  echo "✅ v$NEW_VERSION"
  echo "    阿里云 ACR: 同 workflow 推送 (步骤 6.5)，依赖 CI success"
else
  echo "❌ GHCR 缺 v$NEW_VERSION tag"
fi

echo ""
echo "============================================"
echo "发布完成!"
echo "  版本: v$NEW_VERSION"
echo "  Release: https://github.com/$(gh repo view --json nameWithOwner -q '.nameWithOwner')/releases/tag/v$NEW_VERSION"
echo "============================================"
