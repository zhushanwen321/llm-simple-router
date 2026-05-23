<script setup lang="ts">
import { ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import type { ModelConfig } from "./types";
import { CONTEXT_WINDOW_OPTIONS } from "./types";
import { formatContextWindow } from "@/utils/format";
import PatchChips from "./PatchChips.vue";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
  ChevronDown,
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
    class="rounded-lg border border-border bg-card transition-colors"
    :class="open ? 'px-4 py-3' : 'px-4 py-2.5'"
  >
    <!-- Header row: toggle + name + capabilities + context badge + chevron -->
    <div class="flex items-center gap-2.5">
      <!-- Enable toggle -->
      <Switch
        :checked="model.enabled"
        @update:checked="
          emit('update:model', { ...model, enabled: $event as boolean })
        "
        class="shrink-0 scale-75 origin-left"
      />

      <!-- Model name -->
      <span
        class="truncate text-sm font-medium text-foreground min-w-0 font-mono"
        :title="model.name"
        >{{ model.name }}</span
      >

      <!-- Capability icons (collapsed indicators) -->
      <div class="flex items-center gap-1 shrink-0">
        <template v-for="cap in capabilityIcons" :key="cap.key">
          <component
            :is="cap.icon"
            :class="
              cn(
                'size-3.5 transition-colors',
                isCapabilityActive(cap.key)
                  ? 'text-primary'
                  : 'text-muted-foreground/30',
              )
            "
          />
        </template>
      </div>

      <!-- Context window badge -->
      <Badge
        variant="secondary"
        class="shrink-0 text-[10px] px-1.5 py-0 h-5 font-mono tabular-nums"
      >
        {{ formatContextWindow(model.contextWindow) }}
      </Badge>

      <!-- Patch count indicator -->
      <Badge
        v-if="model.patches.length > 0"
        variant="outline"
        class="shrink-0 text-[10px] px-1.5 py-0 h-5 font-normal text-muted-foreground"
      >
        {{ model.patches.length }} patches
      </Badge>

      <!-- Spacer -->
      <div class="flex-1" />

      <!-- Expand chevron -->
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        class="shrink-0 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        @click="open = !open"
      >
        <ChevronDown
          :class="
            cn(
              'size-3.5 transition-transform duration-200',
              open ? 'rotate-0' : '-rotate-90',
            )
          "
        />
      </Button>

      <!-- Remove -->
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        class="shrink-0 text-muted-foreground hover:text-destructive"
        @click="$emit('remove')"
      >
        <Trash2 class="size-3.5" />
      </Button>
    </div>

    <!-- Expanded content -->
    <Collapsible v-model:open="open">
      <CollapsibleContent>
        <div class="pt-3 mt-3 space-y-3 border-t border-border/40">
          <!-- Context window row -->
          <div class="flex items-center gap-2">
            <Label
              class="text-xs text-muted-foreground whitespace-nowrap w-24 shrink-0"
              >{{ t("quickSetup.model.contextWindow") || "Context" }}</Label
            >
            <div class="flex items-center gap-1.5">
              <Select
                :model-value="
                  isPreset ? String(model.contextWindow) : '__custom__'
                "
                @update:model-value="updateContextWindowFromSelect"
              >
                <SelectTrigger class="h-7 w-24 text-xs">
                  <SelectValue>
                    {{
                      isPreset
                        ? matchedOption!.label
                        : formatContextWindow(model.contextWindow)
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    v-for="opt in CONTEXT_WINDOW_OPTIONS"
                    :key="opt.value"
                    :value="String(opt.value)"
                  >
                    {{ opt.label }}
                  </SelectItem>
                  <SelectItem value="__custom__">{{
                    t("quickSetup.model.contextCustom")
                  }}</SelectItem>
                </SelectContent>
              </Select>
              <Input
                v-if="!isPreset"
                :model-value="String(model.contextWindow)"
                type="number"
                min="1"
                class="h-7 w-24 text-xs text-right [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                @update:model-value="
                  updateContextWindowFromInput($event as string)
                "
              />
            </div>
          </div>

          <!-- Timeout row -->
          <div
            v-if="streamTimeoutMs !== undefined"
            class="flex items-center gap-2"
          >
            <Label
              class="text-xs text-muted-foreground whitespace-nowrap w-24 shrink-0"
              >{{ t("providers.fields.timeoutLabel") }}</Label
            >
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
                class="h-7 w-24 text-xs text-right [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                min="1"
              />
              <span class="text-xs text-muted-foreground">s</span>
              <Badge
                v-if="isDefaultTimeout"
                variant="outline"
                class="text-[10px] px-1 py-0 h-5 font-normal text-muted-foreground"
              >
                {{ t("providers.fields.timeoutPlaceholder") }}
              </Badge>
            </div>
          </div>

          <!-- Capabilities row -->
          <div
            v-if="capabilities !== undefined"
            class="flex items-center gap-2"
          >
            <Label
              class="text-xs text-muted-foreground whitespace-nowrap w-24 shrink-0"
              >{{ t("providers.capabilities.label") || "Capabilities" }}</Label
            >
            <div class="flex items-center gap-1.5">
              <!-- Text (always active) -->
              <Badge
                variant="secondary"
                class="text-[10px] px-1.5 py-0 h-5 gap-1"
              >
                <Type class="size-3" />
                {{ t("providers.capabilities.text") }}
              </Badge>
              <!-- Toggleable capabilities -->
              <Badge
                v-for="cap in capabilityIcons.slice(1)"
                :key="cap.key"
                variant="outline"
                :class="
                  cn(
                    'text-[10px] px-1.5 py-0 h-5 gap-1 cursor-pointer transition-colors select-none',
                    capabilities.includes(cap.key)
                      ? 'bg-primary/10 text-primary border-primary/20'
                      : 'text-muted-foreground/40 border-border/50 hover:text-muted-foreground',
                  )
                "
                @click="emit('toggle-capability', cap.key)"
              >
                <component :is="cap.icon" class="size-3" />
                {{ t(`providers.capabilities.${cap.label}`) }}
              </Badge>
            </div>
          </div>

          <!-- Patch chips -->
          <PatchChips
            :api-type="apiType"
            :is-deep-seek="isDeepSeek"
            :is-non-openai-endpoint="isNonOpenaiEndpoint"
            :model-value="model.patches"
            @update:model-value="updatePatches"
          />
        </div>
      </CollapsibleContent>
    </Collapsible>
  </div>
</template>
