#!/bin/bash
# pre-merge-check.sh — Merge 前强制本地验证脚本
#
# 在 feature worktree 中运行。自动检测项目结构，执行完整验证。
# 任何一项失败都会以非零退出码退出，并输出明确错误信息。
#
# 用法: bash ~/.claude/skills/merge-worktree/pre-merge-check.sh [worktree-dir]
#   worktree-dir: 可选，默认当前目录
#
# AI 行为约束：
#   - 此脚本的每一项检查都不可跳过
#   - 失败时必须修复后重新运行，直到全部通过
#   - 即使失败原因是"不是你改的代码"也必须修复
#   - 如果 node_modules 缺失，脚本会自动安装

set -euo pipefail

WORKTREE_DIR="${1:-.}"
cd "$WORKTREE_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0
FAILURES=()

# ── 日志支持（由 merge-and-publish.sh 通过 MERGE_LOG_FILE 环境变量注入）──
_chk_log() {
    [[ -n "${MERGE_LOG_FILE:-}" ]] || return 0
    echo "[$(date +%Y-%m-%dT%H:%M:%S)] [CHECK] $*" >> "$MERGE_LOG_FILE"
}

# ── 辅助函数 ────────────────────────────────────────

pass() {
    echo -e "  ${GREEN}✅ PASS${NC}: $1"
    PASS_COUNT=$((PASS_COUNT + 1))
    _chk_log "PASS: $1"
}

fail() {
    echo -e "  ${RED}❌ FAIL${NC}: $1"
    FAIL_COUNT=$((FAIL_COUNT + 1))
    _chk_log "FAIL: $1"
    FAILURES+=("$1")
}

skip() {
    echo -e "  ${YELLOW}⏭️  SKIP${NC}: $1"
    SKIP_COUNT=$((SKIP_COUNT + 1))
}

section() {
    echo ""
    echo -e "${BOLD}── $1 ──${NC}"
}

# 运行命令，捕获输出，根据退出码报告 pass/fail
run_check() {
    local desc="$1"
    shift
    local output
    output=$("$@" 2>&1) && exit_code=0 || exit_code=$?
    if [[ $exit_code -eq 0 ]]; then
        pass "$desc"
    else
        echo "$output" | tail -20 | sed 's/^/    /'
        fail "$desc"
    fi
    return $exit_code
}

# 获取 package.json 中的 script 值
get_script() {
    local pkg_file="$1"
    local script_name="$2"
    node -e "
        const p = require('$pkg_file');
        const val = p.scripts && p.scripts['$script_name'];
        console.log(val || '');
    " 2>/dev/null || echo ""
}

# ── 步骤 0: 确保依赖已安装 ──────────────────────────

section "步骤 0/5: 检查依赖"

