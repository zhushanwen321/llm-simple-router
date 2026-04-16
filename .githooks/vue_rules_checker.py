#!/usr/bin/env python3
"""Vue 文件规范检查脚本

检查内容：
1. 禁止使用原生 HTML 元素（应使用 shadcn-vue 组件）
2. 禁止使用 Emoji 图标（应使用 lucide-vue-next）
3. 禁止编写自定义 CSS（应使用 Tailwind 工具类）
4. <template> 行数上限 400 行，<script setup> 行数上限 300 行

用法：
  单文件: python3 vue_rules_checker.py <absolute_path> <relative_path>
  批量:   python3 vue_rules_checker.py --batch <file1> <file2> ...
"""

import re
import sys
from pathlib import Path

# 原生 HTML 元素 → shadcn-vue 组件映射
# 只映射本项目已安装的 shadcn-vue 组件
SHADCN_COMPONENTS_MAP = {
    'button': 'Button',
    'input': 'Input',
    'select': 'Select',
    'dialog': 'Dialog',
    'label': 'Label',
    'table': 'Table',
    'badge': 'Badge',
    'card': 'Card',
    'alert': 'AlertDialog',
}

# 允许保留原生 HTML 元素的文件（子串匹配）
NATIVE_ELEM_WHITELIST: list[str] = []

# .vue 文件各区块行数上限
MAX_TEMPLATE_LINES = 400
MAX_SCRIPT_LINES = 300

# 允许保留 <style scoped> 的文件（子串匹配）
STYLE_SCOPED_WHITELIST: list[str] = []

# CSS 选择器检测正则
RE_STYLE_SELECTOR = re.compile(r'^[.\w\-]+[\s,]*\{')

# Emoji Unicode 范围
EMOJI_RANGES = [
    (0x1F600, 0x1F64F),   # emoticons
    (0x1F300, 0x1F5FF),   # misc symbols and pictographs
    (0x1F680, 0x1F6FF),   # transport and map
    (0x1F1E0, 0x1F1FF),   # flags
    (0x2600, 0x26FF),     # misc symbols
    (0x2700, 0x27BF),     # dingbats
    (0xFE00, 0xFE0F),     # variation selectors
    (0x1F900, 0x1F9FF),   # supplemental symbols
    (0x1FA00, 0x1FA6F),   # chess symbols
    (0x1FA70, 0x1FAFF),   # symbols extended-A
    (0x231A, 0x231B),     # watch, hourglass
    (0x23E9, 0x23F3),     # media control
    (0x23F8, 0x23FA),     # media control
    (0x25AA, 0x25AB),     # squares
    (0x25B6, 0x25B6),     # play button
    (0x25C0, 0x25C0),     # reverse button
    (0x25FB, 0x25FE),     # squares
    (0x2614, 0x2615),     # umbrella, hot beverage
    (0x2648, 0x2653),     # zodiac
    (0x267F, 0x267F),     # wheelchair
    (0x2693, 0x2693),     # anchor
    (0x26A1, 0x26A1),     # high voltage
    (0x26AA, 0x26AB),     # circles
    (0x26BD, 0x26BE),     # soccer, baseball
    (0x26C4, 0x26C5),     # snowman, sun
    (0x26CE, 0x26CE),     # ophiuchus
    (0x26D4, 0x26D4),     # no entry
    (0x26EA, 0x26EA),     # church
    (0x26F2, 0x26F3),     # fountain, golf
    (0x26F5, 0x26F5),     # sailboat
    (0x26FA, 0x26FA),     # tent
    (0x26FD, 0x26FD),     # fuel pump
    (0x2702, 0x2702),     # scissors
    (0x2705, 0x2705),     # check mark button
    (0x2708, 0x270D),     # airplane, writing
    (0x270F, 0x270F),     # pencil
    (0x2712, 0x2712),     # black nib
    (0x2714, 0x2714),     # check mark
    (0x2716, 0x2716),     # multiplication
    (0x271D, 0x271D),     # latin cross
    (0x2721, 0x2721),     # star of david
    (0x2728, 0x2728),     # sparkles
    (0x2733, 0x2734),     # eight spokes
    (0x2744, 0x2744),     # snowflake
    (0x2747, 0x2747),     # sparkle
    (0x274C, 0x274C),     # cross mark
    (0x274E, 0x274E),     # cross mark
    (0x2753, 0x2755),     # question marks
    (0x2757, 0x2757),     # exclamation mark
    (0x2763, 0x2764),     # heart exclamation, red heart
    (0x2795, 0x2797),     # plus, minus, divide
    (0x2B05, 0x2B07),     # arrows
    (0x2B1B, 0x2B1C),     # squares
    (0x2B50, 0x2B50),     # star
    (0x2B55, 0x2B55),     # circle
]


