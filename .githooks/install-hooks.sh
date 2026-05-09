#!/bin/bash
# Git Hooks 安装脚本
#
# 用法: cd .githooks && ./install-hooks.sh
# 或通过 npm prepare 自动执行

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# 获取项目根目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# 兼容 git worktree（.git 可能是文件）
if [ -f "$PROJECT_ROOT/.git" ]; then
    GIT_DIR=$(git -C "$PROJECT_ROOT" rev-parse --git-dir)
    GIT_HOOKS_DIR="$GIT_DIR/hooks"
else
    GIT_HOOKS_DIR="$PROJECT_ROOT/.git/hooks"
fi

echo -e "${BLUE}======================================${NC}"
echo -e "${BLUE}Git Hooks 安装脚本${NC}"
echo -e "${BLUE}======================================${NC}"
echo ""

# 检查是否在 git 仓库中
if ! git -C "$PROJECT_ROOT" rev-parse --git-dir >/dev/null 2>&1; then
    echo -e "${RED}[ERROR] 未在 Git 仓库中${NC}"
    exit 1
fi

mkdir -p "$GIT_HOOKS_DIR"

# 生成 pre-commit hook
echo -e "${BLUE}[INFO] 安装 pre-commit hook...${NC}"

cat > "$GIT_HOOKS_DIR/pre-commit" << 'HOOK_EOF'
#!/bin/bash
# Git pre-commit hook: 代码质量检查
#
# 环境变量（跳过特定检查）：
#   SKIP_ALL_CHECKS=1         - 跳过所有检查
#   SKIP_FORMAT=1             - 跳过 Prettier 格式化
#   SKIP_FRONTEND_LINT=1      - 跳过前端 ESLint
#   SKIP_TYPE_CHECK=1         - 跳过 vue-tsc 类型检查
#   SKIP_CODE_RULES_CHECK=1   - 跳过自定义代码规范检查
#   SKIP_BACKEND_LINT=1       - 跳过后端 ESLint

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

PROJECT_ROOT="$(git rev-parse --show-toplevel)"
cd "$PROJECT_ROOT"

print_section() {
    echo ""
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# 一键跳过
if [ "$SKIP_ALL_CHECKS" = "1" ]; then
    echo -e "${YELLOW}[WARN] 已跳过所有检查 (SKIP_ALL_CHECKS=1)${NC}"
    exit 0
fi

# 获取变更文件
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACMR)
FRONTEND_FILES=$(echo "$STAGED_FILES" | grep "^frontend/" || true)
BACKEND_FILES=$(echo "$STAGED_FILES" | grep -E "^src/.*\.ts$" || true)

# ============================================================================
# 0. Prettier 格式化（自动修复）
# ============================================================================

FORMAT_FILES=""
if [ -n "$FRONTEND_FILES" ]; then
    FORMAT_FILES="$FORMAT_FILES $(echo "$FRONTEND_FILES" | grep -E '\.(vue|ts|css)$' || true)"
fi
if [ -n "$BACKEND_FILES" ]; then
    FORMAT_FILES="$FORMAT_FILES $BACKEND_FILES"
fi
FORMAT_FILES=$(echo "$FORMAT_FILES" | xargs)

if [ -n "$FORMAT_FILES" ]; then
    print_section "[Prettier 格式化]"

    if [ "$SKIP_FORMAT" != "1" ]; then
        echo -e "${BLUE}[INFO] 运行 Prettier 格式化...${NC}"

        npx prettier --write $FORMAT_FILES 2>/dev/null

        FIXED_FILES=$(git diff --name-only --diff-filter=M | grep -E '\.(vue|ts|css)$' || true)
        if [ -n "$FIXED_FILES" ]; then
            echo -e "${BLUE}[INFO] Prettier 格式化了以下文件:${NC}"
            echo "$FIXED_FILES" | sed 's/^/  - /'
            git add $FIXED_FILES
        else
            echo -e "${GREEN}[OK] 所有文件格式正确${NC}"
        fi
    else
        echo -e "${YELLOW}[SKIP] Prettier 格式化已跳过${NC}"
    fi
fi

# ============================================================================
# 1. 前端 ESLint 检查
# ============================================================================

