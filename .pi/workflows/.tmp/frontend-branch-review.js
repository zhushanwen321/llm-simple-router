const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');

const FEAT = '/Users/zhushanwen/Code/llm-simple-router-workspace/feat-frontend-design';
const MAIN = '/Users/zhushanwen/Code/llm-simple-router-workspace/main';
const OUT = `${FEAT}/docs/scratch/2026-05-26-frontend-branch-review`;
const BATCH = 3;

const meta = {
  name: 'frontend-branch-review',
  description: 'Compare feat-frontend-design frontend files with main branch for functional consistency',
  phases: [
    { name: 'analyze', description: 'List files, group by feature, write mapping table' },
    { name: 'review', description: 'Parallel review each group for functional differences' },
    { name: 'synthesize', description: 'Combine all reviews into summary report' },
  ],
};

async function execute({ agent, parallel }) {
  mkdirSync(OUT, { recursive: true });

  // ── Phase 1: Analyze files, group by feature, write mapping table ──
  console.log('[Phase 1] Analyzing files and creating groups...');
  await agent('general-purpose', `
<背景>
对比 feat-frontend-design 与 main 分支的前端文件，检查功能一致性。
</背景>

<任务>
1. 用 find 命令列出两个目录下的前端文件（排除 components/ui/）：
   - ${FEAT}/frontend/src
   - ${MAIN}/frontend/src
   排除规则：components/ui/ 整个目录（shadcn-vue库组件，两边完全一致）

2. 将 feat 分支的非 UI 文件按功能相关性分组，每组不超过 5 个文件。
   分组按功能模块：Dashboard、Provider、Logs、Monitor、Mappings、RetryRules、Settings 等。

3. 对每个分组，找到 main 分支中的对应文件。main 中不存在的标注 "NEW"，feat 中不存在的标注 "REMOVED"。

4. 将结果写入两个文件：

   a) ${OUT}/frontend-file-groups.md — 人类可读的 markdown 表格：
   | 分组ID | 分组名称 | feat文件 | main对应文件 | 分组简介 |
   |--------|---------|---------|-------------|---------|

   b) ${OUT}/frontend-file-groups.json — 供脚本使用的 JSON 数组：
   [
     {
       "id": 1,
       "name": "分组名称",
       "description": "分组简介",
       "featFiles": ["frontend/src/...", ...],
       "mainFiles": ["frontend/src/...", ...],
       "notes": "如有新增/删除文件在此说明"
     }
   ]
</任务>

<约束>
- 排除 components/ui/ 目录
- 分组按功能模块划分，每组不超过 5 个文件
- 所有文件路径使用相对于 frontend/ 的路径
- 禁止使用 subagent 工具。不要调外部 API。先产出初稿。
</约束>
`);

  // Read groups from JSON
  const groupsJson = readFileSync(`${OUT}/frontend-file-groups.json`, 'utf-8');
  const groups = JSON.parse(groupsJson);
  console.log(`[Phase 1] Created ${groups.length} groups`);

  // ── Phase 2: Parallel review in batches of 3 ──
  const allReviewFiles = [];
  for (let i = 0; i < groups.length; i += BATCH) {
    const batch = groups.slice(i, i + BATCH);
    const batchNum = Math.floor(i / BATCH) + 1;
    const totalBatches = Math.ceil(groups.length / BATCH);
    console.log(`[Phase 2] Reviewing batch ${batchNum}/${totalBatches} (groups ${batch.map(g => g.id).join(', ')})...`);

    const reviewTasks = batch.map(group => ({
      agent: 'general-purpose',
      task: `
<背景>
对比 feat-frontend-design 与 main 分支的前端文件功能一致性。
当前审查分组：${group.name}（${group.description}）
</背景>

<任务>
逐一读取并对比以下文件在两个分支中的内容，检查功能是否完全一致。

feat 分支文件（逐个用 read 工具读取）：
${group.featFiles.map(f => `- ${FEAT}/${f}`).join('\n')}

main 分支文件（逐个用 read 工具读取）：
${group.mainFiles.map(f => `- ${MAIN}/${f}`).join('\n')}

对比要点：
1. 功能逻辑是否一致（有无功能缺失或变更）
2. API 调用是否一致（端点、参数、错误处理）
3. 组件 props/emits/slots 是否一致
4. 事件处理是否一致
5. 数据流是否一致（composable 返回值、响应式状态）
6. 业务规则是否一致（验证逻辑、计算逻辑）

将审查结果写入：${OUT}/review-group-${group.id}.md

格式：
# 分组 ${group.id}: ${group.name}

## 审查结论
[一致 / 有差异]

## 差异详情
（如有差异，逐一列出；如一致则写"无功能差异"）

### 文件: xxx.vue
- 差异类型: 功能缺失 / 功能变更 / 新增功能 / 代码重构
- 详细说明: ...
- 影响评估: 高 / 中 / 低

## 新增文件说明
（如有 feat 独有的文件，说明其功能）

## 移除文件说明
（如有 main 独有的文件，说明其功能是否被替代）
</任务>

<约束>
- 只关注功能差异，不关注样式/格式/命名差异
- 新增文件不视为差异（feat的新功能），但要说明其用途
- main 中有但 feat 中没有的文件是"已移除"，需重点说明
- 禁止使用 subagent 工具，不要调外部 API
- 先产出初稿，不要等异步结果
</约束>`,
    }));

    await parallel(reviewTasks);

    batch.forEach(g => allReviewFiles.push(`review-group-${g.id}.md`));
  }

  console.log(`[Phase 2] Completed ${allReviewFiles.length} reviews`);

  // ── Phase 3: Synthesize all reviews ──
  console.log('[Phase 3] Synthesizing results...');
  await agent('general-purpose', `
<背景>
已完成 feat-frontend-design 与 main 分支前端文件的功能对比审查。
每个分组的审查结果在 ${OUT}/review-group-*.md 中。
</背景>

<任务>
1. 读取所有审查结果文件：
${allReviewFiles.map(f => `   - ${OUT}/${f}`).join('\n')}
2. 综合分析所有差异
3. 将最终综合报告写入：${OUT}/review-summary.md

报告格式：
# 前端分支对比审查综合报告

## 概述
[总体评估：N个分组中有M个存在功能差异]

## 差异汇总表
| 分组 | 差异类型 | 影响评估 | 简要说明 |

## 高优先级问题（功能缺失）
[main 有但 feat 没有的功能]

## 中优先级问题（功能变更）
[逻辑、API、数据流等方面的变更]

## 低优先级问题
[小的差异，不影响核心功能]

## 新增功能清单
[feat 分支新增的功能，列出文件和用途]

## 已移除功能清单
[feat 分支中移除的 main 功能，说明是否被替代]

## 建议
[对发现的差异的修复建议]
</任务>

<约束>
- 只关注功能差异
- 禁止使用 subagent 工具，不要调外部 API
- 先产出初稿，不要等异步结果
</约束>
`);

  console.log(`[Done] All results in: ${OUT}`);
  console.log(`  - Mapping table: ${OUT}/frontend-file-groups.md`);
  console.log(`  - Group reviews: ${OUT}/review-group-*.md`);
  console.log(`  - Summary: ${OUT}/review-summary.md`);
}

module.exports = { meta, execute };
