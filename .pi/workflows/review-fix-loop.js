const meta = {
  name: "review-fix-loop",
  description: "Review-fix loop: parallel review (5 agents, 3+2 batched) → aggregate → fix → re-review until clean or max rounds. Per-run isolation via runId, state.json tracking, S1 conservative per-agent disable (2 consecutive clean → skip; any fix reactivates all).",
  phases: [
    { title: "Scan", detail: "Optional fallow static analysis pre-scan" },
    { title: "Review", detail: "Run review agents (skipping disabled ones) in 2 batches + aggregate" },
    { title: "Fix", detail: "Fix all must-fix issues from aggregated review report" },
  ],
};

// ── Constants & schemas ────────────────────────────────────────────

const DEFAULT_AGENT_TIMEOUT_MS = 600_000;
const MODEL = "zhipu-coding-plan-router/glm-5.2";
const CLEAN_THRESHOLD = 2; // S1: consecutive clean rounds to disable an agent

const reviewerSchema = {
  type: "object",
  properties: {
    report_file: { type: "string", description: "Absolute path to the written review report (.md)" },
    must_fix: { type: "number", description: "Number of must-fix issues found" },
    suggestion: { type: "number", description: "Number of suggestion-level issues found" },
  },
  required: ["report_file", "must_fix", "suggestion"],
};

const aggregatorSchema = {
  type: "object",
  properties: {
    report_file: { type: "string", description: "Absolute path to aggregated.md" },
    must_fix: { type: "number", description: "Total must-fix after dedup across all dimensions" },
    suggestion: { type: "number", description: "Total suggestions after dedup across all dimensions" },
  },
  required: ["report_file", "must_fix", "suggestion"],
};

const AGENT_DEFS = [
  { name: "review-business-logic", title: "BUSINESS LOGIC REVIEW", report: "business-logic",
    focus: "business logic correctness, boundary conditions, regression risk." },
  { name: "review-monorepo-impact", title: "MONOREPO IMPACT REVIEW", report: "monorepo-impact",
    focus: "workspace deps, circular deps, public API changes, extension-dependencies.json." },
  { name: "review-type-safety", title: "TYPE SAFETY REVIEW", report: "type-safety",
    focus: "complete type annotations, no `any`, use `unknown` or concrete types, run tsc." },
  { name: "review-standards", title: "STANDARDS COMPLIANCE REVIEW", report: "standards",
    focus: "architecture layering (four-layer proxy Handler→Orchestration→Routing→Transport), backend/frontend coding conventions, code taste principles, file placement per docs/standards/." },
  { name: "review-test-coverage", title: "TEST COVERAGE REVIEW", report: "test-coverage",
    focus: "tests for new logic, edge case coverage, vitest framework compliance." },
];

// ── Per-run isolation: runId-scoped directories ────────────────────

const fs = require("fs");
const path = require("path");

const RUN_ID = ($ARGS._runId && typeof $ARGS._runId === "string")
  ? $ARGS._runId
  : "run-" + Date.now();
const RUN_ROOT = `/tmp/review-fix-loop/${RUN_ID}`;
const STATE_FILE = `${RUN_ROOT}/state.json`;

fs.mkdirSync(RUN_ROOT, { recursive: true });
log(`Run directory: ${RUN_ROOT}`);

// ── State management (persistent, atomic writes) ───────────────────

/**
 * state.json shape:
 * {
 *   meta: { runId, workspace, model, startedAt },
 *   agentStatus: { [agentName]: { consecutiveClean, disabled, lastActiveRound, lastMustFix } },
 *   rounds: [ { round, mustFix, suggestion, modifiedFiles?, agents: [ {name, must_fix, suggestion, clean} ] } ]
 * }
 */
function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  } catch {
    return {
      meta: { runId: RUN_ID, workspace: $WORKSPACE || "", model: MODEL, startedAt: new Date().toISOString() },
      agentStatus: {},
      rounds: [],
    };
  }
}

function saveState(state) {
  // Atomic write: tmp + rename to avoid partial reads mid-write.
  const tmp = STATE_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STATE_FILE);
}

function recordAgentRound(state, agentName, mustFix, suggestion, round) {
  const clean = mustFix === 0;
  const status = state.agentStatus[agentName] || { consecutiveClean: 0, disabled: false, lastActiveRound: 0, lastMustFix: undefined };
  status.consecutiveClean = clean ? status.consecutiveClean + 1 : 0;
  status.disabled = status.consecutiveClean >= CLEAN_THRESHOLD;
  status.lastActiveRound = round;
  status.lastMustFix = mustFix;
  state.agentStatus[agentName] = status;
  return { ...status, cleanThisRound: clean };
}