if [ -n "$FRONTEND_FILES" ]; then
    print_section "[前端 ESLint 检查]"

    if [ "$SKIP_FRONTEND_LINT" != "1" ]; then
        echo -e "${BLUE}[INFO] 运行 ESLint 检查...${NC}"

        CHANGED_VUE_TS=$(echo "$FRONTEND_FILES" | grep -E "\.(vue|ts)$" || true)

        if [ -n "$CHANGED_VUE_TS" ]; then
            ESLINT_FILES=$(echo "$CHANGED_VUE_TS" | tr '\n' ' ')

            # 自动修复
            npx eslint --fix $ESLINT_FILES 2>/dev/null || true

            # 重新检查
            ESLINT_OUTPUT=$(npx eslint --max-warnings=0 $ESLINT_FILES 2>&1)
            ESLINT_EXIT_CODE=$?

            if [ $ESLINT_EXIT_CODE -ne 0 ]; then
                echo -e "${RED}[ERROR] ESLint 检查失败:${NC}"
                echo "$ESLINT_OUTPUT"
                exit 1
            fi

            # 自动添加修复后的文件
            FIXED_FILES=$(git diff --name-only --diff-filter=M | grep "^frontend/" || true)
            if [ -n "$FIXED_FILES" ]; then
                echo -e "${BLUE}[INFO] ESLint 自动修复了以下文件:${NC}"
                echo "$FIXED_FILES" | sed 's/^/  - /'
                git add $FIXED_FILES
            fi

            echo -e "${GREEN}[OK] ESLint 检查通过${NC}"
        else
            echo -e "${GREEN}[OK] 无 .vue/.ts 文件变更${NC}"
        fi
    else
        echo -e "${YELLOW}[SKIP] ESLint 检查已跳过${NC}"
    fi
fi

# ============================================================================
# 1.5. 后端 ESLint 检查（router/ 目录）
# ============================================================================

ROUTER_FILES=$(echo "$STAGED_FILES" | grep -E "^router/src/.*\.ts$" || true)
if [ -n "$ROUTER_FILES" ]; then
    print_section "[后端 ESLint 检查]"

    if [ "$SKIP_BACKEND_LINT" != "1" ]; then
        echo -e "${BLUE}[INFO] 运行 router ESLint 检查...${NC}"

        ROUTER_ESLINT_FILES=$(echo "$ROUTER_FILES" | tr '\n' ' ')
        ESLINT_OUTPUT=$(npx eslint --max-warnings=0 $ROUTER_ESLINT_FILES 2>&1)
        ESLINT_EXIT_CODE=$?

        if [ $ESLINT_EXIT_CODE -ne 0 ]; then
            echo -e "${RED}[ERROR] 后端 ESLint 检查失败:${NC}"
            echo "$ESLINT_OUTPUT"
            exit 1
        fi

        echo -e "${GREEN}[OK] 后端 ESLint 检查通过${NC}"
    else
        echo -e "${YELLOW}[SKIP] 后端 ESLint 检查已跳过${NC}"
    fi
fi

# ============================================================================
# 2. 前端 vue-tsc 类型检查（与 CI 等价）
# ============================================================================

if [ -n "$FRONTEND_FILES" ]; then
    print_section "[前端 vue-tsc 类型检查]"

    if [ "$SKIP_TYPE_CHECK" != "1" ]; then
        CHANGED_VUE_TS=$(echo "$FRONTEND_FILES" | grep -E "\.(vue|ts)$" || true)

        if [ -n "$CHANGED_VUE_TS" ]; then
            echo -e "${BLUE}[INFO] 清除增量缓存，执行全量类型检查...${NC}"

            rm -rf frontend/node_modules/.tmp/tsconfig.app.tsbuildinfo 2>/dev/null || true

            if ! (cd frontend && npx vue-tsc -b 2>&1); then
                echo ""
                echo -e "${RED}[ERROR] vue-tsc 类型检查失败${NC}"
                exit 1
            fi

            echo -e "${GREEN}[OK] vue-tsc 类型检查通过${NC}"
        else
            echo -e "${GREEN}[OK] 无 .vue/.ts 文件变更${NC}"
        fi
    else
        echo -e "${YELLOW}[SKIP] vue-tsc 类型检查已跳过${NC}"
    fi
fi

# ============================================================================
# 3. 自定义代码规范检查（原生 HTML 元素、Emoji、自定义 CSS）
# ============================================================================

print_section "[代码规范检查]"

RULES_CHECKER=".githooks/vue_rules_checker.py"

