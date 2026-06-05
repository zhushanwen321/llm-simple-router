#!/bin/bash
# stages/5-release.sh — Release Notes 生成 + 创建/更新 Release
#
# 用法: stages/5-release.sh [--state <file>]
#
# 退出码: 0=成功, 1=失败

set -euo pipefail

STAGES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
source "$STAGES_DIR/../lib/common.sh"

_sf=""
while [[ $# -gt 0 ]]; do case "$1" in --state) _sf="$2"; shift 2 ;; *) shift ;; esac; done

load_state "$(resolve_state_file "$_sf")"

GH_FLAG="${GH_REPO:+--repo $GH_REPO}"
TAG="v${NEW_VERSION}"
COMMIT_FILE="$WS_ROOT/.release-commits.txt"

echo ""
echo -e "${BOLD}═══ 阶段 5/7: Release ═══${NC}"
log_phase "阶段 5: Release (tag=$TAG)"

REPO_URL=$(gh repo view $GH_FLAG --json url --jq '.url' 2>/dev/null || echo "")

# 5a. 生成 commit 清单
LAST_TAG=$(git -C "$MAIN_WT" describe --tags --abbrev=0 HEAD^ 2>/dev/null || echo "")
log_info "上一个 tag: ${LAST_TAG:-none}"

if [[ -n "$LAST_TAG" ]]; then
    LOG_RANGE="$LAST_TAG..HEAD"
else
    LOG_RANGE="HEAD~30..HEAD"
fi

cd "$MAIN_WT"
git log "$LOG_RANGE" --pretty=format:"%s" --no-merges > "$COMMIT_FILE" 2>/dev/null || echo "(无 commit)" > "$COMMIT_FILE"

# 执行 generate-release-notes.sh 钩子
run_hook "generate-release-notes.sh" || true

# 5b. 确定 release notes 内容
if [[ -n "$NOTES_FILE" ]]; then
    echo "  使用指定的 release notes: $NOTES_FILE"
    FINAL_NOTES_FILE="$NOTES_FILE"
else
    echo "  从 conventional commits 自动生成 release notes..."
    FINAL_NOTES_FILE="$WS_ROOT/.release-notes-auto.md"
    generate_auto_release_notes "$COMMIT_FILE" "$TAG" "$LAST_TAG" "$REPO_URL" > "$FINAL_NOTES_FILE"

    LINES=$(wc -l < "$FINAL_NOTES_FILE" | tr -d ' ')
    if [[ "$LINES" -le 2 ]]; then
        echo -e "  ${YELLOW}⚠️  自动生成的 release notes 为空（无 feat/fix/perf/breaking commit）${NC}"
        {
            echo "## What's Changed"
            echo ""
            echo "- $PR_TITLE"
            if [[ -n "$LAST_TAG" ]] && [[ -n "$REPO_URL" ]]; then
                echo ""
                echo "**Full Changelog**: ${REPO_URL}/compare/${LAST_TAG}...${TAG}"
            fi
        } > "$FINAL_NOTES_FILE"
    fi
fi

# 5c. Release 创建策略
RELEASE_CREATED_BY_CI=false

# 检查 CI 是否已创建 Draft Release
EXISTING_RELEASE=$(gh release view "$TAG" $GH_FLAG --json isDraft,id,body,assets --jq '.' 2>/dev/null || echo "")

if [[ -n "$EXISTING_RELEASE" ]]; then
    ASSET_COUNT=$(echo "$EXISTING_RELEASE" | jq -r '.assets | length')
    log_info "发现已有 Release (assets=$ASSET_COUNT, draft=$(echo "$EXISTING_RELEASE" | jq -r '.isDraft'))"
    echo -e "  ${GREEN}CI 已创建 Release(assets=$ASSET_COUNT)${NC}"
    RELEASE_CREATED_BY_CI=true
fi

# 等待 CI 创建 Draft Release（最多 120s）
if ! $RELEASE_CREATED_BY_CI; then
    log_info "等待 CI 创建 Draft Release (最多 120s)..."
    echo "  ⏳ 等待 Release CI 创建 Draft Release..."
    WAIT_ELAPSED=0
    while [[ $WAIT_ELAPSED -lt 120 ]]; do
        sleep 5
        WAIT_ELAPSED=$((WAIT_ELAPSED + 5))
        EXISTING_RELEASE=$(gh release view "$TAG" $GH_FLAG --json isDraft,id,body,assets --jq '.' 2>/dev/null || echo "")
        if [[ -n "$EXISTING_RELEASE" ]]; then
            ASSET_COUNT=$(echo "$EXISTING_RELEASE" | jq -r '.assets | length')
            RELEASE_CREATED_BY_CI=true
            echo -e "  ${GREEN}✅ CI 已创建 Release(assets=$ASSET_COUNT, 等待 ${WAIT_ELAPSED}s）${NC}"
            log_info "CI 创建 Release 成功 (assets=$ASSET_COUNT, wait=${WAIT_ELAPSED}s)"
            break
        fi
        echo "  ⏳ 等待中... (${WAIT_ELAPSED}s/120s)"
    done
fi

# 更新或创建 Release
if [[ -n "$EXISTING_RELEASE" ]]; then
    EXISTING_BODY=$(echo "$EXISTING_RELEASE" | jq -r '.body // ""' 2>/dev/null || echo "")
    if [[ -z "$EXISTING_BODY" ]] || [[ ${#EXISTING_BODY} -lt 20 ]]; then
        echo "  ⚠️  Release $TAG 已存在但 notes 为空，回填中..."
    else
        echo "  更新已有 Release: $TAG"
    fi
    log_info "更新 Release notes"
    gh release edit "$TAG" $GH_FLAG --notes-file "$FINAL_NOTES_FILE" 2>&1 || true
    RELEASE_URL="${REPO_URL}/releases/tag/$TAG"

    # 如果 Draft 且非 --draft 模式，发布它
    IS_DRAFT=$(echo "$EXISTING_RELEASE" | jq -r '.isDraft')
    if [[ "$IS_DRAFT" == "true" ]] && ! $DRAFT_MODE; then
        echo "  发布 Draft Release..."
        log_info "发布 Draft Release (draft=false)"
        gh release edit "$TAG" $GH_FLAG --draft=false 2>&1 || true
    fi
else
    # Fallback: CI 未创建
    if ! $RELEASE_CREATED_BY_CI; then
        echo -e "  ${YELLOW}⚠️  CI 未在预期时间内创建 Draft Release，手动创建（将无构建产物）${NC}"
        echo -e "  ${YELLOW}如需构建产物，请手动触发: gh workflow run release.yml --repo $GH_REPO${NC}"
        log_warn "CI 未创建 Draft Release，fallback 到手动创建（无构建产物）"
    fi

    # 去重检查
    EXISTING_RELEASE=$(gh release view "$TAG" $GH_FLAG --json isDraft,id,body,assets --jq '.' 2>/dev/null || echo "")
    if [[ -n "$EXISTING_RELEASE" ]]; then
        echo -e "  ${GREEN}⚠️  Release 已存在（可能由 CI 在上一轮创建），更新 release notes${NC}"
        gh release edit "$TAG" $GH_FLAG --notes-file "$FINAL_NOTES_FILE" 2>&1 || true
        IS_DRAFT=$(echo "$EXISTING_RELEASE" | jq -r '.isDraft')
        if [[ "$IS_DRAFT" == "true" ]] && ! $DRAFT_MODE; then
            gh release edit "$TAG" $GH_FLAG --draft=false 2>&1 || true
        fi
        RELEASE_URL="${REPO_URL}/releases/tag/$TAG"
    else
        echo "  创建 Release: $TAG"
        log_info "手动创建 Release: $TAG"
        local_draft_flag=""
        $DRAFT_MODE && local_draft_flag="--draft"
        RELEASE_URL=$(gh release create "$TAG" $GH_FLAG \
            --title "v$NEW_VERSION" \
            --notes-file "$FINAL_NOTES_FILE" \
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

# 执行 post-release.sh 钩子
run_hook "post-release.sh" "$RELEASE_URL" || true

save_state "$STATE_FILE"
echo -e "${GREEN}✅ 阶段 5 完成${NC}"
