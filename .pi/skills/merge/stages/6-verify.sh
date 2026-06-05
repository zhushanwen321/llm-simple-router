#!/bin/bash
# stages/6-verify.sh — 确认交付物（不可跳过的门禁）
#
# 用法: stages/6-verify.sh [--state <file>]
#
# 检查项：
#   1. Release 存在于 GitHub
#   2. Release 有构建产物（asset count > 0）
#   3. 产物文件列表
#   4. 如果 --draft 模式，确认是 Draft 状态
#
# 只有本阶段通过，才能执行 stage 7 清理 worktree。
# 本阶段不可跳过、不可绕过。
#
# 退出码: 0=交付物确认通过, 1=确认失败

set -euo pipefail

STAGES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
source "$STAGES_DIR/../lib/common.sh"

_sf=""
while [[ $# -gt 0 ]]; do case "$1" in --state) _sf="$2"; shift 2 ;; *) shift ;; esac; done

load_state "$(resolve_state_file "$_sf")"

GH_FLAG="${GH_REPO:+--repo $GH_REPO}"
TAG="v${NEW_VERSION}"

echo ""
echo -e "${BOLD}═══ 阶段 6/7: 确认交付物 ═══${NC}"
log_phase "阶段 6: 确认交付物 (tag=$TAG)"
echo ""
echo -e "${BOLD}⚠️  本阶段为交付物门禁，不可跳过。${NC}"
echo ""

VERIFY_PASS=true
ISSUES=""

# ── 检查 1: Release 存在 ──────────────────────────
echo "  检查 1: Release 是否存在..."
RELEASE_JSON=$(gh release view "$TAG" $GH_FLAG --json tagName,isDraft,assets,publishedAt,url --jq '.' 2>/dev/null || echo "")

if [[ -z "$RELEASE_JSON" ]]; then
    echo -e "    ${RED}❌ FAIL: Release $TAG 不存在${NC}"
    log_error "交付物确认失败: Release $TAG 不存在"
    VERIFY_PASS=false
    ISSUES="${ISSUES}\n    - Release $TAG 不存在"
else
    echo -e "    ${GREEN}✅ PASS: Release $TAG 存在${NC}"
fi

# ── 检查 2: 构建产物 ──────────────────────────────
if [[ -n "$RELEASE_JSON" ]]; then
    ASSET_COUNT=$(echo "$RELEASE_JSON" | jq -r '.assets | length')
    IS_DRAFT=$(echo "$RELEASE_JSON" | jq -r '.isDraft')
    RELEASE_URL=$(echo "$RELEASE_JSON" | jq -r '.url')

    echo ""
    echo "  检查 2: 构建产物..."
    echo "    产物数量: $ASSET_COUNT"

    if [[ "$ASSET_COUNT" -eq 0 ]]; then
        # GitHub Release 无 assets — 检测是否为纯 npm 发布项目
        # 通过检查 release.yml 中是否只有 changeset publish（无 artifact upload）来判断
        RELEASE_YML=""
        if [[ -f "$MAIN_WT/.github/workflows/release.yml" ]]; then
            RELEASE_YML=$(cat "$MAIN_WT/.github/workflows/release.yml" 2>/dev/null || true)
        fi

        NPM_PUBLISH_ONLY=false
        if echo "$RELEASE_YML" | grep -q "changeset publish" && ! echo "$RELEASE_YML" | grep -q "upload-artifact\|actions/upload"; then
            NPM_PUBLISH_ONLY=true
        fi

        if $NPM_PUBLISH_ONLY; then
            echo -e "    ${YELLOW}ℹ️  纯 npm 发布项目（无构建产物上传），验证 npm registry...${NC}"

            # 从 main worktree 的 pnpm-workspace.yaml 发现所有可发布包
            # 从 main worktree 发现所有 workspace 包
            NPM_OK=true
            NPM_FAIL_LIST=""
            while IFS= read -r pkg_json; do
                PKG_NAME=$(node -e "const p=require('$pkg_json'); process.stdout.write(p.name || '')" 2>/dev/null || true)
                PKG_VERSION=$(node -e "const p=require('$pkg_json'); process.stdout.write(p.version || '')" 2>/dev/null || true)
                PKG_PRIVATE=$(node -e "const p=require('$pkg_json'); process.stdout.write(String(p.private || false))" 2>/dev/null || true)
                if [[ "$PKG_PRIVATE" == "true" || -z "$PKG_NAME" ]]; then
                    continue
                fi
                NPM_VERSION=$(npm view "$PKG_NAME" version 2>/dev/null || echo "")
                if [[ "$NPM_VERSION" == "$PKG_VERSION" ]]; then
                    echo -e "      ${GREEN}✓${NC} $PKG_NAME@$NPM_VERSION"
                elif [[ -n "$NPM_VERSION" ]]; then
                    echo -e "      ${YELLOW}~${NC} $PKG_NAME@$NPM_VERSION (local: $PKG_VERSION)"
                else
                    echo -e "      ${RED}✗${NC} $PKG_NAME@$PKG_VERSION — npm 上未找到"
                    NPM_OK=false
                    NPM_FAIL_LIST="${NPM_FAIL_LIST}\n        - $PKG_NAME@$PKG_VERSION 未发布到 npm"
                fi
            done < <(cd "$MAIN_WT" && find extensions shared packages -maxdepth 2 -name package.json -not -path '*/node_modules/*' 2>/dev/null)

            if $NPM_OK; then
                echo -e "    ${GREEN}✅ PASS: npm 包已全部发布${NC}"
            else
                echo -e "    ${RED}❌ FAIL: 部分 npm 包未发布${NC}"
                log_error "交付物确认失败: npm 包未全部发布: $NPM_FAIL_LIST"
                VERIFY_PASS=false
                ISSUES="${ISSUES}\n    - 部分 npm 包未发布到 registry${NPM_FAIL_LIST}"
            fi
        else
            echo -e "    ${RED}❌ FAIL: Release 无构建产物（只有 source code）${NC}"
            log_error "交付物确认失败: 无构建产物"
            VERIFY_PASS=false
            ISSUES="${ISSUES}\n    - Release 无构建产物（只有 source code）"
        fi
    else
        echo -e "    ${GREEN}✅ PASS: 有 $ASSET_COUNT 个构建产物${NC}"
        # 列出产物
        echo "    产物列表:"
        echo "$RELEASE_JSON" | jq -r '.assets[] | "      - \(.name) (\(.size / 1024 / 1024 * 100 | round / 100) MB)"' 2>/dev/null
    fi

    # ── 检查 3: Draft 状态 ──────────────────────
    echo ""
    echo "  检查 3: 发布状态..."
    if $DRAFT_MODE; then
        if [[ "$IS_DRAFT" == "true" ]]; then
            echo -e "    ${GREEN}✅ PASS: Draft 状态（符合预期）${NC}"
        else
            echo -e "    ${YELLOW}⚠️  WARN: 期望 Draft 但已发布${NC}"
        fi
    else
        if [[ "$IS_DRAFT" == "true" ]]; then
            echo -e "    ${YELLOW}⚠️  WARN: Release 仍为 Draft，未正式发布${NC}"
        else
            echo -e "    ${GREEN}✅ PASS: 已正式发布${NC}"
        fi
    fi
fi

# ── 汇总 ──────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════════"
if $VERIFY_PASS; then
    echo -e "${GREEN}${BOLD}✅ 交付物确认通过${NC}"
    echo ""
    echo "  版本: $TAG"
    echo "  URL: ${RELEASE_URL:-}"
    echo "  产物: ${ASSET_COUNT:-0} 个"
    echo ""
    echo -e "  ${GREEN}可以安全执行清理（stages/7-cleanup.sh）${NC}"
    log_info "交付物确认通过: tag=$TAG, assets=${ASSET_COUNT:-0}"

    # 写入 checkpoint — 清理阶段的门禁
    checkpoint "deliverables-verified"
    save_state "$STATE_FILE"
else
    echo -e "${RED}${BOLD}⛔ 交付物确认失败！${NC}"
    echo ""
    echo -e "  问题:${ISSUES}"
    echo ""
    echo "  修复建议:"
    echo "    - Release 不存在: 检查 tag 是否推送成功，手动触发 gh workflow run release.yml"
    echo "    - 无构建产物: 等待 CI 完成或手动触发 release workflow"
    echo ""
    echo -e "  ${RED}${BOLD}不通过 = 不允许清理 worktree。${NC}"
    echo -e "  ${RED}${BOLD}问题未修复前，禁止执行 stages/7-cleanup.sh。${NC}"
    log_error "交付物确认失败"
fi
echo "══════════════════════════════════════════════════"

$VERIFY_PASS || exit 1
