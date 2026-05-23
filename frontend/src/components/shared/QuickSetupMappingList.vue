<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Trash2, ArrowRight, Plus, Layers } from "lucide-vue-next";
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

const props = defineProps<{
  entries: MappingEntry[];
  providerGroups: ProviderGroup[];
}>();

const emit = defineEmits<{
  "update:targets": [index: number, targets: MappingTarget[]];
  "update:multimodal-fallback": [index: number, fallback: MultimodalFallback | undefined];
  "toggle-active": [index: number];
  add: [clientModel: string, targetModel: string];
  remove: [clientModel: string];
}>();

const expandedEntries = ref<Set<string>>(new Set());

function toggleExpand(clientModel: string) {
  const next = new Set(expandedEntries.value);
  if (next.has(clientModel)) next.delete(clientModel);
  else next.add(clientModel);
  expandedEntries.value = next;
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

function addMultimodalFallback(idx: number) {
  const firstProvider = props.providerGroups[0];
  emit("update:multimodal-fallback", idx, {
    provider_id: firstProvider?.provider.id ?? "",
    backend_model: "",
  });
}

function handleFallbackSelect(idx: number, val: SelectedValue) {
  emit("update:multimodal-fallback", idx, {
    provider_id: val.provider_id,
    backend_model: val.model,
  });
}
</script>

<template>
  <div class="space-y-1.5">
    <div
      v-for="(entry, idx) in entries"
      :key="entry.clientModel"
      class="rounded-md border border-border"
    >
      <!-- Main row -->
      <div class="flex items-start gap-2 px-3 py-2">
        <!-- Editor: only toggle on click when collapsed; expanded editor contains interactive controls that must not trigger collapse -->
        <div
          class="flex-1 min-w-0"
          :class="{ 'cursor-pointer': !expandedEntries.has(entry.clientModel) }"
          @click="
            !expandedEntries.has(entry.clientModel) &&
            toggleExpand(entry.clientModel)
          "
        >
          <MappingEntryEditor
            :entry="entry"
            :provider-groups="providerGroups"
            :expanded="expandedEntries.has(entry.clientModel)"
            :editable="true"
            @update:targets="
              (targets: MappingTarget[]) => emit('update:targets', idx, targets)
            "
          />
        </div>

        <!-- Actions -->
        <div class="flex items-center gap-1.5 shrink-0 pt-0.5">
          <Button
            variant="ghost"
            size="icon-xs"
            class="text-muted-foreground/40 hover:text-destructive"
            @click.stop="emit('remove', entry.clientModel)"
          >
            <Trash2 class="size-3" />
          </Button>
          <Switch
            :model-value="entry.active"
            @update:model-value="emit('toggle-active', idx)"
            class="scale-75"
            @click.stop
          />
        </div>
      </div>

      <!-- Multimodal Fallback (only when expanded) -->
      <div
        v-if="expandedEntries.has(entry.clientModel)"
        class="px-3 pb-2 border-t border-border/30"
      >
        <div class="flex items-center gap-2 mb-1.5 pt-2">
          <Layers class="w-3.5 h-3.5 text-muted-foreground/50" />
          <span class="text-xs text-muted-foreground">{{
            t("mappings.multimodalFallback.title")
          }}</span>
          <Badge
            v-if="entry.multimodalFallback?.backend_model"
            variant="outline"
            class="text-[10px] px-1.5 py-0 text-primary/60 border-primary/20"
          >
            {{ t("mappings.multimodalFallback.configured") }}
          </Badge>
        </div>
        <div v-if="entry.multimodalFallback" class="flex items-center gap-2">
          <div class="flex-1">
            <CascadingModelSelect
              :providers="providerGroups"
              :model-value="
                entry.multimodalFallback
                  ? {
                      provider_id: entry.multimodalFallback.provider_id,
                      model: entry.multimodalFallback.backend_model,
                    }
                  : undefined
              "
              :placeholder="
                t('mappings.multimodalFallback.selectProviderModel')
              "
              compact
              @update:model-value="
                (v: SelectedValue) => handleFallbackSelect(idx, v)
              "
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            class="shrink-0 text-muted-foreground/40 hover:text-destructive"
            @click.stop="emit('update:multimodal-fallback', idx, undefined)"
          >
            <Trash2 class="size-3" />
          </Button>
        </div>
        <Button
          v-else
          type="button"
          variant="ghost"
          size="sm"
          class="text-xs text-muted-foreground/50"
          @click="addMultimodalFallback(idx)"
        >
          <Plus class="w-3 h-3 mr-1" />
          {{ t("mappings.multimodalFallback.add") }}
        </Button>
      </div>
    </div>

    <!-- Empty state -->
    <p
      v-if="entries.length === 0"
      class="py-3 text-center text-xs text-muted-foreground"
    >
      {{ t("providers.shared.noMappings") }}
    </p>

    <!-- Add new mapping -->
    <div
      class="flex items-center gap-3 rounded-md border border-dashed border-border px-3 py-2"
    >
      <Input
        v-model="newFrom"
        :placeholder="t('providers.shared.clientModel')"
        class="h-7 min-w-[90px] text-xs font-mono"
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
        Custom
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