if [[ -f "package.json" ]]; then
    # 动态读取 workspaces 配置
    WORKSPACE_DIRS=$(node -e "
        const p = require('./package.json');
        const ws = p.workspaces;
        if (Array.isArray(ws)) {
            ws.forEach(w => console.log(w));
        } else if (ws && Array.isArray(ws.packages)) {
            ws.packages.forEach(w => console.log(w));
        }
    " 2>/dev/null || echo "")

    if [[ -n "$WORKSPACE_DIRS" ]]; then
        # Monorepo: 检查根 node_modules 和各 workspace
        NEED_INSTALL=false
        if [[ ! -d "node_modules" ]]; then
            NEED_INSTALL=true
        else
            # 检查关键 workspace 的 node_modules（可能是 symlink，也可是真实目录）
            for ws_dir in $WORKSPACE_DIRS; do
                # 跳过 glob 模式（如 "packages/*"）
                [[ "$ws_dir" == *"*"* ]] && continue
                if [[ -d "$ws_dir" ]] && [[ ! -e "$ws_dir/node_modules" ]]; then
                    NEED_INSTALL=true
                    break
                fi
            done
        fi

        if $NEED_INSTALL; then
            echo "  📦 检测到 monorepo，安装依赖中..."
            if ! npm ci 2>&1; then
                echo "  npm ci 失败，尝试 npm install..."
                npm install 2>&1
            fi
        fi
    else
        # 非 monorepo
        if [[ ! -d "node_modules" ]]; then
            echo "  📦 安装依赖中..."
            if ! npm ci 2>&1; then
                npm install 2>&1
            fi
        fi
    fi

    # 前端独立检查（可能是 workspace 成员，也可能是独立目录）
    if [[ -f "frontend/package.json" ]] && [[ ! -e "frontend/node_modules" ]]; then
        echo "  📦 安装前端依赖中..."
        (cd frontend && { npm ci 2>&1 || npm install 2>&1; })
    fi

    # 通用扫描：安装有独立 package.json 但缺 node_modules 的子目录
    # workspace 成员的依赖被 hoist 到根 node_modules，子目录只剩少量残留包
    # 所以不能只看 node_modules 是否存在，需要检测关键类型定义是否可解析
    for _subdir in */; do
        [[ -f "${_subdir}package.json" ]] || continue
        # 跳过根 node_modules 自身
        [[ "${_subdir%/}" == "node_modules" ]] && continue

        if [[ ! -e "${_subdir}node_modules" ]]; then
            echo "  📦 安装 ${_subdir%/} 依赖中..."
            (cd "$_subdir" && { npm ci 2>&1 || npm install 2>&1; })
        else
            # node_modules 存在：检查关键依赖是否可解析
            # 如果 package.json 有 devDependencies 且包含 @types 或 typescript，
            # 说明是独立子项目，需要 node_modules 相对完整
            _has_types=$(node -e "
                try {
                    const p = require('./${_subdir}package.json');
                    const all = {...(p.dependencies||{}), ...(p.devDependencies||{})};
                    console.log(Object.keys(all).some(k => k.includes('typescript') || k.includes('fastify') || k.includes('sqlite')) ? 'yes' : 'no');
                } catch { console.log('no'); }
            " 2>/dev/null || echo 'no')

            if [[ "$_has_types" == "yes" ]]; then
                # 有类型依赖的子项目：验证 tsc 能否解析（用 --listFiles 不编译）
                _tsconfig="${_subdir}tsconfig.json"
                if [[ -f "$_tsconfig" ]]; then
                    # pipefail + grep 返回 1 会导致 set -e 退出，用 || true 保护
                    _tsc_output=$(cd "$_subdir" && npx tsc --noEmit --pretty false 2>&1 || true)
                    if echo "$_tsc_output" | grep -q "TS2307"; then
                        echo "  📦 ${_subdir%/} tsc 找不到模块，重新安装..."
                        (cd "$_subdir" && npm install 2>&1)
                    fi
                fi
            fi
        fi
    done

    pass "依赖已就绪"
else
    skip "未检测到 package.json，跳过依赖安装"
fi

# ── 步骤 1: TypeScript 类型检查 ─────────────────────

section "步骤 1/5: TypeScript 类型检查"

TSC_RAN=false

# 检测所有 tsconfig.json（排除 node_modules）
while IFS= read -r tsconfig; do
    [[ -z "$tsconfig" ]] && continue
    dir=$(dirname "$tsconfig")
    label="${dir:-.}/"

    # 跳过 frontend（后面单独处理 vue-tsc）
    [[ "$dir" == "frontend" ]] && continue

    # 优先使用 package.json 中的 build/typecheck 脚本
    pkg_file="${dir:-.}/package.json"
    if [[ -f "$pkg_file" ]]; then
        tsc_script=$(get_script "$pkg_file" "typecheck")
        if [[ -n "$tsc_script" ]]; then
            echo "  检查 $label (npm run typecheck) ..."
            run_check "${label}TypeScript 类型检查" bash -c "cd '${dir:-.}' && npm run typecheck"
            TSC_RAN=true
            continue
        fi
        build_script=$(get_script "$pkg_file" "build")
        # 如果 build 脚本就是 tsc，用 tsc --noEmit 代替
        if echo "$build_script" | grep -q "tsc"; then
            echo "  检查 $label (tsc --noEmit) ..."
            run_check "${label}TypeScript 类型检查" bash -c "cd '${dir:-.}' && npx tsc --noEmit"
            TSC_RAN=true
            continue
        fi
    fi

    # 直接运行 tsc
    if [[ "$dir" == "." ]]; then
        echo "  检查根目录 (tsc --noEmit) ..."
        run_check "TypeScript 类型检查" npx tsc --noEmit
    else
        echo "  检查 $label (tsc --noEmit) ..."
        run_check "${label}TypeScript 类型检查" bash -c "cd '$dir' && npx tsc --noEmit"
    fi
    TSC_RAN=true
done < <(find . -maxdepth 2 -name "tsconfig.json" -not -path "*/node_modules/*" -not -path "*/dist/*" 2>/dev/null | sort)

# 前端 vue-tsc（单独处理，因为命令不同）
if [[ -f "frontend/tsconfig.json" ]] || [[ -f "frontend/tsconfig.app.json" ]]; then
    echo "  检查 frontend/ (vue-tsc) ..."
    FE_PKG="frontend/package.json"
    if [[ -f "$FE_PKG" ]]; then
        fe_typecheck=$(get_script "$FE_PKG" "typecheck")
        if [[ -n "$fe_typecheck" ]]; then
            run_check "frontend/ vue-tsc 类型检查" bash -c "cd frontend && npm run typecheck"
        else
            # 没有 typecheck 脚本，直接用 vue-tsc
            run_check "frontend/ vue-tsc 类型检查" bash -c "cd frontend && npx vue-tsc --noEmit"
        fi
    else
        run_check "frontend/ vue-tsc 类型检查" bash -c "cd frontend && npx vue-tsc --noEmit"
    fi
fi

if ! $TSC_RAN && [[ ! -f "frontend/tsconfig.json" ]]; then
    skip "未检测到 tsconfig.json"
fi

# ── 步骤 2: Lint ───────────────────────────────────

section "步骤 2/5: Lint 检查"

LINT_RAN=false

# 1. 根 package.json 的 lint
if [[ -f "package.json" ]]; then
    lint_script=$(get_script "./package.json" "lint")
    if [[ -n "$lint_script" ]]; then
        echo "  运行 npm run lint ..."
        run_check "Lint 检查" npm run lint
        LINT_RAN=true
    fi
fi

# 2. 子项目 lint（仅当根没有 lint 时）
if ! $LINT_RAN; then
    for pkg_file in */package.json; do
        [[ ! -f "$pkg_file" ]] && continue
        sub_dir=$(dirname "$pkg_file")
        sub_lint=$(get_script "$pkg_file" "lint")
        if [[ -n "$sub_lint" ]]; then
            echo "  运行 $sub_dir lint ..."
            run_check "${sub_dir}/ lint 检查" bash -c "cd '$sub_dir' && npm run lint"
            LINT_RAN=true
        fi
    done
fi

# 3. 检测 eslint 配置文件（最后手段）
if ! $LINT_RAN; then
    for rc in .eslintrc.js .eslintrc.json .eslintrc.yml eslint.config.mjs eslint.config.js; do
        if [[ -f "$rc" ]]; then
            echo "  运行 npx eslint ..."
            run_check "Eslint 检查" npx eslint . --max-warnings 0
            LINT_RAN=true
            break
        fi
    done
fi

if ! $LINT_RAN; then
    skip "未检测到 lint 配置"
fi

# ── 步骤 3: 单元测试 ──────────────────────────────

section "步骤 3/5: 单元测试"

TEST_RAN=false

if [[ -f "package.json" ]]; then
    test_script=$(get_script "./package.json" "test")
    if [[ -n "$test_script" ]]; then
        # 检查 test 脚本是否是默认的 echo（npm init 生成的）
        if echo "$test_script" | grep -q "echo.*no test specified"; then
            skip "测试脚本为默认占位符"
        else
            echo "  运行 npm test ..."
            run_check "单元测试" npm test
            TEST_RAN=true
        fi
    fi
fi

if ! $TEST_RAN && [[ -f "vitest.config.ts" ]]; then
    echo "  运行 npx vitest run ..."
    run_check "Vitest 单元测试" npx vitest run
    TEST_RAN=true
fi

if ! $TEST_RAN; then
    skip "未检测到测试配置"
fi

# ── 步骤 4: 构建 ───────────────────────────────────

section "步骤 4/5: 构建检查"

BUILD_RAN=false

if [[ -f "package.json" ]]; then
    build_script=$(get_script "./package.json" "build")
    if [[ -n "$build_script" ]]; then
        echo "  运行 npm run build ..."
        run_check "构建检查" npm run build
        BUILD_RAN=true
    fi
fi

# 前端构建（如果根 build 没有包含前端）
if [[ -f "frontend/package.json" ]]; then
    fe_build=$(get_script "frontend/package.json" "build")
    if [[ -n "$fe_build" ]]; then
        # 检查根 build 是否已包含前端构建（通过简单字符串匹配）
        root_build=$(get_script "./package.json" "build")
        if echo "$root_build" | grep -q "frontend"; then
            # 根 build 已包含前端，跳过
            :
        else
            echo "  运行 frontend build ..."
            run_check "前端构建检查" bash -c "cd frontend && npm run build"
        fi
    fi
fi

if ! $BUILD_RAN; then
    skip "未检测到构建脚本"
fi

# ── 步骤 5: Git 状态 ──────────────────────────────

section "步骤 5/5: Git 状态检查"

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    # 刷新 index stat 缓存，避免 tsc/vite 构建修改文件 mtime 后导致的误报
    git update-index --refresh > /dev/null 2>&1 || true
    # 未提交变更
    changed_files=$(git diff --name-only HEAD 2>/dev/null)
    cached_files=$(git diff --cached --name-only 2>/dev/null)
    if [[ -n "$changed_files" ]] || [[ -n "$cached_files" ]]; then
        fail "有未提交的代码变更 — 必须先 git commit 后才能合并"
        echo "  未提交文件:"
        (echo "$changed_files"; echo "$cached_files") | grep -v '^$' | sort -u | head -20 | sed 's/^/    M /'
    else
        pass "Git 工作区干净"
    fi

    # 未推送 commits（用 origin/$BRANCH 而非 @{upstream}，因为 git pull --rebase 会改变 upstream 指向）
    _BRANCH=$(git branch --show-current 2>/dev/null || echo "")
    if [[ -n "$_BRANCH" ]]; then
        UNPUSHED=$(git log --oneline "origin/$_BRANCH..HEAD" 2>/dev/null || echo "")
    else
        UNPUSHED=$(git log --oneline '@{upstream}..HEAD' 2>/dev/null || echo "")
    fi
    if [[ -n "$UNPUSHED" ]]; then
        fail "有未推送的 commits — 必须先 git push 后才能合并"
        echo "  未推送:"
        echo "$UNPUSHED" | sed 's/^/    /'
    else
        pass "所有 commits 已推送"
    fi
else
    skip "不在 git 仓库中"
fi

# ── 汇总报告 ───────────────────────────────────────

echo ""
echo "══════════════════════════════════════════════════"
echo -e "${BOLD}验证报告${NC}"
echo "══════════════════════════════════════════════════"
echo ""
echo -e "  通过: ${GREEN}${PASS_COUNT}${NC}"
echo -e "  失败: ${RED}${FAIL_COUNT}${NC}"
echo -e "  跳过: ${YELLOW}${SKIP_COUNT}${NC}"

if [[ ${#FAILURES[@]} -gt 0 ]]; then
    echo ""
    echo -e "${RED}${BOLD}失败项:${NC}"
    for f in "${FAILURES[@]}"; do
        echo -e "  ${RED}❌ $f${NC}"
    done
fi

echo ""
if [[ $FAIL_COUNT -gt 0 ]]; then
    echo -e "${RED}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${RED}${BOLD}⛔ 本地验证未通过！${NC}"
    echo ""
    echo -e "  ${BOLD}AI 行为约束（不可违反）:${NC}"
    echo "  1. 必须修复所有失败项后才能继续 merge 流程"
    echo "  2. 即使失败不是你修改的代码造成的，也必须修复"
    echo "  3. 修复后重新运行本脚本，直到全部通过"
    echo "  4. 不得跳过任何失败项"
    echo "  5. 不得使用 --skip-ci 等参数绕过验证"
    echo -e "${RED}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    exit 1
else
    _chk_log "验证报告: $PASS_COUNT passed, $FAIL_COUNT failed, $SKIP_COUNT skipped"
    echo -e "${GREEN}${BOLD}✅ 本地验证全部通过！可以进入 merge 流程。${NC}"
    exit 0
fi
