export interface ProviderPreset {
  plan: string
  presetName: string
  apiType: 'openai' | 'anthropic'
  baseUrl: string
  models: string[]
}

export interface ProviderGroup {
  group: string
  presets: ProviderPreset[]
}

/**
 * 国内 LLM 供应商预设配置。
 *
 * base_url 约定：router 拼接 {base_url}/v1/chat/completions (OpenAI) 或
 * {base_url}/v1/messages (Anthropic)。
 * Coding Plan 端点通常只兼容 Anthropic 协议，apiType 需设为 'anthropic'。
 */
export const PROVIDER_PRESETS: ProviderGroup[] = [
  {
    group: '智谱',
    presets: [
      {
        plan: '标准',
        presetName: '智谱',
        apiType: 'openai',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        models: ['glm-5.1', 'glm-5', 'glm-5-turbo', 'glm-4.7', 'glm-4.7-flash', 'glm-4.6'],
      },
      {
        plan: 'Coding Plan',
        presetName: '智谱 Coding Plan',
        apiType: 'anthropic',
        baseUrl: 'https://open.bigmodel.cn/api/anthropic',
        models: ['glm-5.1', 'glm-5-turbo', 'glm-4.7', 'glm-4.5-air'],
      },
    ],
  },
  {
    group: 'KIMI',
    presets: [
      {
        plan: '标准',
        presetName: 'KIMI',
        apiType: 'openai',
        baseUrl: 'https://api.moonshot.cn',
        models: ['kimi-k2.5', 'kimi-k2-0905-preview', 'kimi-k2-turbo-preview', 'kimi-k2-thinking', 'kimi-k2-thinking-turbo', 'moonshot-v1-128k'],
      },
      {
        plan: 'Coding Plan',
        presetName: 'KIMI Coding Plan',
        apiType: 'anthropic',
        baseUrl: 'https://api.kimi.com/coding',
        models: ['kimi-for-coding', 'kimi-k2.5'],
      },
    ],
  },
  {
    group: 'Minimax',
    presets: [
      {
        plan: '标准',
        presetName: 'Minimax',
        apiType: 'openai',
        baseUrl: 'https://api.minimax.chat',
        models: ['MiniMax-M2.7', 'MiniMax-M2.7-highspeed', 'MiniMax-M2.5', 'MiniMax-M2.5-highspeed', 'MiniMax-M2.1', 'MiniMax-M2'],
      },
      {
        plan: 'Token Plan',
        presetName: 'Minimax Token Plan',
        apiType: 'anthropic',
        baseUrl: 'https://api.minimaxi.com/anthropic',
        models: ['MiniMax-M2.7'],
      },
    ],
  },
  {
    group: '火山引擎',
    presets: [
      {
        plan: '标准',
        presetName: '火山引擎',
        apiType: 'openai',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
        models: ['doubao-seed-2-0-pro-260215', 'doubao-seed-1-8-251228', 'doubao-seed-code-preview-251028'],
      },
      {
        plan: 'Coding Plan',
        presetName: '火山引擎 Coding Plan',
        apiType: 'anthropic',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/compatible',
        models: ['ark-code-latest', 'doubao-seed-2.0-code', 'kimi-k2.5', 'glm-4.7', 'deepseek-v3.2'],
      },
    ],
  },
  {
    group: '阿里云',
    presets: [
      {
        plan: '标准',
        presetName: '阿里云百炼',
        apiType: 'openai',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode',
        models: ['qwen3.6-plus', 'qwen3.5-plus', 'qwen3-max', 'qwen3.5-flash', 'qwen3-coder-plus', 'qwen3-coder-next'],
      },
      {
        plan: 'Coding Plan',
        presetName: '阿里云 Coding Plan',
        apiType: 'anthropic',
        baseUrl: 'https://coding.dashscope.aliyuncs.com/apps/anthropic',
        models: ['qwen3.6-plus', 'qwen3-coder-next', 'qwen3-coder-plus', 'kimi-k2.5', 'glm-5', 'MiniMax-M2.5'],
      },
    ],
  },
  {
    group: '腾讯云',
    presets: [
      {
        plan: '标准',
        presetName: '腾讯云混元',
        apiType: 'openai',
        baseUrl: 'https://api.hunyuan.cloud.tencent.com',
        models: ['hunyuan-2.0-thinking', 'hunyuan-2.0-instruct', 'hunyuan-t1-latest', 'hunyuan-a13b', 'hunyuan-turbos-latest'],
      },
      {
        plan: 'Coding Plan',
        presetName: '腾讯云 Coding Plan',
        apiType: 'anthropic',
        baseUrl: 'https://api.lkeap.cloud.tencent.com/coding/anthropic',
        models: ['tc-code-latest', 'hunyuan-2.0-instruct', 'hunyuan-2.0-thinking', 'hunyuan-turbos', 'hunyuan-t1', 'glm-5', 'kimi-k2.5'],
      },
    ],
  },
  {
    group: '阶跃星辰',
    presets: [
      {
        plan: '标准',
        presetName: '阶跃星辰',
        apiType: 'openai',
        baseUrl: 'https://api.stepfun.com',
        models: ['step-3.5-flash', 'step-3', 'step-2-mini', 'step-2-16k', 'step-1-8k', 'step-1-32k'],
      },
      {
        plan: 'Step Plan',
        presetName: '阶跃星辰 Step Plan',
        apiType: 'anthropic',
        baseUrl: 'https://api.stepfun.com/step_plan',
        models: ['step-3.5-flash-2603', 'step-3.5-flash'],
      },
    ],
  },
]
