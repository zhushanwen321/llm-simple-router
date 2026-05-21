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
  ImageIcon,
  FileText,
  Volume2,
  Video,
} from "lucide-vue-next";
import { cn } from "@/lib/utils";

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

// Check if current context window matches a preset option
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

const DEFAULT_TIMEOUT_SECONDS = 300;
const MS_PER_SECOND = 1000;

const displayTimeoutSeconds = computed(() => {
  if (props.streamTimeoutMs !== undefined && props.streamTimeoutMs !== null) {
    return Math.round(props.streamTimeoutMs / MS_PER_SECOND);
  }
  return DEFAULT_TIMEOUT_SECONDS;
});

const isDefaultTimeout = computed(() => props.streamTimeoutMs === undefined);

const toggleableCapabilities = [
  { key: "image" as const, icon: ImageIcon, labelKey: "image" as const },
  { key: "audio" as const, icon: Volume2, labelKey: "audio" as const },
  { key: "video" as const, icon: Video, labelKey: "video" as const },
];
</script>

<template>
  <div
    class="rounded-lg border border-border bg-card px-3 py-2.5 transition-colors"
  >
    <div class="flex items-center gap-2">
      <!-- Model name -->
      <span
        class="truncate text-xs font-medium text-foreground min-w-0 flex-1"
        :title="model.name"
        >{{ model.name }}</span
      >

      <!-- Context window -->
      <div class="flex items-center gap-1 shrink-0">
        <Select
          :model-value="isPreset ? String(model.contextWindow) : '__custom__'"
          @update:model-value="updateContextWindowFromSelect"
        >
          <SelectTrigger class="h-7 w-[72px] text-xs">
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
          class="h-7 w-20 text-xs text-right [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          @update:model-value="updateContextWindowFromInput($event as string)"
        />
      </div>

      <!-- Patch toggle -->
      <Button
        type="button"
        variant="ghost"
        size="sm"
        class="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer select-none shrink-0 h-auto px-1 py-0"
        @click="open = !open"
      >
        <ChevronDown
          :class="
            cn('size-3 transition-transform', open ? 'rotate-0' : '-rotate-90')
          "
        />
        {{ model.patches.length > 0 ? model.patches.length : "" }}
      </Button>

      <!-- Remove -->
      <Button
        variant="ghost"
        size="icon-xs"
        class="text-muted-foreground hover:text-destructive shrink-0"
        @click="$emit('remove')"
      >
        <Trash2 class="size-3" />
      </Button>
    </div>

    <!-- Patch chips (expandable) -->
    <Collapsible v-model:open="open">
      <CollapsibleContent class="pt-1.5">
        <PatchChips
          :api-type="apiType"
          :is-deep-seek="isDeepSeek"
          :is-non-openai-endpoint="isNonOpenaiEndpoint"
          :model-value="model.patches"
          @update:model-value="updatePatches"
        />
      </CollapsibleContent>
    </Collapsible>

    <!-- Timeout row -->
    <div
      v-if="streamTimeoutMs !== undefined || capabilities !== undefined"
      class="flex items-center gap-2 pt-1.5 mt-1.5 border-t border-border/30"
    >
      <Label class="text-xs text-muted-foreground whitespace-nowrap">{{
        t("providers.fields.timeoutLabel")
      }}</Label>
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
          class="h-7 w-20 text-xs text-right [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          min="1"
        />
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
    <div v-if="capabilities" class="flex items-center gap-1.5 pt-1">
      <Badge variant="secondary" class="text-[10px] px-1.5 py-0 h-5 gap-0.5">
        <FileText class="w-2.5 h-2.5" />
        {{ t("providers.capabilities.text") }}
      </Badge>
      <div
        v-for="cap in toggleableCapabilities"
        :key="cap.key"
        class="inline-flex items-center gap-0.5 rounded-md px-1.5 py-0 text-[10px] cursor-pointer transition-colors border h-5"
        :class="
          capabilities.includes(cap.key)
            ? 'bg-primary/10 text-primary border-primary/20'
            : 'bg-transparent text-muted-foreground border-border/50 hover:bg-muted'
        "
        @click="emit('toggle-capability', cap.key)"
      >
        <component :is="cap.icon" class="w-2.5 h-2.5" />
        {{ t(`providers.capabilities.${cap.labelKey}`) }}
      </div>
    </div>
  </div>
</template>