function reactivateAll(state) {
  // S1 conservative: any fix reactivates all disabled agents.
  for (const name of Object.keys(state.agentStatus)) {
    const s = state.agentStatus[name];
    s.disabled = false;
    // Note: consecutiveClean is NOT reset — only re-disabled on next 2 consecutive cleans.
    // But since fix happened, the next review round's result will reset it naturally.
  }
}

function saveRoundSnapshot(state, round, mustFix, suggestion, agentResults, modifiedFiles) {
  state.rounds.push({
    round, mustFix, suggestion,
    agents: agentResults.map((a) => ({ name: a.name, must_fix: a.must_fix, suggestion: a.suggestion, clean: a.clean })),
    modifiedFiles: modifiedFiles || [],
  });
  saveState(state);
}

// ── Helpers ────────────────────────────────────────────────────────

function parseResult(raw) {
  if (typeof raw === "object" && raw !== null) return raw;
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch { /* fall through */ }
  }
  return null;
}

function normalizeAggregatorResult(raw) {
  const parsed = parseResult(raw);
  if (!parsed) return null;
  const mustFix =
    typeof parsed.must_fix === "number" ? parsed.must_fix :
    typeof parsed.totalMustFix === "number" ? parsed.totalMustFix :
    typeof parsed.mustFix === "number" ? parsed.mustFix : undefined;
  const suggestion =
    typeof parsed.suggestion === "number" ? parsed.suggestion :
    typeof parsed.totalSuggestions === "number" ? parsed.totalSuggestions :
    typeof parsed.suggestions === "number" ? parsed.suggestions : 0;
  if (typeof mustFix !== "number") return null;
  return { report_file: parsed.report_file || parsed.reportFile, must_fix: mustFix, suggestion };
}

// ── Build review agent calls (respecting disabled agents) ─────────

function buildReviewCalls(round, max, roundDir, fallowSummary, disabledSet) {
  const header = `Round ${round}/${max}`;
  const diffCmd = "Review \`git diff main...HEAD\` for all changes against main.";
  const fallowCtx = fallowSummary ? "\nFallow pre-scan context: " + fallowSummary : "";

  const baseCall = (def) => ({
    prompt: [header + " — " + def.title, "", diffCmd,
      "Focus: " + def.focus,
      "Write report to: " + roundDir + "/" + def.report + ".md" + fallowCtx].join("\n"),
    agent: def.name,
    model: MODEL,
    schema: reviewerSchema,
    description: def.name + "-round-" + round,
    timeoutMs: DEFAULT_AGENT_TIMEOUT_MS,
  });

  return AGENT_DEFS
    .filter((def) => !disabledSet.has(def.name))
    .map(baseCall);
}

// ── Main Loop ──────────────────────────────────────────────────────

const MAX = $ARGS.maxRounds ?? 10;
const STUCK_THRESHOLD = 3;
const SKIP_FALLOW = $ARGS.skipFallow ?? false;
const state = loadState();
let totalFixed = 0;
let round = 0;
let clean = false;
let stuckCount = 0;
let prevTotal = -1;

// Optional fallow scan (once before first round)
let fallowSummary = "";
if (!SKIP_FALLOW) {
  phase("Scan");
  try {
    const fallowRaw = await agent({
      prompt: [
        "Fallow pre-scan for review-fix-loop.",
        "",
        "Steps:",
        "1. Check if fallow is installed: `which fallow`",
        "2. If installed, run: `fallow audit --base main --format json --quiet`",
        "3. Extract: complexity hotspots, dead code, unused exports, circular deps",
        "4. Write summary to " + RUN_ROOT + "/fallow-scan.md",
        "5. If fallow not installed, write a one-line note and skip",
      ].join("\n"),
      description: "fallow-prescan",
      model: MODEL,
    });
    const fr = parseResult(fallowRaw);
    if (fr) fallowSummary = fr.summary || fr.output || "";
    if (fallowSummary) log("Fallow scan: " + fallowSummary);
  } catch {
    log("Fallow scan skipped.");
  }
}

