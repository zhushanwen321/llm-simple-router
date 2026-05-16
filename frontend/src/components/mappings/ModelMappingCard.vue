<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import { Trash2, ImageIcon, Plus } from "lucide-vue-next";
import { api, getApiMessage } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import CascadingModelSelect from "@/components/mappings/CascadingModelSelect.vue";
import type { SelectedValue } from "@/components/mappings/cascading-types";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import MappingEntryEditor from "@/components/mappings/MappingEntryEditor.vue";
import type {
  MappingTarget,
  MappingEntry,
  ImageFallback,
} from "@/components/quick-setup/types";
import type { ProviderGroup } from "@/components/mappings/cascading-types";

const { t } = useI18n();

const props = withDefaults(
  defineProps<{
    entry: MappingEntry;
    providerGroups: ProviderGroup[];
    editableClientModel?: boolean;
    defaultExpanded?: boolean;
  }>(),
  {
    defaultExpanded: false,
  },
);

const emit = defineEmits<{
  saved: [];
  deleted: [clientModel: string];
  "cancel-add": [];
}>();

const localClientModel = ref("");

// Sync localClientModel from entry for new-card mode
watch(
  () => props.entry.clientModel,
  (val) => {
    localClientModel.value = val;
  },
  { immediate: true },
);

const expanded = ref(props.defaultExpanded);
const localTargets = ref<MappingTarget[]>([]);
const localImageFallback = ref<ImageFallback | undefined>(undefined);
const saving = ref(false);
const showDeleteConfirm = ref(false);

// When expanding, snapshot current targets and image fallback as local edit copy
watch(expanded, (val) => {
  if (val) {
    localTargets.value = props.entry.targets.map((t) => ({ ...t }));
    localImageFallback.value = props.entry.imageFallback
      ? { ...props.entry.imageFallback }
      : undefined;
  }
});

// Sync localTargets when parent refreshes data while card is expanded
watch(
  () => props.entry.targets,
  (newTargets) => {
    if (expanded.value) {
      localTargets.value = newTargets.map((t) => ({ ...t }));
    }
  },
  { deep: true },
);

watch(
  () => props.entry.imageFallback,
  (fb) => {
    if (expanded.value) {
      localImageFallback.value = fb ? { ...fb } : undefined;
    }
  },
);

const workingEntry = computed<MappingEntry>(() =>
  expanded.value
    ? {
        ...props.entry,
        targets: localTargets.value,
        imageFallback: localImageFallback.value,
      }
    : props.entry,
);

function handleUpdateTargets(targets: MappingTarget[]) {
  localTargets.value = targets;
}

function handleUpdateClientModel(val: string) {
  localClientModel.value = val;
}

function handleUpdateImageFallback(fb: ImageFallback | undefined) {
  localImageFallback.value = fb;
}

async function handleSave() {
  saving.value = true;
  try {
    const clientModel = props.editableClientModel
      ? localClientModel.value.trim()
      : props.entry.clientModel;
    if (!clientModel) return;
    const ruleJson = JSON.stringify({
      targets: localTargets.value,
      ...(localImageFallback.value
        ? { image_fallback: localImageFallback.value }
        : {}),
    });
    if (props.entry.existingId) {
      await api.updateMappingGroup(props.entry.existingId, {
        client_model: clientModel,
        rule: ruleJson,
      });
    } else {
      await api.createMappingGroup({
        client_model: clientModel,
        rule: ruleJson,
      });
    }
    expanded.value = false;
    emit("saved");
    toast.success(t("common.saveSuccess"));
  } catch (e: unknown) {
    console.error("mappingCard.save:", e);
    toast.error(getApiMessage(e, t("mappings.messages.saveFailed")));
  } finally {
    saving.value = false;
  }
}

function handleCancel() {
  if (props.editableClientModel) {
    emit("cancel-add");
  } else {
    expanded.value = false;
  }
}

async function handleToggleActive() {
  try {
    if (props.entry.existingId) {
      await api.toggleMappingGroup(props.entry.existingId);
    }
    emit("saved");
  } catch (e: unknown) {
    console.error("mappingCard.toggle:", e);
    toast.error(getApiMessage(e, t("mappings.messages.toggleFailed")));
  }
}

function handleConfirmDelete() {
  showDeleteConfirm.value = false;
  emit("deleted", props.entry.clientModel);
}

// Active providers for image fallback select
const activeProviders = computed(() => props.providerGroups);

function addImageFallback() {
  const firstProvider = props.providerGroups[0];
  localImageFallback.value = {
    provider_id: firstProvider?.provider.id ?? "",
    backend_model: "",
  };
}

