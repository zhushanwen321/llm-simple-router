<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Plus, Grid3x3 } from "lucide-vue-next";
import MappingEntryEditor from "@/components/mappings/MappingEntryEditor.vue";
import CascadingModelSelect from "@/components/mappings/CascadingModelSelect.vue";
import type {
  MappingTarget,
  MappingEntry,
  MultimodalFallback,
} from "@/components/quick-setup/types";
import type {
  ProviderGroup,
  SelectedValue,
} from "@/components/mappings/cascading-types";

const { t } = useI18n();

defineProps<{
  entries: MappingEntry[];
  providerGroups: ProviderGroup[];
}>();

const emit = defineEmits<{
  "update:targets": [index: number, targets: MappingTarget[]];
  "update:multimodal-fallback": [
    index: number,
    fallback: MultimodalFallback | undefined,
  ];
  "update:client-model": [index: number, clientModel: string];
  "toggle-active": [index: number];
  add: [
    clientModel: string,
    targetModel: string,
    multimodalFallback?: MultimodalFallback,
  ];
  remove: [clientModel: string];
}>();

// Allow only one expanded entry at a time
const expandedClient = ref<string | null>(null);

function toggleExpand(clientModel: string) {
  expandedClient.value =
    expandedClient.value === clientModel ? null : clientModel;
}

const newFrom = ref("");
const newToValue = ref<SelectedValue | undefined>();
const newMultimodalValue = ref<SelectedValue | undefined>();
const showMultimodal = ref(false);

function canAdd(): boolean {
  return newFrom.value.trim().length > 0 && !!newToValue.value?.model;
}

function buildMultimodalFallback(): MultimodalFallback | undefined {
  if (!showMultimodal.value || !newMultimodalValue.value?.model)
    return undefined;
  return {
    provider_id: newMultimodalValue.value.provider_id,
    backend_model: newMultimodalValue.value.model,
  };
}

function addMapping() {
  const from = newFrom.value.trim();
  const to = newToValue.value;
  if (from && to) {
    emit("add", from, to.model, buildMultimodalFallback());
    newFrom.value = "";
    newToValue.value = undefined;
    newMultimodalValue.value = undefined;
    showMultimodal.value = false;
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === "Enter" && canAdd()) {
    e.preventDefault();
    addMapping();
  }
}
</script>

<template>
  <div class="space-y-1.5">
    <div
      v-for="(entry, idx) in entries"
      :key="idx"
      class="rounded-md border border-border overflow-hidden"
    >
      <div class="px-3 py-1.5">
        <MappingEntryEditor
          :entry="entry"
          :provider-groups="providerGroups"
          :expanded="expandedClient === entry.clientModel"
          :editable-client-model="expandedClient === entry.clientModel"
          @expand="toggleExpand(entry.clientModel)"
          @update:targets="
            (targets: MappingTarget[]) => emit('update:targets', idx, targets)
          "
          @update:client-model="
            (v: string) => emit('update:client-model', idx, v)
          "
          @update:multimodal-fallback="
            (fb: MultimodalFallback | undefined) =>
              emit('update:multimodal-fallback', idx, fb)
          "
          @toggle-active="emit('toggle-active', idx)"
          @remove="emit('remove', entry.clientModel)"
        />
      </div>
    </div>

    <!-- Empty state -->
    <p
      v-if="entries.length === 0"
      class="py-3 text-center text-xs text-muted-foreground"
    >
      {{ t("providers.shared.noMappings") }}
    </p>

    <!-- Add new mapping row -->
    <div
      class="rounded-md border border-dashed border-border px-3 py-2 space-y-1.5"
    >
      <div class="flex items-center gap-2">
        <Input
          v-model="newFrom"
          :placeholder="t('providers.shared.clientModel')"
          class="h-7 flex-1 min-w-0 text-xs font-mono border-border"
          @keydown="handleKeydown"
        />
        <ArrowRight class="size-3.5 shrink-0 text-muted-foreground/30" />
        <div class="flex-[2] min-w-0">
          <CascadingModelSelect
            :providers="providerGroups"
            :model-value="newToValue"
            compact
            :placeholder="t('providers.shared.selectModel')"
            @update:model-value="(v: SelectedValue) => (newToValue = v)"
          />
        </div>
        <Badge
          variant="outline"
          class="text-[10px] shrink-0 text-muted-foreground/50"
        >
          {{ t("providers.shared.tagCustom") }}
        </Badge>
        <Button
          variant="outline"
          size="icon-xs"
          class="shrink-0"
          :disabled="!canAdd()"
          @click="addMapping"
        >
          <Plus class="size-3" />
        </Button>
      </div>

      <!-- Multimodal fallback (optional) -->
      <div class="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          class="text-[10px] text-blue-500/60 hover:text-blue-500"
          @click="showMultimodal = !showMultimodal"
        >
          <Grid3x3 class="size-3 mr-1" />
          {{
            showMultimodal
              ? t("mappings.multimodalFallback.collapse")
              : t("mappings.multimodalFallback.add")
          }}
        </Button>
        <div
          v-if="showMultimodal"
          class="flex items-center gap-2 flex-1 min-w-0"
        >
          <span class="text-[10px] text-blue-500/50 shrink-0">
            <Grid3x3 class="size-2.5" />
          </span>
          <div class="flex-1 min-w-0">
            <CascadingModelSelect
              :providers="providerGroups"
              :model-value="newMultimodalValue"
              compact
              dashed
              :placeholder="
                t('mappings.multimodalFallback.selectProviderModel')
              "
              @update:model-value="
                (v: SelectedValue) => (newMultimodalValue = v)
              "
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
