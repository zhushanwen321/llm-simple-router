<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Plus } from "lucide-vue-next";
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
  add: [clientModel: string, targetModel: string];
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

function canAdd(): boolean {
  return newFrom.value.trim().length > 0 && !!newToValue.value?.model;
}

function addMapping() {
  const from = newFrom.value.trim();
  const to = newToValue.value;
  if (from && to) {
    emit("add", from, to.model);
    newFrom.value = "";
    newToValue.value = undefined;
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
      class="flex items-center gap-3 rounded-md border border-dashed border-border px-3 py-2"
    >
      <Input
        v-model="newFrom"
        :placeholder="t('providers.shared.clientModel')"
        class="h-7 min-w-[90px] text-xs font-mono border-border"
        @keydown="handleKeydown"
      />
      <ArrowRight class="size-3.5 shrink-0 text-muted-foreground/30" />
      <div class="flex-1 min-w-0">
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
  </div>
</template>
