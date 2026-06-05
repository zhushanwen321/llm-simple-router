const meta = {
  name: 'merge-worktree',
  description: 'Merge feature branch: init → local-check → pr-merge → post-merge-ci → publish → release → verify → cleanup',
  phases: [
    '0-init',
    '1-local-check',
    '2-pr-merge',
    '3-post-merge-ci',
    '4-publish',
    '5-release',
    '6-verify',
    '7-cleanup',
  ],
};

// ─── 运行时代码（Worker async IIFE 中执行）───
// config-loader 用 import() 提取 meta 时只解析顶层 const meta = {...}
// 实际运行时由 worker-script.ts 内联到 async IIFE 中

async function execute() {
  const _path = require('node:path');
  const _os = require('node:os');
  const SKILL_DIR = _path.join(_os.homedir(), '.pi/skills/merge');
  const STAGES = (n) => `${SKILL_DIR}/stages/${n}.sh`;

  const WT_DIR = $ARGS.worktreeDir;
  const VERSION_TYPE = $ARGS.versionType ?? 'patch';
  const DRAFT = $ARGS.draft === 'true';
  const WS = $WORKSPACE;

  if (!WT_DIR) {
    throw new Error('必填参数: worktreeDir (feature worktree 目录名)');
  }

  // ─── 阶段 0: Init ──────────────────────────────
  phase('0-init');
  await agent({
    description: '0-init: 检测环境、查找 PR',
    prompt: `## 任务
在 workspace 根目录执行 merge-worktree 初始化脚本。

## 执行
\`\`\`bash
cd ${WS}
bash ${STAGES('0-init')} ${WT_DIR} ${VERSION_TYPE} ${DRAFT ? '--draft' : ''}
\`\`\`

## 预期输出
显示 workspace root、分支名、PR 编号、版本类型。状态文件写入 ${WS}/.merge-worktree-state.env。

## 失败处理
- gh CLI 未登录 → 提示用户先 gh auth login
- worktree 不存在 → 检查目录名拼写
- PR 未找到 → 确认分支已 push 且 PR 已创建

报告：worktree 路径、分支名、PR 编号。`,
  });

  // ─── 阶段 1: Local check ───────────────────────
  phase('1-local-check');
  await agent({
    description: '1-local-check: 依赖安装、tsc、lint、test、build',
    prompt: `## 任务
执行本地验证（幂等：checkpoint phase1-passed 存在则自动跳过）。

## 执行
\`\`\`bash
cd ${WS}
bash ${STAGES('1-local-check')}
\`\`\`

## 常见失败：未提交变更
原因：pre-merge 钩子同步版本或安装依赖产生了 package.json / package-lock.json 变更。
修复：
1. cd ${WS}/${WT_DIR} && git add package.json package-lock.json
2. git commit -m "chore: sync package version after merging main"
3. git push origin HEAD
4. cd ${WS} && bash ${STAGES('1-local-check')}

## 其他失败
阅读脚本输出，逐项修复后重跑。必须 exit 0 才能继续。

报告验证结果。`,
  });

  // ─── 阶段 2: PR merge ──────────────────────────
  phase('2-pr-merge');
  await agent({
    description: '2-pr-merge: 检查 PR CI → merge',
    prompt: `## 任务
检查 PR CI 状态，通过后合并 PR（幂等：PR 已合并则跳过）。

## 执行
\`\`\`bash
cd ${WS}
bash ${STAGES('2-pr-merge')}
\`\`\`

## 注意
- 使用 gh pr merge --merge（Create merge commit），禁止 squash
- 可能等待 CI 最多 10 分钟（每 30s 轮询一次）
- bash timeout 600 秒

## 失败处理
- CI 失败 → 查看失败项: gh pr view <num> --json statusCheckRollup，修复后 push 并重跑
- PR state 非 OPEN 也非 MERGED → 检查 PR 是否被关闭

报告 PR 合并结果。`,
  });

  // ─── 阶段 3: Post-merge CI ─────────────────────
  phase('3-post-merge-ci');
  await agent({
    description: '3-post-merge-ci: 等待 main 分支 CI 通过',
    prompt: `## 任务
等待 main 分支合并后的 CI 通过。

## 执行
\`\`\`bash
cd ${WS}
bash ${STAGES('3-post-merge-ci')}
\`\`\`

## 注意
- 内部调用 wait-for-ci.sh，可能等待数分钟
- CI 失败时需要在 main worktree 修复、push 后重跑本阶段
- bash timeout 600 秒

报告 CI 状态。`,
  });

  // ─── 阶段 4: Publish ───────────────────────────
  phase('4-publish');
  await agent({
    description: '4-publish: 版本 bump → tag → push → 等 Release CI',
    prompt: `## 任务
版本 bump、打 tag、推送、等待 Release CI 构建完成。

## 执行
\`\`\`bash
cd ${WS}
bash ${STAGES('4-publish')}
\`\`\`

## 说明
- 项目可能使用 scripts/publish.sh（GitHub Actions）或自行 bump
- 版本号从 package.json 读取
- 自动同步子项目 package.json 版本
- 等待 Release CI 构建产物（最多 15 分钟）

## 失败处理
- Release CI 失败 → gh run view --log-failed，修复后重跑
- 版本 bump 冲突 → 检查是否有未提交变更

报告新版本号。`,
  });

  // ─── 阶段 5: Release ───────────────────────────
  phase('5-release');
  await agent({
    description: '5-release: Release Notes + 创建/更新 Release',
    prompt: `## 任务
生成 release notes、创建或更新 GitHub Release。

## 执行
\`\`\`bash
cd ${WS}
bash ${STAGES('5-release')}
\`\`\`

## 说明
- 从 conventional commits 自动生成 release notes（feat/fix/perf/breaking）
- 先等 CI 创建的 Draft Release（含构建产物），超时则 fallback 手动创建
- 非 --draft 模式时自动发布 Draft

## 失败处理
- Release 创建失败 → 检查 tag 是否已推送: git tag -l
- 手动触发: gh workflow run release.yml

报告 Release URL。`,
  });

  // ─── 阶段 6: Verify ⚠️ 不可跳过 ───────────────
  phase('6-verify');
  await agent({
    description: '6-verify: ⚠️ 确认交付物（不可跳过的门禁）',
    prompt: `## 任务
确认 Release 存在且包含构建产物。这是清理 worktree 的硬性门禁。

## 执行
\`\`\`bash
cd ${WS}
bash ${STAGES('6-verify')}
\`\`\`

## 门禁规则
- Release 必须存在于 GitHub
- 必须有构建产物（asset count > 0）
- 不通过 = 禁止清理 worktree

## 失败处理
- Release 不存在 → 检查 tag: git tag -l，手动触发 gh workflow run release.yml
- 无产物 → 等待 CI 完成: gh run list --workflow=Publish --limit 1

报告验证结果：通过/失败。`,
  });

  // ─── 阶段 7: Cleanup ───────────────────────────
  phase('7-cleanup');
  await agent({
    description: '7-cleanup: 删除 worktree + 同步其他 worktree + 清理临时文件',
    prompt: `## 任务
删除已合并的 feature worktree、同步其他 worktree、清理临时文件。

## 执行
\`\`\`bash
cd ${WS}
bash ${STAGES('7-cleanup')}
\`\`\`

## 门禁
阶段 6 必须通过（checkpoint deliverables-verified 存在）。未通过则脚本拒绝执行。

## 失败处理
- "安全阻断：交付物未确认" → 必须先运行阶段 6
- worktree 删除失败 → 手动: cd ${WS}/main && git worktree remove ../${WT_DIR}

报告清理完成状态。`,
  });

  // ─── 汇总 ──────────────────────────────────────
  log('merge-worktree completed');
  return {
    worktreeDir: WT_DIR,
    versionType: VERSION_TYPE,
    draft: DRAFT,
    completed: true,
  };
}

// 导出 meta（供 config-loader 提取）和 execute（供 worker-script.ts 自动调用）
module.exports = { meta, execute };