if [ "$SKIP_CODE_RULES_CHECK" != "1" ]; then
    STAGED_FRONTEND_FILES=$(echo "$STAGED_FILES" | grep -E "^frontend/src/.*\.(vue|ts)$" || true)

    if [ -n "$STAGED_FRONTEND_FILES" ]; then
        echo -e "${BLUE}[INFO] 运行代码规范检查...${NC}"

        if [ ! -f "$RULES_CHECKER" ]; then
            echo -e "${YELLOW}[WARN] 找不到检查脚本 $RULES_CHECKER${NC}"
        else
            ABSOLUTE_FILES=""
            for FILE in $STAGED_FRONTEND_FILES; do
                ABSOLUTE_FILES="$ABSOLUTE_FILES $PROJECT_ROOT/$FILE"
            done

            python3 "$RULES_CHECKER" --batch $ABSOLUTE_FILES
            EXIT_CODE=$?

            if [ $EXIT_CODE -eq 2 ]; then
                echo ""
                echo -e "${RED}[ERROR] 代码规范检查失败${NC}"
                echo -e "${YELLOW}[INFO] 设置 SKIP_CODE_RULES_CHECK=1 跳过检查${NC}"
                exit 1
            fi
            echo -e "${GREEN}[OK] 代码规范检查通过${NC}"
        fi
    else
        echo -e "${GREEN}[OK] 无前端源码变更，跳过代码规范检查${NC}"
    fi
else
    echo -e "${YELLOW}[SKIP] 代码规范检查已跳过${NC}"
fi

# ============================================================================
# 全部通过
# ============================================================================

# ============================================================================
# 4. startsWith 路径前缀检查
# ============================================================================

print_section "[startsWith 路径前缀检查]"

if [ "$SKIP_CODE_RULES_CHECK" != "1" ]; then
    SUSPICIOUS_PREFIX=$(echo "$STAGED_FILES" | grep '\.ts$' | xargs grep -n '\.startsWith("[a-z]' 2>/dev/null || true)
    if [ -n "$SUSPICIOUS_PREFIX" ]; then
        echo -e "${YELLOW}[WARN] 以下文件使用了不安全的路径前缀检查:${NC}"
        echo "$SUSPICIOUS_PREFIX" | while IFS= read -r line; do
            echo -e "  ${YELLOW}- $line${NC}"
        done
        echo -e "${YELLOW}startsWith('/xxx') 可能错误匹配 /xxx-suffix。建议加尾部斜杠: startsWith('/xxx/')。${NC}"
        echo ""
        echo -e "${YELLOW}[HINT] 设置 SKIP_CODE_RULES_CHECK=1 跳过此项检查${NC}"
        # Warning only, not blocking — this is a best-practice suggestion
    else
        echo -e "${GREEN}[OK] 所有路径前缀检查通过${NC}"
    fi
else
    echo -e "${YELLOW}[SKIP] startsWith 路径前缀检查已跳过${NC}"
fi

# ============================================================================
# 全部通过
# ============================================================================

print_section "[所有检查通过]"

echo -e "${GREEN}代码质量检查全部通过！${NC}"
echo ""
echo -e "${CYAN}提示: 跳过检查的环境变量:${NC}"
echo -e "  ${YELLOW}SKIP_ALL_CHECKS=1${NC}          - 跳过所有"
echo -e "  ${YELLOW}SKIP_FORMAT=1${NC}             - 跳过 Prettier"
echo -e "  ${YELLOW}SKIP_FRONTEND_LINT=1${NC}      - 跳过 ESLint"
echo -e "  ${YELLOW}SKIP_TYPE_CHECK=1${NC}          - 跳过 vue-tsc"
echo -e "  ${YELLOW}SKIP_CODE_RULES_CHECK=1${NC}   - 跳过代码规范"
echo -e "  ${YELLOW}SKIP_BACKEND_LINT=1${NC}       - 跳过后端 ESLint"
echo ""

exit 0
HOOK_EOF

chmod +x "$GIT_HOOKS_DIR/pre-commit"

echo -e "${GREEN}[OK] pre-commit hook 安装完成${NC}"
echo ""

if [ -x "$GIT_HOOKS_DIR/pre-commit" ]; then
    echo -e "${GREEN}[OK] Hook 已正确设置可执行权限${NC}"
fi

echo ""
echo -e "${BLUE}======================================${NC}"
echo -e "${GREEN}[安装完成]${NC}"
echo -e "${BLUE}======================================${NC}"
echo ""
echo -e "${CYAN}已安装的检查项目:${NC}"
echo -e "  ${GREEN}[+]${NC} Prettier 格式化（自动修复）"
echo -e "  ${GREEN}[+]${NC} 前端 ESLint 代码检查"
echo -e "  ${GREEN}[+]${NC} 后端 ESLint 代码检查（router/）"
echo -e "  ${GREEN}[+]${NC} vue-tsc 类型检查（全量，与 CI 等价）"
echo -e "  ${GREEN}[+]${NC} Vue 组件规范检查（禁止原生 HTML、Emoji、自定义 CSS）"
echo ""
echo -e "${CYAN}Hook 脚本位置:${NC} .githooks/"
echo ""
