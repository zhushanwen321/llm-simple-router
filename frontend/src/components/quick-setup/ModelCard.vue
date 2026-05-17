<script setup lang="ts">
import { ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import type { ModelConfig } from "./types";
import { CONTEXT_WINDOW_OPTIONS } from "./types";
import PatchChips from "./PatchChips.vue";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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

const CONTEXT_MILLION = 1_000_000;
const CONTEXT_THOUSAND = 1_000;

function formatCw(n: number): string {
  if (n >= CONTEXT_MILLION) return `${n / CONTEXT_MILLION}M`;
  if (n >= CONTEXT_THOUSAND) return `${n / CONTEXT_THOUSAND}K`;
  return `${n}`;
}
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
                isPreset ? matchedOption!.label : formatCw(model.contextWindow)
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

    <!-- Timeout + Capabilities row -->
    <div
      v-if="streamTimeoutMs !== undefined || capabilities !== undefined"
      class="flex items-center gap-3 pt-1.5 mt-1.5 border-t border-border/30"
    >
      <div
        v-if="streamTimeoutMs !== undefined"
        class="flex items-center gap-1.5"
      >
        <Label class="text-xs text-muted-foreground whitespace-nowrap">{{
          t("providers.fields.timeoutLabel")
        }}</Label>
        <Input
          type="number"
          :model-value="
            streamTimeoutMs ? Math.round(streamTimeoutMs / 1000) : ''
          "
          @update:model-value="
            emit(
              'update:stream-timeout-ms',
              $event ? Number($event) * 1000 : undefined,
            )
          "
          :placeholder="t('providers.fields.timeoutPlaceholder')"
          class="h-7 text-xs"
          min="1"
        />
      </div>
      <div v-if="capabilities" class="flex items-center gap-2">
        <Badge variant="secondary" class="text-[10px] px-1.5 py-0 gap-0.5">
          <FileText class="w-2.5 h-2.5" />
          {{ t("providers.capabilities.text") }}
        </Badge>
        <Label class="flex items-center gap-1.5 cursor-pointer">
          <Checkbox
            :checked="capabilities.includes('image')"
            @update:checked="emit('toggle-capability', 'image')"
          />
          <span
            class="text-[10px] text-muted-foreground flex items-center gap-0.5"
          >
            <ImageIcon class="w-2.5 h-2.5" />
            {{ t("providers.capabilities.image") }}
          </span>
        </Label>
        <Label class="flex items-center gap-1.5 cursor-pointer">
          <Checkbox
            :checked="capabilities.includes('audio')"
            @update:checked="emit('toggle-capability', 'audio')"
          />
          <span
            class="text-[10px] text-muted-foreground flex items-center gap-0.5"
          >
            <Volume2 class="w-2.5 h-2.5" />
            {{ t("providers.capabilities.audio") }}
          </span>
        </Label>
        <Label class="flex items-center gap-1.5 cursor-pointer">
          <Checkbox
            :checked="capabilities.includes('video')"
            @update:checked="emit('toggle-capability', 'video')"
          />
          <span
            class="text-[10px] text-muted-foreground flex items-center gap-0.5"
          >
            <Video class="w-2.5 h-2.5" />
            {{ t("providers.capabilities.video") }}
          </span>
        </Label>
      </div>
    </div>
  </div>
</template>
