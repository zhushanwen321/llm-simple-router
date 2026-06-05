#!/bin/bash
# stages/4-publish.sh — 版本 bump + tag + push + 等待 Release CI
#
# 用法: stages/4-publish.sh [--state <file>]
#
# 退出码: 0=成功, 1=失败

set -euo pipefail

STAGES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
source "$STAGES_DIR/../lib/common.sh"

_sf=""
while [[ $# -gt 0 ]]; do case "$1" in --state) _sf="$2"; shift 2 ;; *) shift ;; esac; done

load_state "$(resolve_state_file "$_sf")"

GH_FLAG="${GH_REPO:+--repo $GH_REPO}"

echo ""
echo -e "${BOLD}═══ 阶段 4/7: 发布准备 ═══${NC}"
log_phase "阶段 4: 发布准备"

# 4a. 检查是否有项目发布脚本
PUBLISH_SH=""
for search_dir in "$MAIN_WT" "$WORKTREE_DIR"; do
    if [[ -n "$search_dir" ]] && [[ -f "$search_dir/scripts/publish.sh" ]]; then
        PUBLISH_SH="$search_dir/scripts/publish.sh"
        break
    fi
done

TAG=""

if [[ -n "$PUBLISH_SH" ]]; then
    # 幂等检查：当前版本 release 已存在则跳过
    _CUR_VER=$(read_project_version "$MAIN_WT")
    if [[ -n "$_CUR_VER" ]] && gh release view "v$_CUR_VER" $GH_FLAG --json tagName >/dev/null 2>&1; then
        echo -e "  ${GREEN}⏭️  Release v$_CUR_VER 已存在，跳过发布脚本${NC}"
        NEW_VERSION="$_CUR_VER"
        TAG="v$NEW_VERSION"
    else
        if grep -q 'gh workflow run' "$PUBLISH_SH"; then
            echo "  检测到 GitHub Actions 发布脚本"
            ( cd "$(dirname "$PUBLISH_SH")/.." && bash "$PUBLISH_SH" "$VERSION_TYPE" ) || {
                echo -e "${RED}Error: 发布脚本失败${NC}"; exit 1
            }
        else
            ( cd "$MAIN_WT" && bash "$PUBLISH_SH" "$VERSION_TYPE" ) || {
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
            NEW_VERSION=$(gh release list --limit 1 $GH_FLAG --json tagName -q '.[0].tagName' 2>/dev/null | sed 's/^v//' || echo "")
            echo -e "  ${YELLOW}⚠️  本地版本读取为空，从 release tag 获取: $NEW_VERSION${NC}"
        fi
        TAG="v$NEW_VERSION"
    fi
else
    # 4b. 自行 bump 版本 + tag + push
    OP_DIR="$MAIN_WT"

    if [[ -n "$OP_DIR" ]] && [[ -f "$OP_DIR/package.json" ]]; then
        CURRENT_VERSION=$(read_project_version "$OP_DIR")

        (
            cd "$OP_DIR"
            git fetch "$GH_REMOTE" main 2>&1 | tail -1
            git merge --ff-only FETCH_HEAD 2>&1 | tail -1 || { echo "  ${RED}Error: 无法 fast-forward main${NC}"; exit 1; }
        )

        npm version --prefix "$OP_DIR" "$VERSION_TYPE" --no-git-tag-version 2>&1
        NEW_VERSION=$(node -p "require('$OP_DIR/package.json').version")
        TAG="v$NEW_VERSION"
        echo "  版本: $CURRENT_VERSION → $NEW_VERSION"
        log_info "版本 bump: $CURRENT_VERSION → $NEW_VERSION, tag=$TAG"

        # 同步子项目 package.json 版本
        sync_sub_package_versions "$OP_DIR" "$NEW_VERSION"

        # 项目级 hook：bump 后、commit 前
        run_hook "post-bump.sh" "$OP_DIR" || {
            echo -e "  ${RED}Error: post-bump 钩子失败${NC}"; exit 1
        }

        (
            cd "$OP_DIR"
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
        if [[ -n "$OP_DIR" ]]; then
            git -C "$OP_DIR" tag "$TAG" 2>/dev/null || true
            git -C "$OP_DIR" push "$GH_REMOTE" --tags 2>&1 | tail -1
        fi
    fi

    # 4c. 等待 release CI 构建完成
    if [[ -n "$TAG" ]]; then
        echo ""
        echo "  ⏳ 等待 release CI 构建产物..."
        TAG_SHA=$(git -C "${OP_DIR}" rev-parse "$TAG" 2>/dev/null || echo "")
        if [[ -n "$TAG_SHA" ]]; then
            bash "$SKILL_DIR/wait-for-ci.sh" "$TAG_SHA" --timeout 900 --workflow "Release" --verify-release "$TAG" $GH_FLAG 2>&1 || {
                WAIT_EXIT=$?
                if [[ $WAIT_EXIT -eq 1 ]]; then
                    echo -e "  ${RED}❌ Release CI 构建失败！查看日志: gh run view --log-failed${NC}"
                    exit 1
                fi
                if [[ $WAIT_EXIT -eq 3 ]]; then
                    echo -e "  ${GREEN}项目无 Release CI workflow，跳过等待${NC}"
                else
                    echo -e "  ${YELLOW}⚠️  Release CI 超时或未触发（可能 workflow 名称不匹配），继续${NC}"
                fi
            }
        fi
        echo -e "  ${GREEN}✅ Release CI 完成${NC}"
        log_info "Release CI 完成 (tag=$TAG)"
    fi
fi

echo "  版本: v${NEW_VERSION}"
log_info "阶段 4 完成: v${NEW_VERSION}"

save_state "$STATE_FILE"
echo -e "${GREEN}✅ 阶段 4 完成${NC}"
