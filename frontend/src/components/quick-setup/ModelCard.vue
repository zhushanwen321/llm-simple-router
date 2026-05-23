<script setup lang="ts">
import { ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import type { ModelConfig } from "./types";
import { CONTEXT_WINDOW_OPTIONS } from "./types";
import PatchChips from "./PatchChips.vue";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import {
  Trash2,
  Type,
  ImageIcon,
  Volume2,
  Video,
} from "lucide-vue-next";
import { cn } from "@/lib/utils";
import { DEFAULT_STREAM_TIMEOUT_MS } from "@/constants";

const MS_PER_SECOND = 1000;
const DEFAULT_TIMEOUT_SECONDS = DEFAULT_STREAM_TIMEOUT_MS / MS_PER_SECOND;

const { t } = useI18n();

const props = defineProps<{
  model: ModelConfig;
  apiType: string;
  isDeepSeek: boolean;
  isNonOpenaiEndpoint: boolean;
  streamTimeoutMs?: number;
  capabilities?: string[];
}>();

const emit = defineEmits<{
  "update:model": [value: ModelConfig];
  remove: [];
  "update:stream-timeout-ms": [value: number | undefined];
  "toggle-capability": [capability: string];
}>();

const open = ref(false);

const matchedOption = computed(() =>
  CONTEXT_WINDOW_OPTIONS.find((o) => o.value === props.model.contextWindow),
);

const isPreset = computed(() => !!matchedOption.value);

function updateContextWindowFromSelect(val: unknown) {
  const str = val as string;
  if (str === "__custom__") return;
  const num = parseInt(str, 10);
  if (!isNaN(num)) {
    emit("update:model", { ...props.model, contextWindow: num });
  }
}

function updateContextWindowFromInput(val: string) {
  const num = parseInt(val, 10);
  if (!isNaN(num) && num > 0) {
    emit("update:model", { ...props.model, contextWindow: num });
  }
}

function updatePatches(patches: string[]) {
  emit("update:model", { ...props.model, patches });
}

const displayTimeoutSeconds = computed(() => {
  if (props.streamTimeoutMs !== undefined && props.streamTimeoutMs !== null) {
    return Math.round(props.streamTimeoutMs / MS_PER_SECOND);
  }
  return DEFAULT_TIMEOUT_SECONDS;
});

const isDefaultTimeout = computed(() => props.streamTimeoutMs === undefined);

const capabilityIcons = [
  { key: "text", icon: Type, label: "text" },
  { key: "image", icon: ImageIcon, label: "image" },
  { key: "audio", icon: Volume2, label: "audio" },
  { key: "video", icon: Video, label: "video" },
] as const;

function isCapabilityActive(key: string): boolean {
  if (key === "text") return true;
  return props.capabilities?.includes(key) ?? false;
}
</script>

<template>
  <div
    class="rounded-lg border border-border bg-card transition-colors group"
    :class="!model.enabled && 'opacity-40'"
  >
    <!-- Main row: toggle + name + ctx select + cap squares + patch btn + trash -->
    <div class="flex items-center gap-2.5 px-3 min-h-8 py-1.5">
      <!-- Enable toggle -->
      <Switch
        :model-value="model.enabled"
        @update:model-value="
          emit('update:model', { ...model, enabled: $event as boolean })
        "
        class="shrink-0 scale-75 origin-left"
      />

      <!-- Model name: demo 12px mono 500 -->
      <span
        class="truncate text-xs font-medium text-foreground min-w-[160px] max-w-[280px] font-mono"
        :title="model.name"
      >{{ model.name }}</span>

      <!-- Context window: inline select (demo: 64px mono 11px) -->
      <Select
        v-if="isPreset"
        :model-value="String(model.contextWindow)"
        @update:model-value="updateContextWindowFromSelect"
      >
        <SelectTrigger class="h-6 w-16 text-[11px] font-mono px-1 gap-0">
          <SelectValue>{{ matchedOption!.label }}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem
            v-for="opt in CONTEXT_WINDOW_OPTIONS"
            :key="opt.value"
            :value="String(opt.value)"
          >{{ opt.label }}</SelectItem>
          <SelectItem value="__custom__">{{
            t("quickSetup.model.contextCustom")
          }}</SelectItem>
        </SelectContent>
      </Select>
      <template v-else>
        <Input
          :model-value="String(model.contextWindow)"
          type="number"
          min="1"
          class="h-6 w-16 text-[11px] text-center font-mono [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          @update:model-value="updateContextWindowFromInput($event as string)"
        />
      </template>

      <!-- Capability squares (demo: 20x20 bordered clickable dots) -->
      <div v-if="capabilities !== undefined" class="flex items-center gap-0.5 shrink-0">
        <div
          v-for="cap in capabilityIcons"
          :key="cap.key"
          class="w-5 h-5 rounded flex items-center justify-center border transition-colors cursor-pointer"
          :class="
            cn(
              isCapabilityActive(cap.key)
                ? 'bg-primary/10 border-primary/30 text-primary'
                : 'border-border text-muted-foreground/40 hover:text-muted-foreground',
            )
          "
          :title="cap.label"
          @click="cap.key !== 'text' && emit('toggle-capability', cap.key)"
        >
          <component :is="cap.icon" class="size-[11px]" />
        </div>
      </div>

      <!-- Patch button: count + chevron, also toggles expand -->
      <div
        class="inline-flex items-center gap-1 h-[22px] px-2 border rounded cursor-pointer transition-colors shrink-0 select-none"
        :class="
          cn(
            model.patches.length > 0
              ? 'bg-primary/10 border-primary/25 text-primary'
              : 'border-border text-muted-foreground hover:border-foreground/20 hover:text-foreground',
          )
        "
        @click="open = !open"
      >
        <span class="text-[11px]">{{ model.patches.length }} patches</span>
        <span
          class="text-[8px] inline-block transition-transform"
          :class="open ? 'rotate-90' : ''"
        >&#9654;</span>
      </div>

      <!-- Trash: hover-only -->
      <div
        class="shrink-0 w-5 h-5 flex items-center justify-center text-muted-foreground opacity-0 group-hover:opacity-100 transition-all cursor-pointer hover:text-destructive"
        @click="$emit('remove')"
      >
        <Trash2 class="size-3" />
      </div>
    </div>

    <!-- Expanded detail -->
    <Collapsible v-model:open="open">
      <CollapsibleContent>
        <div class="pl-9 pr-3 py-2 border-t border-border space-y-2">
          <!-- Patches -->
          <div>
            <div class="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1">
              Patches
            </div>
            <PatchChips
              :api-type="apiType"
              :is-deep-seek="isDeepSeek"
              :is-non-openai-endpoint="isNonOpenaiEndpoint"
              :model-value="model.patches"
              @update:model-value="updatePatches"
            />
          </div>

          <!-- Timeout -->
          <div v-if="streamTimeoutMs !== undefined">
            <div class="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1">
              Timeout
            </div>
            <div class="flex items-center gap-1.5">
              <Input
                type="number"
                :model-value="displayTimeoutSeconds"
                @update:model-value="
                  emit(
                    'update:stream-timeout-ms',
                    $event ? Number($event) * MS_PER_SECOND : undefined,
                  )
                "
                class="h-6 w-20 text-xs text-right [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                min="1"
              />
              <span class="text-xs text-muted-foreground">seconds</span>
              <Badge
                v-if="isDefaultTimeout"
                variant="outline"
                class="text-[9px] px-1 py-0 h-4 font-normal text-muted-foreground"
              >
                {{ t("providers.fields.timeoutPlaceholder") }}
              </Badge>
            </div>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  </div>
</template>