function handleFallbackSelect(val: SelectedValue) {
  localImageFallback.value = {
    provider_id: val.provider_id,
    backend_model: val.model,
  };
}
</script>

<template>
  <div
    class="rounded-lg border transition-colors"
    :class="
      expanded
        ? 'border-primary/30 shadow-sm shadow-primary/5'
        : 'border-border hover:border-border/80'
    "
  >
    <!-- Main row -->
    <div
      class="flex items-start gap-2 px-4 py-3"
      :class="{ 'cursor-pointer': !expanded }"
      @click="!expanded && (expanded = true)"
    >
      <!-- Editor (collapsed or expanded) -->
      <div class="flex-1 min-w-0">
        <MappingEntryEditor
          :entry="workingEntry"
          :provider-groups="providerGroups"
          :expanded="expanded"
          :editable="true"
          :editable-client-model="editableClientModel"
          @update:targets="handleUpdateTargets"
          @update:client-model="handleUpdateClientModel"
        />
      </div>

      <!-- Right actions: always visible -->
      <div class="flex flex-col items-end gap-1.5 shrink-0 pt-0.5">
        <div class="flex items-center gap-2">
          <span
            v-if="entry.targets.length > 1"
            class="text-[10px] px-1.5 py-0.5 rounded border border-orange-400/30 text-orange-400/60"
          >
            {{ t("providers.shared.level", { count: entry.targets.length }) }}
          </span>
          <span
            v-if="entry.imageFallback"
            class="text-[10px] px-1.5 py-0.5 rounded border border-primary/20 text-primary/60 flex items-center gap-0.5"
          >
            <ImageIcon class="w-2.5 h-2.5" />
          </span>
          <Button
            v-if="!editableClientModel"
            variant="ghost"
            size="icon-xs"
            class="text-muted-foreground/40 hover:text-destructive"
            @click.stop="showDeleteConfirm = true"
          >
            <Trash2 class="size-3" />
          </Button>
          <Switch
            v-if="!editableClientModel"
            :model-value="entry.active"
            @update:model-value="handleToggleActive"
            class="scale-75"
            @click.stop
          />
        </div>
      </div>
    </div>

    <!-- Image Fallback section (only when expanded) -->
    <div v-if="expanded" class="px-4 pt-2 pb-1 border-t border-border/30">
      <div class="flex items-center gap-2 mb-1.5">
        <ImageIcon class="w-3.5 h-3.5 text-muted-foreground/50" />
        <span class="text-xs text-muted-foreground">{{
          t("mappings.imageFallback.title")
        }}</span>
        <Badge
          v-if="localImageFallback"
          variant="outline"
          class="text-[10px] px-1.5 py-0 text-primary/60 border-primary/20"
        >
          {{ t("mappings.imageFallback.configured") }}
        </Badge>
      </div>
      <div v-if="localImageFallback" class="flex items-center gap-2">
        <CascadingModelSelect
          :providers="activeProviders"
          :model-value="
            localImageFallback
              ? {
                  provider_id: localImageFallback.provider_id,
                  model: localImageFallback.backend_model,
                }
              : undefined
          "
          :placeholder="t('mappings.imageFallback.selectProviderModel')"
          compact
          @update:model-value="handleFallbackSelect($event)"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          class="shrink-0 text-muted-foreground/40 hover:text-destructive"
          @click="handleUpdateImageFallback(undefined)"
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
        @click="addImageFallback"
      >
        <Plus class="w-3 h-3 mr-1" />
        {{ t("mappings.imageFallback.add") }}
      </Button>
    </div>

    <!-- Save bar (only when expanded) -->
    <div
      v-if="expanded"
      class="flex items-center justify-end gap-2 px-4 py-2 border-t border-border/50"
    >
      <Button size="sm" variant="outline" @click="handleCancel">{{
        t("common.cancel")
      }}</Button>
      <Button size="sm" :disabled="saving" @click="handleSave">
        {{ saving ? t("common.saving") : t("common.save") }}
      </Button>
    </div>
  </div>

  <!-- Delete confirm dialog -->
  <AlertDialog
    :open="showDeleteConfirm"
    @update:open="
      (val: boolean) => {
        if (!val) showDeleteConfirm = false;
      }
    "
  >
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{ t("common.confirmDelete") }}</AlertDialogTitle>
        <AlertDialogDescription>{{
          t("mappings.confirmDeleteDesc", { model: entry.clientModel })
        }}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>{{ t("common.cancel") }}</AlertDialogCancel>
        <Button variant="destructive" @click="handleConfirmDelete">{{
          t("common.delete")
        }}</Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
