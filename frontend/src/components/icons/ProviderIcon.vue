<script setup lang="ts">
import { computed, type Component } from "vue";
import { isDark } from "@/composables/useTheme";

// ===== Brand-color icons (no theme switching needed) =====
import DeepseekIcon from "@/assets/icons/deepseek.svg?component";
import ZhipuIcon from "@/assets/icons/zhipu.svg?component";
import KimiIcon from "@/assets/icons/kimi.svg?component";
import QwenIcon from "@/assets/icons/qwen.svg?component";
import BaiduIcon from "@/assets/icons/baidu.svg?component";
import IflytekIcon from "@/assets/icons/iflytek.svg?component";
import SiliconcloudIcon from "@/assets/icons/siliconcloud.svg?component";
import StepfunIcon from "@/assets/icons/stepfun.svg?component";
import TencentcloudIcon from "@/assets/icons/tencentcloud.svg?component";
import VolcengineIcon from "@/assets/icons/volcengine.svg?component";
import MinimaxIcon from "@/assets/icons/minimax.svg?component";
import AlibabaIcon from "@/assets/icons/alibaba.svg?component";
import ClaudeIcon from "@/assets/icons/claude.svg?component";
import CodexIcon from "@/assets/icons/codex.svg?component";

// ===== Monochrome icons — light versions =====
import MoonshotIcon from "@/assets/icons/moonshot.svg?component";
import OpencodeIcon from "@/assets/icons/opencode.svg?component";
import OpenaiLight from "@/assets/icons/openai.svg?component";
import AnthropicLight from "@/assets/icons/anthropic.svg?component";
import PiLight from "@/assets/icons/pi.svg?component";

// ===== Monochrome icons — dark versions (white fill) =====
import MoonshotDark from "@/assets/icons/moonshot-dark.svg?component";
import OpencodeDark from "@/assets/icons/opencode-dark.svg?component";
import OpenaiDark from "@/assets/icons/openai-dark.svg?component";
import AnthropicDark from "@/assets/icons/anthropic-dark.svg?component";
import PiDark from "@/assets/icons/pi-dark.svg?component";

const BRAND_ICON_MAP: Record<string, Component> = {
  deepseek: DeepseekIcon,
  zhipu: ZhipuIcon,
  kimi: KimiIcon,
  qwen: QwenIcon,
  baidu: BaiduIcon,
  iflytek: IflytekIcon,
  siliconcloud: SiliconcloudIcon,
  stepfun: StepfunIcon,
  tencentcloud: TencentcloudIcon,
  volcengine: VolcengineIcon,
  minimax: MinimaxIcon,
  alibaba: AlibabaIcon,
  claude: ClaudeIcon,
  codex: CodexIcon,
};

const MONOCHROME_LIGHT_MAP: Record<string, Component> = {
  moonshot: MoonshotIcon,
  opencode: OpencodeIcon,
  openai: OpenaiLight,
  anthropic: AnthropicLight,
  pi: PiLight,
};

const MONOCHROME_DARK_MAP: Record<string, Component> = {
  moonshot: MoonshotDark,
  opencode: OpencodeDark,
  openai: OpenaiDark,
  anthropic: AnthropicDark,
  pi: PiDark,
};

const props = withDefaults(
  defineProps<{
    name: string;
    size?: number;
  }>(),
  { size: 20 },
);

const iconComponent = computed(() => {
  const key = props.name.toLowerCase();

  // Brand-color icons — always use the same version
  if (BRAND_ICON_MAP[key]) return BRAND_ICON_MAP[key];

  // Monochrome icons — switch between light/dark
  if (isDark.value && MONOCHROME_DARK_MAP[key]) {
    return MONOCHROME_DARK_MAP[key];
  }
  if (MONOCHROME_LIGHT_MAP[key]) return MONOCHROME_LIGHT_MAP[key];

  return undefined;
});

const fallbackLetter = computed(() => props.name.charAt(0).toUpperCase());
</script>

<template>
  <component
    v-if="iconComponent"
    :is="iconComponent"
    class="shrink-0"
    :style="{ width: `${size}px`, height: `${size}px` }"
  />
  <span
    v-else
    class="inline-flex items-center justify-center shrink-0 font-bold text-muted-foreground"
    :style="{
      width: `${size}px`,
      height: `${size}px`,
      fontSize: `${size * 0.5}px`,
    }"
  >
    {{ fallbackLetter }}
  </span>
</template>