while (round < MAX) {
  round++;
  log(`--- Round ${round}/${MAX} ---`);

  // ── Determine disabled agents (S1 conservative) ──────────
  const disabledSet = new Set(
    Object.entries(state.agentStatus)
      .filter(([, s]) => s.disabled)
      .map(([name]) => name)
  );
  if (disabledSet.size > 0) {
    log("Disabled agents (clean ≥ " + CLEAN_THRESHOLD + " consecutive): " + [...disabledSet].join(", "));
  }

  // ── Phase: Review (batched 3+2, only active agents) ──────
  phase("Review");
  const roundDir = `${RUN_ROOT}/round-${round}`;
  fs.mkdirSync(roundDir, { recursive: true });
  const allCalls = buildReviewCalls(round, MAX, roundDir, fallowSummary, disabledSet);

  if (allCalls.length === 0) {
    log("All agents disabled but code not clean — reactivating all for safety.");
    reactivateAll(state);
    saveState(state);
    continue; // restart this round with all agents active
  }

  // Batch 1: first 3 agents of active set
  log("Review batch 1/2 (3 agents)...");
  const batch1 = await parallel(allCalls.slice(0, 3));
  // Batch 2: remaining agents
  log("Review batch 2/2 (2 agents)...");
  const batch2 = await parallel(allCalls.slice(3));

  // Parse results, tolerate individual failures
  const allRaw = [...batch1, ...batch2];
  const reviewResults = [];
  const agentRoundResults = [];
  for (let i = 0; i < allRaw.length; i++) {
    const parsed = parseResult(allRaw[i]);
    if (parsed && typeof parsed.must_fix === "number") {
      reviewResults.push(parsed);
      const def = allCalls[i]; // allCalls[i] corresponds to allRaw[i] via baseCall mapping
      const recorded = recordAgentRound(state, def.agent, parsed.must_fix, parsed.suggestion ?? 0, round);
      agentRoundResults.push({ name: def.agent, must_fix: parsed.must_fix, suggestion: parsed.suggestion ?? 0, clean: recorded.cleanThisRound });
    } else {
      log("  ⚠ " + allCalls[i].description + " failed, skipping.");
    }
  }
  log(`Reviews: ${reviewResults.length}/${allCalls.length} succeeded.`);

  if (reviewResults.length === 0) {
    log("All review agents failed, stopping.");
    saveState(state);
    break;
  }

  // ── Aggregate ────────────────────────────────────────────
  const aggRaw = await agent({
    prompt: [
      `Round ${round}/${MAX} — AGGREGATE REVIEWS`,
      "",
      "Merge sub-review reports into a unified report.",
      "",
      "Sub-review results: " + JSON.stringify(reviewResults),
      "outputDir: " + roundDir,
      "",
      "Steps:",
      "1. Read each report_file from sub-review results",
      "2. Deduplicate overlapping findings by (file, line, description)",
      "3. Merge statistics: sum must_fix and suggestion after dedup",
      "4. Write " + roundDir + "/aggregated.md (human-readable report for fix agent)",
      "5. If a report file is missing, note in summary but don't fail",
      "",
      "IMPORTANT: After writing the reports, you MUST return a JSON object with exactly these fields:",
      '- "report_file": absolute path to ' + roundDir + "/aggregated.md",
      '- "must_fix": total number of MUST_FIX issues after dedup',
      '- "suggestion": total number of SUGGESTION issues after dedup',
    ].join("\n"),
    agent: "review-aggregator",
    model: MODEL,
    schema: aggregatorSchema,
    description: `aggregate-round-${round}`,
    timeoutMs: DEFAULT_AGENT_TIMEOUT_MS,
  });

  const agg = normalizeAggregatorResult(aggRaw);
  if (!agg || typeof agg.must_fix !== "number") {
    log("Aggregator returned invalid result: " + JSON.stringify(aggRaw));
    log("Aggregator failed, stopping.");
    saveState(state);
    break;
  }

  const mustFix = agg.must_fix;
  const suggestion = agg.suggestion ?? 0;
  log(`Aggregated: ${mustFix} must-fix + ${suggestion} suggestion(s).`);

  // Save snapshot (before fix; modifiedFiles filled after fix)
  const currentRoundSnapshot = { round, mustFix, suggestion, agents: agentRoundResults, modifiedFiles: [] };

  // ── Gate: clean? ─────────────────────────────────────────
  if (mustFix === 0) {
    clean = true;
    log("Code is clean!");
    state.rounds.push(currentRoundSnapshot);
    saveState(state);
    break;
  }

  // ── Stuck detection ──────────────────────────────────────
  const total = mustFix + suggestion;
  if (prevTotal >= 0 && total >= prevTotal) {
    stuckCount++;
    if (stuckCount >= STUCK_THRESHOLD) {
      log(`Stuck: total issues not decreasing for ${STUCK_THRESHOLD} rounds. Stopping.`);
      state.rounds.push(currentRoundSnapshot);
      saveState(state);
      break;
    }
  } else {
    stuckCount = 0;
  }
  prevTotal = total;

  // ── Phase: Fix ───────────────────────────────────────────
  phase("Fix");

  let reportContent;
  try {
    reportContent = fs.readFileSync(agg.report_file, "utf-8");
  } catch {
    reportContent = "(could not read aggregated report)";
  }

  // Capture files changed by fix for snapshot
  function getChangedFiles() {
    try {
      const out = require("child_process").execSync(
        "git diff --name-only HEAD", { encoding: "utf-8", timeout: 10_000 }
      ).trim();
      return out ? out.split("\n") : [];
    } catch { return []; }
  }
  const filesBefore = new Set(getChangedFiles());

  const fxRaw = await agent({
    prompt: [
      `Fix round ${round}: Fix ALL must-fix issues from the aggregated review report below.`,
      "",
      "## Aggregated Review Report",
      reportContent,
      "",
      "## Instructions",
      "- Fix every must-fix issue listed in the report",
      "- Apply the MINIMAL correct fix (no refactoring, no style changes)",
      "- Verify each fix by reading the changed file afterwards",
      "- ONLY modify source files listed in the report. NEVER touch .pi/, .claude/, docs/, or any workflow/skill/config files",
      "",
      "## Project constraints (llm-simple-router)",
      '- TypeScript: no "any", use "unknown" or concrete types',
      '- Test framework: vitest ONLY (import from "vitest"), NEVER node:test',
      "- Architecture: strict 4-layer proxy (Handler > Orchestration > Routing > Transport). No cross-layer calls",
      "- ESLint: zero warnings tolerance. No eslint-disable comments",
      "- DB JSON fields (providers.models etc.): use parseModels(), never raw JSON.parse",
      "- Token counting: use gpt-tokenizer (o200k_base), never char-length estimation",
      "- Frontend: shadcn-vue components only, no native HTML form elements",
      "",
      "## After ALL fixes",
      "1. Run validation: `npx tsc --noEmit && npm run lint && npm test`",
      "2. Stage and commit ONLY fixed source files:",
      '   `git add router/ frontend/ && git commit -m "fix(review-loop): round ' + round + ' - resolve ' + mustFix + ' must-fix"`',
      "3. Report any validation failures as remaining issues",
      "",
      "Return fixed_count, remaining, and a one-line description per fix.",
    ].join("\n"),
    schema: {
      type: "object",
      properties: {
        fixed_count: { type: "number", description: "Number of issues fixed" },
        fixes: { type: "array", items: { type: "string" }, description: "One-line description of each fix" },
        remaining: { type: "number", description: "Number of issues that could not be fixed (validation failures etc.)" },
      },
      required: ["fixed_count"],
    },
    model: MODEL,
    description: `fix-round-${round}`,
  });

  const fx = parseResult(fxRaw);
  if (!fx) {
    log("Fix agent failed, stopping.");
    state.rounds.push(currentRoundSnapshot);
    saveState(state);
    break;
  }

  const fixedCount = fx.fixed_count ?? mustFix;
  totalFixed += fixedCount;

  // S1: any fix reactivates all agents (conservative — fix may have introduced regressions)
  const filesAfter = getChangedFiles();
  const modifiedFiles = filesAfter.filter((f) => !filesBefore.has(f));
  currentRoundSnapshot.modifiedFiles = modifiedFiles;
  state.rounds.push(currentRoundSnapshot);
  reactivateAll(state);
  saveState(state);

  log(`Fixed ${fixedCount} issue(s). Total: ${totalFixed}. Modified ${modifiedFiles.length} file(s). Continuing...`);
}

log("\n=== Loop Complete ===");
saveState(state);

return {
  rounds: round,
  maxRounds: MAX,
  totalFixed,
  clean,
  runDir: RUN_ROOT,
  message: clean
    ? `Code clean after ${round} round(s). ${totalFixed} issue(s) fixed total. State: ${STATE_FILE}`
    : `Stopped after ${round} round(s). ${totalFixed} issue(s) fixed. State: ${STATE_FILE}`,
};