def check_emoji_in_line(line: str) -> bool:
    """检查行中是否包含 Emoji 字符"""
    for char in line:
        cp = ord(char)
        for start, end in EMOJI_RANGES:
            if start <= cp <= end:
                return True
    return False


def check_vue_component_usage(content: str, relative_path: str) -> tuple[int, list[str]]:
    """检查是否使用了原生 HTML 元素而应该使用 shadcn-vue 组件"""
    issues: list[str] = []
    exit_code = 0

    if 'node_modules' in relative_path or '.claude' in relative_path:
        return 0, []

    # shadcn-vue 组件自身可以使用原生元素
    if '/components/ui/' in relative_path or relative_path.startswith('components/ui/'):
        return 0, []

    # 白名单文件
    if any(w in relative_path for w in NATIVE_ELEM_WHITELIST):
        return 0, []

    lines = content.split('\n')
    in_template = False

    for i, line in enumerate(lines, 1):
        if '<template' in line:
            in_template = True
            continue
        if '</template>' in line:
            in_template = False
            continue

        if not in_template:
            continue

        stripped = line.strip()
        if not stripped or stripped.startswith('<!--'):
            continue

        for native_elem, shadcn_component in SHADCN_COMPONENTS_MAP.items():
            # <input type="checkbox"> 是标准做法，shadcn-vue 没有替代
            if native_elem == 'input' and 'type="checkbox"' in line:
                continue
            # <form> 在 Vue 中是标准做法
            if native_elem == 'form':
                continue

            pattern = re.compile(rf'<{native_elem}(?![a-z])')
            if pattern.search(line):
                issues.append(f"  [第{i}行] 禁止使用原生 <{native_elem}> 元素")
                issues.append(f"    请使用 shadcn-vue <{shadcn_component} /> 组件替代")
                exit_code = 2

    return exit_code, issues


def check_vue_file(content: str, relative_path: str) -> tuple[int, list[str]]:
    """检查 Vue 文件的代码规范"""
    issues: list[str] = []
    exit_code = 0

    lines = content.split('\n')

    # 检查 1: 禁止 Emoji
    for i, line in enumerate(lines, 1):
        stripped = line.strip()
        if not stripped or stripped.startswith('//') or stripped.startswith('*'):
            continue
        if check_emoji_in_line(line):
            issues.append(f"  [第{i}行] 禁止使用 Emoji 图标")
            issues.append("    请使用 lucide-vue-next 图标组件替代")
            exit_code = 2

    # 检查 2: 禁止自定义 CSS（style scoped 内部）
    is_style_whitelisted = any(w in relative_path for w in STYLE_SCOPED_WHITELIST)
    in_style_section = False
    in_style_tag = False

    for i, line in enumerate(lines, 1):
        if '<style' in line:
            in_style_tag = True
            if 'scoped' in line:
                in_style_section = True
            continue

        if in_style_tag and '</style>' in line:
            in_style_tag = False
            in_style_section = False
            continue

        if not in_style_section:
            continue

        if is_style_whitelisted:
            continue

        stripped = line.strip()
        if not stripped:
            continue

        if stripped.startswith('@apply'):
            continue

        if RE_STYLE_SELECTOR.search(line):
            if i < len(lines):
                next_lines = '\n'.join(lines[i:min(i + 3, len(lines))])
                if '@apply' in next_lines:
                    continue
            issues.append(f"  [第{i}行] 禁止编写自定义 CSS（特殊动画除外）")
            issues.append("    请使用 Tailwind 工具类替代")
            exit_code = 2
            continue

        if (stripped.startswith('/*') or
            stripped.startswith('//') or
            stripped.startswith('@keyframes') or
            stripped.startswith('@import') or
            'animation' in stripped or
            'transition' in stripped):
            continue

    # 检查 3: <template> / <script setup> 行数上限
    template_lines = 0
    script_lines = 0
    in_template = False
    in_script = False

    for line in lines:
        if '<template' in line and '</template>' not in line:
            in_template = True
            continue
        if '</template>' in line:
            in_template = False
            continue
        if in_template:
            template_lines += 1
            continue

        if '<script' in line and 'setup' in line and '</script>' not in line:
            in_script = True
            continue
        if '</script>' in line:
            in_script = False
            continue
        if in_script:
            script_lines += 1

    if template_lines > MAX_TEMPLATE_LINES:
        issues.append(
            f"  <template> 共 {template_lines} 行，"
            f"超出上限 {MAX_TEMPLATE_LINES} 行"
        )
        issues.append("    请提取子组件拆分模板")
        exit_code = 2

    if script_lines > MAX_SCRIPT_LINES:
        issues.append(
            f"  <script setup> 共 {script_lines} 行，"
            f"超出上限 {MAX_SCRIPT_LINES} 行"
        )
        issues.append("    请提取 composable 或子组件拆分逻辑")
        exit_code = 2

    # 检查 4: 组件使用规范
    comp_exit, comp_issues = check_vue_component_usage(content, relative_path)
    if comp_exit > exit_code:
        exit_code = comp_exit
    issues.extend(comp_issues)

    return exit_code, issues


