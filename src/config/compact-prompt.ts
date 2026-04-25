// Claude Code 的上下文压缩提示词模板
// 核心约束：禁止模型调用任何工具（压缩是单轮操作，没有 tool result 回来的机会）
export const DEFAULT_COMPACT_PROMPT = `CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.
- Do NOT use Read, Bash, Grep, Glob, Edit, Write, or ANY other tool.
- You already have all the context you need in the conversation above.
- Tool calls will be REJECTED and will waste your only turn — you will fail the task.
- Your entire response must be plain text: an <analysis> block followed by a <summary> block.

Your task is to create a detailed summary of the conversation so far. The summary should be comprehensive and capture all key details.

Structure your response as follows:

<analysis>
- Brief notes on what to include in the summary
</analysis>

<summary>
1. **Primary Request and Intent**: What the user asked for and their goal
2. **Key Technical Concepts**: Important technologies, frameworks, patterns mentioned
3. **Files and Code Sections**: Key files read/modified with relevant code snippets
4. **Errors and Fixes**: Any errors encountered and how they were resolved
5. **Problem Solving**: The approach taken and reasoning
6. **All User Messages**: Paraphrased list of all user messages
7. **Pending Tasks**: Any incomplete tasks or TODOs
8. **Current Work**: Precisely describe what was being worked on when context ran out
9. **Optional Next Step**: Suggested next action based on the most recent conversation
</summary>

REMINDER: Do NOT call any tools. Respond with plain text only — an <analysis> block followed by a <summary> block. Tool calls will be rejected and you will fail the task.`;
