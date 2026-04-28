/**
 * DeepSeek Anthropic API 补丁方案测试
 *
 * 测试各种修补策略是否被 DeepSeek 接受，以及是否会影响 tool_use 行为。
 *
 * 使用方法: node scripts/test-deepseek-patch.mjs
 */

const API_BASE = "https://api.deepseek.com/anthropic";
const API_KEY = process.env.DEEPSEEK_API_KEY;
if (!API_KEY) {
  console.error("请设置 DEEPSEEK_API_KEY 环境变量");
  process.exit(1);
}

const MODEL = "deepseek-chat";

async function callDeepSeek(body, label) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`[测试] ${label}`);
  console.log(`${"=".repeat(60)}`);

  // 打印请求体摘要
  const bodyStr = JSON.stringify(body);
  console.log(`请求体大小: ${bodyStr.length} bytes`);
  console.log(`messages 数量: ${body.messages?.length ?? 0}`);

  // 检查 thinking 状态
  const thinkingMsgs = (body.messages || []).filter(m =>
    m.role === "assistant" && Array.isArray(m.content) &&
    m.content.some(b => b?.type === "thinking")
  );
  const toolUseMsgs = (body.messages || []).filter(m =>
    m.role === "assistant" && Array.isArray(m.content) &&
    m.content.some(b => b?.type === "tool_use")
  );
  const redactedMsgs = (body.messages || []).filter(m =>
    m.role === "assistant" && Array.isArray(m.content) &&
    m.content.some(b => b?.type === "redacted_thinking")
  );
  console.log(`含 thinking 的 assistant 消息: ${thinkingMsgs.length}`);
  console.log(`含 tool_use 的 assistant 消息: ${toolUseMsgs.length}`);
  console.log(`含 redacted_thinking 的 assistant 消息: ${redactedMsgs.length}`);
  console.log(`body.thinking: ${JSON.stringify(body.thinking)}`);

  try {
    const resp = await fetch(`${API_BASE}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: bodyStr,
    });

    const status = resp.status;
    const respBody = await resp.text();
    let parsed;
    try { parsed = JSON.parse(respBody); } catch { parsed = respBody; }

    console.log(`状态码: ${status}`);

    if (status === 200 && parsed && parsed.content) {
      const types = parsed.content.map(b => b?.type || "unknown");
      console.log(`响应 content types: [${types.join(", ")}]`);

      // 检查是否有 tool_use
      const toolUses = parsed.content.filter(b => b?.type === "tool_use");
      if (toolUses.length > 0) {
        console.log(`工具调用: ${toolUses.map(t => `${t.name}(id=${t.id})`).join(", ")}`);
      }

      // 检查是否有 thinking
      const thinking = parsed.content.filter(b => b?.type === "thinking");
      if (thinking.length > 0) {
        console.log(`thinking 块: ${thinking.length} 个, signature 长度: ${thinking.map(t => t.signature?.length || 0).join(", ")}`);
      }

      console.log(`stop_reason: ${parsed.stop_reason}`);
      console.log(`✅ 成功: ${types.join(" + ")}`);
    } else if (status !== 200) {
      const errorInfo = typeof parsed === "object" ? JSON.stringify(parsed).substring(0, 300) : String(parsed).substring(0, 300);
      console.log(`❌ 错误: ${errorInfo}`);
    } else {
      console.log(`⚠️ 非预期响应: ${respBody.substring(0, 200)}`);
    }

    return { status, body: parsed, rawBody: respBody };
  } catch (e) {
    console.log(`❌ 网络错误: ${e.message}`);
    return { status: 0, error: e.message };
  }
}

// ============================================================
// 测试场景
// ============================================================

const TOOL_DEF = [{
  name: "get_weather",
  description: "获取指定城市的天气信息",
  input_schema: {
    type: "object",
    properties: {
      city: { type: "string", description: "城市名称" }
    },
    required: ["city"]
  }
}];

// --- 场景 1: 基线 --- 不带 thinking，普通对话
async function testBaseline() {
  const body = {
    model: MODEL,
    max_tokens: 200,
    messages: [
      { role: "user", content: "你好，请用一句话介绍自己。" }
    ]
  };
  await callDeepSeek(body, "基线：无 thinking，简单对话");
}

// --- 场景 2: thinking enabled，简单对话 ---
async function testThinkingEnabled() {
  const body = {
    model: MODEL,
    max_tokens: 200,
    thinking: { type: "enabled", budget_tokens: 1000 },
    messages: [
      { role: "user", content: "1+1等于几？直接回答数字即可。" }
    ]
  };
  await callDeepSeek(body, "thinking enabled，简单对话");
}

// --- 场景 3: 历史中一条 assistant 消息缺 thinking（纯文本），补丁插入空 thinking ---
async function testPatchEmptyThinkingTextOnly() {
  const body = {
    model: MODEL,
    max_tokens: 200,
    thinking: { type: "enabled", budget_tokens: 1000 },
    messages: [
      { role: "user", content: "hi" },
      // 模拟 GLM 回复：缺 thinking block 的纯文本 assistant
      { role: "assistant", content: [
        { type: "thinking", thinking: "", signature: "" },  // 补丁插入的空 thinking
        { type: "text", text: "你好！有什么可以帮助你的？" }
      ]},
      { role: "user", content: "讲个笑话，要短。" }
    ]
  };
  await callDeepSeek(body, "方案1-空thinking：纯文本消息加空 thinking block");
}

// --- 场景 4: 历史中一条 assistant 消息缺 thinking 且含 tool_use，补丁插入空 thinking ---
async function testPatchEmptyThinkingWithToolUse() {
  const body = {
    model: MODEL,
    max_tokens: 200,
    thinking: { type: "enabled", budget_tokens: 1000 },
    tools: TOOL_DEF,
    messages: [
      { role: "user", content: "北京天气怎么样？" },
      // 模拟有 tool_use 但缺 thinking 的消息（补丁插入空 thinking）
      { role: "assistant", content: [
        { type: "thinking", thinking: "", signature: "" },  // 补丁插入的空 thinking
        { type: "tool_use", id: "test_call_1", name: "get_weather", input: { city: "北京" } }
      ]},
      { role: "user", content: [
        { type: "tool_result", tool_use_id: "test_call_1", content: "北京：晴，25°C" }
      ]},
      { role: "assistant", content: "北京现在是晴天，温度 25°C。" }
    ]
  };
  await callDeepSeek(body, "方案1-空thinking(含tool_use)：含 tool_use 消息加空 thinking——这是导致循环的场景");
}

// --- 场景 5: 使用 redacted_thinking 替代空 thinking ---
async function testRedactedThinking() {
  const body = {
    model: MODEL,
    max_tokens: 200,
    thinking: { type: "enabled", budget_tokens: 1000 },
    messages: [
      { role: "user", content: "hi" },
      // 用 redacted_thinking 替代空 thinking
      { role: "assistant", content: [
        { type: "redacted_thinking", data: "" },
        { type: "text", text: "你好！有什么可以帮助你的？" }
      ]},
      { role: "user", content: "1+1等于几？直接回答。" }
    ]
  };
  await callDeepSeek(body, "方案3-redacted_thinking：纯文本消息用 redacted_thinking");
}

// --- 场景 6: redacted_thinking + tool_use ---
async function testRedactedThinkingWithToolUse() {
  const body = {
    model: MODEL,
    max_tokens: 200,
    thinking: { type: "enabled", budget_tokens: 1000 },
    tools: TOOL_DEF,
    messages: [
      { role: "user", content: "上海天气怎么样？" },
      { role: "assistant", content: [
        { type: "redacted_thinking", data: "" },
        { type: "tool_use", id: "test_call_2", name: "get_weather", input: { city: "上海" } }
      ]},
      { role: "user", content: [
        { type: "tool_result", tool_use_id: "test_call_2", content: "上海：多云，28°C" }
      ]},
      { role: "assistant", content: "上海现在是多云，温度 28°C。" }
    ]
  };
  await callDeepSeek(body, "方案3-redacted_thinking(含tool_use)：tool_use 消息用 redacted_thinking");
}

// --- 场景 7: 跳过 tool_use 消息（当前修复）—— tool_use 消息不加 thinking ---
async function testSkipToolUse() {
  const body = {
    model: MODEL,
    max_tokens: 200,
    thinking: { type: "enabled", budget_tokens: 1000 },
    tools: TOOL_DEF,
    messages: [
      { role: "user", content: "广州天气怎么样？" },
      // tool_use 消息不加 thinking（方案 2）
      { role: "assistant", content: [
        { type: "tool_use", id: "test_call_3", name: "get_weather", input: { city: "广州" } }
      ]},
      { role: "user", content: [
        { type: "tool_result", tool_use_id: "test_call_3", content: "广州：雨，22°C" }
      ]},
      { role: "assistant", content: "广州现在下雨，温度 22°C。" }
    ]
  };
  await callDeepSeek(body, "方案2-跳过tool_use：tool_use 消息不加 thinking（当前修复）");
}

// --- 场景 8: 全剥离 thinking（方案 6）---
async function testStripAllThinking() {
  // 构造一个原本带 thinking 的历史，然后全剥离
  const body = {
    model: MODEL,
    max_tokens: 200,
    // 注意：不传 thinking 参数
    messages: [
      { role: "user", content: "1+1等于几？" },
      // 原本带 thinking 的消息，剥离后只留 text
      { role: "assistant", content: "答案是2。" }
    ]
  };
  await callDeepSeek(body, "方案6-全剥离thinking：不传 thinking，历史无 thinking block");
}

// --- 场景 9: 验证 DeepSeek 对缺 thinking 的校验 ---
async function testMissingThinkingValidation() {
  const body = {
    model: MODEL,
    max_tokens: 200,
    thinking: { type: "enabled", budget_tokens: 1000 },
    messages: [
      { role: "user", content: "hi" },
      // 故意不加 thinking block（模拟原始 GLM 消息）
      { role: "assistant", content: [
        { type: "text", text: "你好！有什么可以帮助你的？" }
      ]},
      { role: "user", content: "简短回复：1+1等于几？" }
    ]
  };
  await callDeepSeek(body, "校验测试：thinking enabled 但历史 assistant 缺 thinking——会 400 吗？");
}

// --- 场景 10: 多轮混合：有的消息有 thinking，tool_use 消息没有 ---
async function testMixedHistoryToolUseWithoutThinking() {
  const body = {
    model: MODEL,
    max_tokens: 200,
    thinking: { type: "enabled", budget_tokens: 1000 },
    tools: TOOL_DEF,
    messages: [
      { role: "user", content: "深圳天气怎么样？" },
      // 这条消息有 thinking（DeepSeek 正常回复）
      { role: "assistant", content: [
        { type: "thinking", thinking: "用户想知道深圳天气，我需要调用get_weather工具。", signature: "fake_sig_deepseek_1" },
        { type: "tool_use", id: "call_real_1", name: "get_weather", input: { city: "深圳" } }
      ]},
      { role: "user", content: [
        { type: "tool_result", tool_use_id: "call_real_1", content: "深圳：晴，30°C" }
      ]},
      // 这条消息缺 thinking（模拟 GLM 或 DeepSeek bug）
      { role: "assistant", content: [
        { type: "tool_use", id: "call_real_2", name: "get_weather", input: { city: "杭州" } }
      ]},
      { role: "user", content: [
        { type: "tool_result", tool_use_id: "call_real_2", content: "杭州：阴，18°C" }
      ]},
      { role: "assistant", content: "深圳是晴天30°C，杭州是阴天18°C。" }
    ]
  };
  await callDeepSeek(body, "校验测试：混合历史中 tool_use 消息缺 thinking——会 400 吗？");
}

// ============================================================
// 执行
// ============================================================

async function main() {
  console.log("DeepSeek Anthropic API 补丁方案测试");
  console.log(`API: ${API_BASE}`);
  console.log(`Model: ${MODEL}`);
  console.log(`API Key: ${API_KEY.substring(0, 8)}...`);

  const results = [];

  // 按顺序执行
  results.push(["基线-无thinking", await testBaseline()]);
  results.push(["thinking enabled", await testThinkingEnabled()]);
  results.push(["校验-缺thinking", await testMissingThinkingValidation()]);
  results.push(["方案1-空thinking(纯文本)", await testPatchEmptyThinkingTextOnly()]);
  results.push(["方案1-空thinking(含tool_use)", await testPatchEmptyThinkingWithToolUse()]);
  results.push(["方案3-redacted_thinking(纯文本)", await testRedactedThinking()]);
  results.push(["方案3-redacted_thinking(含tool_use)", await testRedactedThinkingWithToolUse()]);
  results.push(["方案2-跳过tool_use", await testSkipToolUse()]);
  results.push(["方案6-全剥离thinking", await testStripAllThinking()]);
  results.push(["校验-混合历史tool_use缺thinking", await testMixedHistoryToolUseWithoutThinking()]);

  // 汇总
  console.log(`\n\n${"=".repeat(60)}`);
  console.log("汇总结果");
  console.log(`${"=".repeat(60)}`);
  for (const [name, result] of results) {
    const icon = result.status === 200 ? "✅" : "❌";
    console.log(`${icon} ${name} (HTTP ${result.status})`);
  }
}

main().catch(console.error);