def check_ts_file(content: str, relative_path: str) -> tuple[int, list[str]]:
    """检查 TypeScript 文件的 Emoji 使用"""
    issues: list[str] = []
    exit_code = 0

    if '/components/ui/' in relative_path:
        return 0, []

    for i, line in enumerate(content.split('\n'), 1):
        stripped = line.strip()
        if not stripped or stripped.startswith('//') or stripped.startswith('*'):
            continue
        if check_emoji_in_line(line):
            issues.append(f"  [第{i}行] 禁止使用 Emoji 图标")
            issues.append("    请使用 lucide-vue-next 图标组件替代")
            exit_code = 2

    return exit_code, issues


def run_all_checks(file_paths: list[str]) -> tuple[int, list[str]]:
    """批量检查多个文件"""
    all_issues: list[str] = []
    exit_code = 0

    for file_path_str in file_paths:
        file_path = Path(file_path_str)
        if not file_path.exists():
            continue
        try:
            content = file_path.read_text(encoding='utf-8')
        except (OSError, UnicodeDecodeError):
            continue

        try:
            cwd = Path.cwd()
            rel_path = str(file_path.relative_to(cwd))
        except ValueError:
            rel_path = file_path.name

        file_exit = 0
        file_issues: list[str] = []

        if rel_path.endswith('.vue'):
            file_exit, file_issues = check_vue_file(content, rel_path)
        elif rel_path.endswith('.ts') and 'frontend/' in rel_path:
            file_exit, file_issues = check_ts_file(content, rel_path)

        if file_exit > exit_code:
            exit_code = file_exit
        if file_issues:
            all_issues.append(f"\n代码规范检查失败: {rel_path}")
            all_issues.extend(file_issues)

    return exit_code, all_issues


def main():
    if len(sys.argv) < 3:
        print("用法: python3 vue_rules_checker.py <absolute_path> <relative_path>", file=sys.stderr)
        sys.exit(0)

    absolute_path = sys.argv[1]
    relative_path = sys.argv[2]

    file_path = Path(absolute_path)
    if not file_path.exists():
        sys.exit(0)

    try:
        content = file_path.read_text(encoding='utf-8')
    except (OSError, UnicodeDecodeError):
        sys.exit(0)

    exit_code = 0
    issues: list[str] = []

    if relative_path.endswith('.vue'):
        exit_code, issues = check_vue_file(content, relative_path)
    elif relative_path.endswith('.ts') and 'frontend/' in relative_path:
        exit_code, issues = check_ts_file(content, relative_path)

    if issues:
        print(f"代码规范检查失败: {relative_path}", file=sys.stderr)
        for issue in issues:
            print(issue, file=sys.stderr)
        print()
        if exit_code == 2:
            print("检查失败：请修复上述问题后重试。", file=sys.stderr)

    sys.exit(exit_code)


if __name__ == '__main__':
    if len(sys.argv) >= 2 and sys.argv[1] == '--batch':
        if len(sys.argv) < 3:
            print("用法: python3 vue_rules_checker.py --batch <file1> <file2> ...", file=sys.stderr)
            sys.exit(0)

        exit_code, issues = run_all_checks(sys.argv[2:])
        if issues:
            for issue in issues:
                print(issue, file=sys.stderr)
            print()
            if exit_code == 2:
                print("检查失败：请修复上述问题后重试。", file=sys.stderr)
        sys.exit(exit_code)
    else:
        main()
