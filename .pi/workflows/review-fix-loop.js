export const meta = {
  name: 'review-fix-loop',
  description: 'Review-fix loop for llm-simple-router: run project code-review skill (8 dimensions), fix error+warning issues, validate with build/lint/test, repeat until clean or max iterations',
  phases: [
    { title: 'Review', detail: 'Run code-review skill and produce structured report with error/warning/info severity' },
    { title: 'Fix', detail: 'Fix all error + warning issues, commit, and validate with build + lint + test' },
  ],
}

const fs = require('node:fs')
const MAX = (typeof args === 'number' ? args : args?.maxIterations) ?? 10
const cwd = process.cwd()
const reportDir = '/tmp/review-fix-loop/' + Date.now()
fs.mkdirSync(reportDir, { recursive: true })
let totalFixed = 0
let done = 0
let clean = false
let prevFixCount = Infinity

for (let round = 0; round < MAX; round++) {
  done = round + 1
  log('--- Iteration ' + done + '/' + MAX + ' ---')

  // === Phase: Review ===
  phase('Review')
  var rPath = reportDir + '/report-' + done + '.md'

  var rv = await agent(
    'Iteration ' + done + ' of a review-fix loop for llm-simple-router.\n\n' +
    '1. Invoke the Skill tool with: { "skill": "code-review", "args": "high" }\n' +
    '   This will review the current git diff using the project\'s 8-dimension review framework.\n\n' +
    '2. After the review completes, write ALL findings to ' + rPath + ' as markdown.\n' +
    '   The file MUST contain:\n' +
    '   - Title: "# Review Report - Iteration ' + done + '"\n' +
    '   - A "## Summary" section with explicit error, warning, and info counts\n' +
    '   - Each finding with: file path, line range, description, review dimension, severity\n' +
    '   - Severity must be one of:\n' +
    '     * "error" - must fix (type errors, architecture violations, test failures, security, logic bugs)\n' +
    '     * "warning" - should fix (missing tests, fragile patterns, missing error handling)\n' +
    '     * "info" - optional optimization (style, naming, perf, minor cleanup)\n\n' +
    '3. Finally, call the StructuredOutput tool with exactly:\n' +
    '   { "review-report": "' + rPath + '", "error": <count>, "warning": <count>, "info": <count> }\n\n' +
    'If no issues found, write "No issues found" and set all counts to 0.',
    {
      label: 'review-' + done,
      phase: 'Review',
      cwd: cwd,
      schema: {
        type: 'object',
        properties: {
          'review-report': { type: 'string', description: 'Absolute path to review report markdown' },
          error: { type: 'number', description: 'Count of error issues (must fix)' },
          warning: { type: 'number', description: 'Count of warning issues (should fix)' },
          info: { type: 'number', description: 'Count of info issues (optional)' },
        },
        required: ['review-report', 'error', 'warning', 'info'],
      },
    }
  )

  if (!rv) { log('Review agent failed, stopping.'); break }

  var errCount = rv.error
  var warnCount = rv.warning
  var infoCount = rv.info
  var fixCount = errCount + warnCount
  log('Found ' + errCount + ' error(s), ' + warnCount + ' warning(s), ' + infoCount + ' info. Report: ' + rv['review-report'])

  if (fixCount === 0) { clean = true; log('Code is clean (0 error, 0 warning)!'); break }

  if (fixCount >= prevFixCount) {
    log('Stagnation detected: ' + fixCount + ' issues (>= previous ' + prevFixCount + '). Stopping.')
    break
  }
  prevFixCount = fixCount

  // === Phase: Fix ===
  phase('Fix')
  log('Fixing ' + fixCount + ' issue(s) (' + errCount + ' error + ' + warnCount + ' warning) from ' + rv['review-report'] + '...')

  var fx = await agent(
    'Read the review report at: ' + rv['review-report'] + '\n\n' +
    'Fix ALL error and warning issues listed in the report. Info-level issues are optional.\n\n' +
    'IMPORTANT: Only modify source files listed in the report. NEVER touch files under .pi/, .claude/, docs/, or any workflow/skill/config files.\n\n' +
    'Project constraints for llm-simple-router:\n' +
    '- TypeScript: no "any", use "unknown" or concrete types\n' +
    '- Test framework: vitest ONLY (import from "vitest"), NEVER node:test. Run with: npx vitest run\n' +
    '- Architecture: strict 4-layer proxy (Handler > Orchestration > Routing > Transport). No cross-layer calls\n' +
    '- ESLint: zero warnings tolerance. No eslint-disable comments\n' +
    '- DB JSON fields (providers.models etc.): use parseModels(), never raw JSON.parse\n' +
    '- Token counting: use gpt-tokenizer (o200k_base), never char-length estimation\n' +
    '- Frontend: shadcn-vue components only, no native HTML form elements\n\n' +
    'For each fix:\n' +
    '1. Read the relevant source file first\n' +
    '2. Apply the MINIMAL correct fix (no refactoring, no style changes)\n' +
    '3. Verify the fix does not break surrounding code\n\n' +
    'After fixing ALL issues:\n' +
    '1. Run validation: npx tsc --noEmit && npm run lint && npm test\n' +
    '2. Stage and commit ONLY the fixed source files (NOT .pi/ or workflow files):\n' +
    '   git add router/ frontend/ && git commit -m "fix(review-loop): iteration ' + done + ' - resolve ' + errCount + ' error(s) + ' + warnCount + ' warning(s)"\n\n' +
    'The commit is REQUIRED so the next review round can see the fixes in git diff.\n' +
    'Report any validation failures as remaining issues.\n' +
    'List every change you made (file:line -> what was fixed).\n\n' +
    'Finally, call the StructuredOutput tool with:\n' +
    '   { "fixed": <number of issues you actually fixed>, "remaining": <number you could not fix, 0 if all fixed> }',
    {
      label: 'fix-' + done,
      phase: 'Fix',
      cwd: cwd,
      schema: {
        type: 'object',
        properties: {
          fixed: { type: 'number', description: 'Number of issues actually fixed' },
          remaining: { type: 'number', description: 'Number of issues that could not be fixed' },
        },
        required: ['fixed', 'remaining'],
      },
    }
  )

  if (!fx) { log('Fix agent failed, stopping.'); break }

  var actualFixed = fx.fixed || 0
  totalFixed += actualFixed
  log('Actually fixed ' + actualFixed + ' issue(s) (' + fx.remaining + ' remaining). Total fixed: ' + totalFixed + '. Continuing...')
}

log('\n=== Loop Complete ===')

return {
  iterations: done,
  maxIterations: MAX,
  totalFixed: totalFixed,
  clean: clean,
  reportDir: reportDir,
  message: clean
    ? 'Code clean after ' + done + ' iteration(s). ' + totalFixed + ' issue(s) fixed total.'
    : 'Loop ended after ' + done + ' iteration(s). ' + totalFixed + ' issue(s) fixed. May have remaining issues.',
}
