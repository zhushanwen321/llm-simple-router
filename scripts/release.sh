#!/bin/bash
# release.sh — 合并 PR 分支到 main，升级版本，打 tag，推送，创建 GitHub Release
#
# 用法:
#   ./scripts/release.sh [patch|minor|major]
#   ./scripts/release.sh              # 默认 patch
#   ./scripts/release.sh minor        # 升级中间位
#
# 前提:
#   - 在 feature worktree 目录中执行（如 fix/quick-setup-providers/）
#   - gh CLI 已安装并登录
#   - 所有变更已 commit 并 push
#
# 流程:
#   1. 自动检测当前分支和对应的 PR
#   2. 在 main worktree 中 merge --no-ff
#   3. 升级 router/package.json 版本号
#   4. git tag + push
#   5. 创建 GitHub Release（触发 CI npm publish）

set -euo pipefail

# ── 参数 ──────────────────────────────────────────────
VERSION_TYPE="${1:-patch}"
if [[ ! "$VERSION_TYPE" =~ ^(patch|minor|major)$ ]]; then
  echo "Error: 版本类型必须是 patch|minor|major，收到: $VERSION_TYPE"
  exit 1
fi

# ── 前置检查 ──────────────────────────────────────────
command -v gh >/dev/null 2>&1 || { echo "Error: gh CLI 未安装"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "Error: gh CLI 未登录"; exit 1; }

# ── 定位 workspace ───────────────────────────────────
# 当前 worktree 目录（feature 分支）
WORKTREE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKSPACE_ROOT="$(cd "$WORKTREE_DIR/.." && pwd)"
BARE_DIR="$WORKSPACE_ROOT/.bare"

if [[ ! -d "$BARE_DIR" ]]; then
  echo "Error: 找不到 .bare/ 目录，请在 worktree 中运行此脚本"
  exit 1
fi

# ── 当前分支信息 ─────────────────────────────────────
cd "$WORKTREE_DIR"
CURRENT_BRANCH=$(git branch --show-current)
if [[ "$CURRENT_BRANCH" == "main" || -z "$CURRENT_BRANCH" ]]; then
  echo "Error: 请在 feature 分支的 worktree 中运行此脚本，而不是 main"
  exit 1
fi

# 检查未提交变更
if ! git diff --quiet HEAD 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
  echo "Warning: 有未提交的变更，请先 commit"
  git status --short
  exit 1
fi

echo "当前分支: $CURRENT_BRANCH"
echo "Workspace: $WORKSPACE_ROOT"
echo "版本升级: $VERSION_TYPE"
echo ""

# ── 查找 PR ──────────────────────────────────────────
PR_NUMBER=$(gh pr list --head "$CURRENT_BRANCH" --json number -q '.[0].number' 2>/dev/null || echo "")
if [[ -z "$PR_NUMBER" ]]; then
  echo "Error: 找不到分支 $CURRENT_BRANCH 对应的 PR"
  echo "请先创建 PR: bash ~/.claude/skills/pr-worktree/pr-worktree.sh"
  exit 1
fi

PR_TITLE=$(gh pr view "$PR_NUMBER" --json title -q '.title')
echo "PR: #$PR_NUMBER — $PR_TITLE"
echo ""

# ── 定位 main worktree ────────────────────────────────
MAIN_WORKTREE=""
for wt_dir in "$WORKSPACE_ROOT"/*/; do
  wt_name=$(basename "$wt_dir")
  [[ "$wt_name" == "node_modules" ]] && continue
  [[ -f "$wt_dir/.git" ]] || continue
  wt_branch=$(git -C "$wt_dir" branch --show-current 2>/dev/null || echo "")
  if [[ "$wt_branch" == "main" ]]; then
    MAIN_WORKTREE="$wt_dir"
    break
  fi
done

if [[ -z "$MAIN_WORKTREE" ]]; then
  echo "Error: 找不到 main 分支的 worktree"
  exit 1
fi

echo "Main worktree: $MAIN_WORKTREE"
echo ""

# ── 步骤 1: Merge --no-ff ─────────────────────────────
echo "=== 步骤 1/5: Merge --no-ff PR #$PR_NUMBER ==="

cd "$MAIN_WORKTREE"
git fetch origin "$CURRENT_BRANCH"
git merge --no-ff "origin/$CURRENT_BRANCH" -m "Merge branch '$CURRENT_BRANCH' (PR #$PR_NUMBER): $PR_TITLE"

echo "✅ 合并完成"
echo ""

# ── 步骤 2: 升级版本号 ────────────────────────────────
echo "=== 步骤 2/5: 升级版本号 ==="

PKG_FILE="$MAIN_WORKTREE/router/package.json"
if [[ ! -f "$PKG_FILE" ]]; then
  echo "Error: 找不到 $PKG_FILE"
  exit 1
fi

OLD_VERSION=$(node -p "require('$PKG_FILE').version")

# 检查最新 commit 是否已包含版本升级（幂等）
LATEST_COMMIT_MSG=$(git log -1 --format=%s)
if echo "$LATEST_COMMIT_MSG" | grep -qi "bump version"; then
  echo "跳过：最新 commit 已包含版本升级"
  NEW_VERSION="$OLD_VERSION"
else
  # 使用 npm version 升级（不自动 commit）
  cd "$MAIN_WORKTREE/router"
  npm version "$VERSION_TYPE" --no-git-tag-version --allow-same-version
  cd "$MAIN_WORKTREE"
  NEW_VERSION=$(node -p "require('$PKG_FILE').version")
  echo "版本升级: $OLD_VERSION → $NEW_VERSION"
fi
echo ""

# ── 步骤 3: 提交版本变更 + 打 tag ──────────────────────
echo "=== 步骤 3/5: 提交 + 打 tag ==="

TAG="v$NEW_VERSION"

# 检查是否有变更需要提交
if git diff --quiet HEAD 2>/dev/null; then
  echo "无版本变更需要提交"
else
  git add router/package.json router/package-lock.json
  git commit -m "chore: bump version to $NEW_VERSION"
fi

# 检查 tag 是否已存在
if git tag -l "$TAG" | grep -q .; then
  echo "Warning: Tag $TAG 已存在，跳过"
else
  git tag "$TAG"
  echo "Tag: $TAG"
fi
echo ""

# ── 步骤 4: Push ─────────────────────────────────────
echo "=== 步骤 4/5: Push ==="
git push origin main --tags
echo "✅ 推送完成"
echo ""

# ── 步骤 5: 创建 GitHub Release ────────────────────────
echo "=== 步骤 5/5: 创建 GitHub Release ==="

# 检查 release 是否已存在
EXISTING_RELEASE=$(gh release view "$TAG" 2>/dev/null && echo "exists" || echo "")
if [[ "$EXISTING_RELEASE" == "exists" ]]; then
  echo "Warning: Release $TAG 已存在，跳过"
else
  # 从 PR 获取 body 作为 release notes
  PR_BODY=$(gh pr view "$PR_NUMBER" --json body -q '.body // ""' | head -100)
  RELEASE_NOTES="## $TAG

${PR_BODY:-$PR_TITLE}"

  gh release create "$TAG" \
    --title "$TAG" \
    --target main \
    --notes "$RELEASE_NOTES"
  echo "✅ Release 创建成功"
fi

echo ""
echo "============================================"
echo "Release 完成!"
echo "  PR: #$PR_NUMBER"
echo "  版本: $TAG"
echo "  Release: https://github.com/$(gh repo view --json nameWithOwner -q '.nameWithOwner')/releases/tag/$TAG"
echo "============================================"
