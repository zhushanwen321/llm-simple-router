<template>
  <div class="page">
    <!-- Header -->
    <div class="flex items-center gap-4 mb-4">
      <h2 class="text-base font-semibold text-foreground shrink-0">
        {{ t("mappings.title") }}
      </h2>
      <div class="flex-1" />
      <Button size="sm" class="h-[30px] gap-1.5" @click="openAddDialog">
        <Plus class="w-3.5 h-3.5" />
        {{ t("mappings.addGroup") }}
      </Button>
    </div>

    <!-- Split layout -->
    <div class="flex gap-4" style="min-height: calc(100vh - 120px)">
      <!-- Left: list -->
      <aside class="w-[340px] shrink-0 flex flex-col gap-2">
        <div>
          <Input
            v-model="searchQuery"
            :placeholder="t('common.search') + '...'"
            class="h-[30px] text-[13px]"
          />
        </div>
        <span class="font-mono text-[10px] text-muted-foreground/60 px-0.5">
          {{ filteredGroups.length }} / {{ groups.length }}
          {{ t("mappings.totalMappings", { count: 0 }).replace(/\d+.*/, "") }}
        </span>
        <div class="flex flex-col gap-0.5 flex-1 overflow-y-auto">
          <div
            v-for="g in filteredGroups"
            :key="g.id"
            class="flex items-center gap-2.5 px-3 py-2 bg-card rounded-lg border cursor-pointer transition-colors"
            :class="
              selectedId === g.id
                ? 'border-primary bg-primary/10'
                : 'border-border hover:bg-muted/30'
            "
            @click="selectGroup(g.id)"
          >
            <div class="flex-1 min-w-0">
              <div
                class="font-mono text-xs font-semibold truncate"
                :class="
                  g.is_active ? 'text-foreground' : 'text-muted-foreground'
                "
              >
                {{ g.client_model }}
              </div>
              <div
                class="text-[10px] truncate mt-0.5"
                :class="
                  g.is_active
                    ? 'text-muted-foreground/60'
                    : 'text-muted-foreground/30'
                "
              >
                {{ summaryText(g) }}
              </div>
            </div>
            <span
              class="inline-flex items-center gap-1 px-1.5 py-px rounded-full text-[9px] font-mono font-semibold shrink-0"
              :class="
                g.is_active
                  ? 'bg-success/12 text-success'
                  : 'bg-muted/40 text-muted-foreground/50'
              "
            >
              <span
                class="w-1 h-1 rounded-full"
                :class="g.is_active ? 'bg-success' : 'bg-muted-foreground/40'"
              />
              {{ g.is_active ? "ON" : "OFF" }}
            </span>
          </div>

          <!-- Empty list -->
          <div
            v-if="filteredGroups.length === 0"
            class="py-8 text-center text-xs text-muted-foreground/50"
          >
            {{ t("mappings.noGroups") }}
          </div>
        </div>
      </aside>

      <!-- Right: detail panel -->
      <main
        class="flex-1 bg-card rounded-lg border border-border flex flex-col overflow-hidden"
      >
        <!-- Empty state -->
        <div
          v-if="!selectedGroup"
          class="flex-1 flex items-center justify-center text-muted-foreground/50 text-sm flex-col gap-2"
        >
          <ArrowRightLeft class="w-6 h-6 opacity-40" />
          {{ t("mappings.selectProviderOrModel") }}
        </div>

        <!-- Editing panel -->
        <template v-else>
          <!-- Header -->
          <div
            class="flex items-center gap-3 px-4 py-3 border-b border-border bg-background/30"
          >
            <span class="font-mono text-sm font-bold flex-1 truncate">
              {{ selectedGroup.client_model }}
            </span>
            <span
              class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold h-5"
              :class="
                selectedGroup.is_active
                  ? 'bg-success/12 text-success'
                  : 'bg-muted/40 text-muted-foreground/50'
              "
            >
              <span
                class="w-1 h-1 rounded-full"
                :class="
                  selectedGroup.is_active
                    ? 'bg-success'
                    : 'bg-muted-foreground/40'
                "
              />
              {{ selectedGroup.is_active ? "Active" : "Inactive" }}
            </span>
            <Switch
              :model-value="!!selectedGroup.is_active"
              @update:model-value="handleToggleActive"
            />
          </div>

          <!-- Body -->
          <div class="flex-1 overflow-y-auto px-4 py-4 space-y-5">
            <!-- Failover chain -->
            <section>
              <div class="flex items-center gap-2 mb-2">
                <Zap class="w-3.5 h-3.5 text-primary/60" />
                <span class="text-xs font-semibold text-muted-foreground">
                  {{ t("mappings.editor.failoverChain") }}
                </span>
                <span
                  class="font-mono text-[10px] text-muted-foreground/40 bg-muted/30 px-1.5 py-px rounded"
                >
                  {{ editTargets.length }}
                  target{{ editTargets.length > 1 ? "s" : "" }}
                </span>
              </div>
              <div class="flex flex-col gap-1.5">
                <div
                  v-for="(tgt, tIdx) in editTargets"
                  :key="tIdx"
                  class="flex items-center gap-2 px-3 py-2 bg-background border border-border rounded-md"
                >
                  <span
                    class="w-[22px] h-[22px] flex items-center justify-center rounded-full text-[10px] font-mono font-bold shrink-0"
                    :class="
                      tIdx === 0
                        ? 'bg-primary/15 text-primary'
                        : 'bg-muted/40 text-muted-foreground'
                    "
                  >
                    {{ tIdx + 1 }}
                  </span>
                  <div class="flex-1">
                    <CascadingModelSelect
                      :providers="providerGroups"
                      :model-value="{
                        provider_id: tgt.provider_id,
                        model: tgt.backend_model,
                      }"
                      compact
                      :placeholder="t('mappings.selectProviderModel')"
                      @update:model-value="
                        (v: SelectedValue) => updateTarget(tIdx, v)
                      "
                    />
                  </div>
                  <Button
                    v-if="editTargets.length > 1"
                    variant="ghost"
                    size="icon-xs"
                    class="shrink-0 text-muted-foreground/30 hover:text-destructive"
                    @click="removeTarget(tIdx)"
                  >
                    <X class="w-3 h-3" />
                  </Button>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                class="mt-1.5 text-xs text-muted-foreground/40 border border-dashed border-border hover:border-primary/40 hover:text-primary/60"
                @click="addTarget"
              >
                <Plus class="w-3 h-3 mr-1" />
                {{ t("mappings.addBackup") }}
              </Button>
            </section>

            <!-- Divider -->
            <div class="border-t border-dashed border-primary/10" />

            <!-- Context overflow -->
            <section>
              <div class="flex items-center gap-2 mb-2">
                <ArrowDown class="w-3.5 h-3.5 text-primary/50" />
                <span class="text-xs font-semibold text-primary/60">
                  {{ t("mappings.editor.contextOverflow") }}
                </span>
                <span
                  v-if="overflowEnabled"
                  class="font-mono text-[10px] text-primary/40 bg-primary/8 px-1.5 py-px rounded"
                >
                  {{ t("mappings.enabled") }}
                </span>
              </div>
              <div
                class="bg-background border border-border rounded-md px-3 py-2.5"
              >
                <div class="flex items-center gap-2.5 mb-2">
                  <Switch
                    :model-value="overflowEnabled"
                    @update:model-value="toggleOverflow"
                  />
                  <span class="text-xs text-foreground">{{
                    t("mappings.overflowTooltip")
                  }}</span>
                </div>
                <div v-if="overflowEnabled" class="flex gap-2">
                  <div class="flex-1">
                    <CascadingModelSelect
                      :providers="providerGroups"
                      :model-value="
                        editOverflow
                          ? {
                              provider_id: editOverflow.provider_id,
                              model: editOverflow.model,
                            }
                          : undefined
                      "
                      compact
                      dashed
                      :placeholder="t('mappings.selectModel')"
                      @update:model-value="
                        (v: SelectedValue) => updateOverflow(v)
                      "
                    />
                  </div>
                </div>
                <span v-else class="text-xs text-muted-foreground/40">{{
                  t("mappings.overflowTooltip")
                }}</span>
              </div>
            </section>

            <!-- Multimodal fallback -->
            <section>
              <div class="flex items-center gap-2 mb-2">
                <ImageIcon class="w-3.5 h-3.5 text-blue-500/50" />
                <span class="text-xs font-semibold text-blue-500/60">
                  {{ t("mappings.editor.multimodalFallback") }}
                </span>
                <span
                  v-if="multimodalEnabled"
                  class="font-mono text-[10px] text-blue-500/40 bg-blue-500/8 px-1.5 py-px rounded"
                >
                  {{ t("mappings.enabled") }}
                </span>
              </div>
              <div
                class="bg-background border border-border rounded-md px-3 py-2.5"
              >
                <div class="flex items-center gap-2.5 mb-2">
                  <Switch
                    :model-value="multimodalEnabled"
                    @update:model-value="toggleMultimodal"
                  />
                  <span class="text-xs text-foreground">{{
                    t("mappings.multimodalFallback.add")
                  }}</span>
                </div>
                <div v-if="multimodalEnabled" class="flex gap-2">
                  <div class="flex-1">
                    <CascadingModelSelect
                      :providers="providerGroups"
                      :model-value="
                        editMultimodal
                          ? {
                              provider_id: editMultimodal.provider_id,
                              model: editMultimodal.backend_model,
                            }
                          : undefined
                      "
                      compact
                      dashed
                      :placeholder="
                        t('mappings.multimodalFallback.selectProviderModel')
                      "
                      @update:model-value="
                        (v: SelectedValue) => updateMultimodal(v)
                      "
                    />
                  </div>
                </div>
                <span v-else class="text-xs text-muted-foreground/40">{{
                  t("mappings.multimodalFallback.add")
                }}</span>
                <!-- Session lock warning -->
                <div
                  v-if="multimodalEnabled"
                  class="flex items-center gap-2 mt-2 px-2 py-1.5 bg-warning/8 rounded"
                >
                  <AlertTriangle class="w-3 h-3 text-warning shrink-0" />
                  <span class="text-[10px] text-warning leading-relaxed">
                    {{ t("mappings.multimodalFallback.sessionLockWarning") }}
                  </span>
                </div>
              </div>
            </section>
          </div>

          <!-- Footer -->
          <div
            class="flex items-center justify-between px-4 py-2.5 border-t border-border bg-background/30"
          >
            <template v-if="showDeleteConfirm">
              <div class="flex items-center gap-2 text-xs text-danger">
                {{
                  t("mappings.confirmDeleteDesc", {
                    model: selectedGroup.client_model,
                  })
                }}
                <Button
                  variant="destructive"
                  size="sm"
                  class="h-6 text-[11px] px-2"
                  @click="confirmDelete"
                >
                  {{ t("common.yes") }}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-6 text-[11px] px-2"
                  @click="showDeleteConfirm = false"
                >
                  {{ t("common.no") }}
                </Button>
              </div>
            </template>
            <template v-else>
              <span class="font-mono text-[10px] text-muted-foreground/40">
                ID: {{ selectedGroup.id }}
              </span>
              <div class="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  class="text-xs text-danger hover:text-danger"
                  @click="showDeleteConfirm = true"
                >
                  {{ t("common.delete") }}
                </Button>
                <Button
                  size="sm"
                  class="text-xs"
                  :disabled="saving"
                  @click="handleSave"
                >
                  {{ saving ? t("common.saving") : t("common.save") }}
                </Button>
              </div>
            </template>
          </div>
        </template>
      </main>
    </div>

    <!-- Add dialog -->
    <Dialog :open="addDialogOpen" @update:open="addDialogOpen = false">
      <DialogContent class="max-w-md">
        <DialogHeader>
          <DialogTitle>{{ t("mappings.addGroup") }}</DialogTitle>
        </DialogHeader>
        <div class="space-y-3 py-2">
          <div class="space-y-1.5">
            <Label class="text-xs text-muted-foreground">
              {{ t("mappings.clientModel") }}
            </Label>
            <Input
              v-model="newClientModel"
              :placeholder="t('mappings.editor.clientInputPlaceholder')"
              class="h-8 font-mono text-xs"
            />
          </div>
          <div class="space-y-1.5">
            <Label class="text-xs text-muted-foreground">
              {{ t("mappings.selectProviderModel") }}
            </Label>
            <CascadingModelSelect
              :providers="providerGroups"
              :model-value="newTarget"
              compact
              :placeholder="t('mappings.selectProviderModel')"
              @update:model-value="newTarget = $event"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" @click="addDialogOpen = false">
            {{ t("common.cancel") }}
          </Button>
          <Button size="sm" :disabled="!canAdd" @click="handleAdd">
            {{ t("mappings.addGroup") }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import {
  Plus,
  X,
  Zap,
  ArrowDown,
  AlertTriangle,
  ArrowRightLeft,
  Image as ImageIcon,
} from "lucide-vue-next";
import { api, getApiMessage } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import CascadingModelSelect from "@/components/mappings/CascadingModelSelect.vue";
import type { SelectedValue } from "@/components/mappings/cascading-types";
import type {
  MappingGroup,
  MappingTarget,
  MultimodalFallback,
  Provider,
  Rule,
} from "@/types/mapping";
import type { ProviderGroup } from "@/components/mappings/cascading-types";
import { DEFAULT_CONTEXT_WINDOW } from "@/constants";

const { t } = useI18n();

// --- State ---
const groups = ref<MappingGroup[]>([]);
const providersList = ref<Provider[]>([]);
const selectedId = ref<string | null>(null);
const searchQuery = ref("");
const saving = ref(false);
const showDeleteConfirm = ref(false);

// Add dialog
const addDialogOpen = ref(false);
const newClientModel = ref("");
const newTarget = ref<SelectedValue | undefined>(undefined);

// Edit state (deep copy from selected group)
const editTargets = ref<MappingTarget[]>([]);
const editOverflow = ref<{
  provider_id: string;
  model: string;
} | null>(null);
const editMultimodal = ref<MultimodalFallback | null>(null);

// --- Computed ---
const providerGroups = computed<ProviderGroup[]>(() =>
  providersList.value.map((p) => ({
    provider: { id: p.id, name: p.name },
    models: (p.models ?? []).map((m) => ({
      name: m.name,
      contextWindow: m.context_window ?? DEFAULT_CONTEXT_WINDOW,
      streamTimeoutMs: m.stream_timeout_ms ?? null,
    })),
  })),
);

const filteredGroups = computed(() => {
  const q = searchQuery.value.toLowerCase().trim();
  if (!q) return groups.value;
  return groups.value.filter((g) => g.client_model.toLowerCase().includes(q));
});

const selectedGroup = computed(
  () => groups.value.find((g) => g.id === selectedId.value) ?? null,
);

const overflowEnabled = computed(() => !!editOverflow.value);

const multimodalEnabled = computed(() => !!editMultimodal.value);

const canAdd = computed(() => {
  const cm = newClientModel.value.trim();
  return cm.length > 0 && !!newTarget.value?.model;
});

const PROVIDER_NAME_TRUNCATE = 6;

// --- Rule parse / serialize ---
function parseRule(group: MappingGroup): {
  targets: MappingTarget[];
  overflow: { provider_id: string; model: string } | null;
  multimodal: MultimodalFallback | null;
} {
  let rule: Rule = {};
  try {
    const parsed = JSON.parse(group.rule);
    rule =
      parsed.default && !parsed.targets
        ? { targets: [parsed.default] }
        : parsed;
  } catch (e: unknown) {
    console.error("ModelMappings.parseRule:", e);
    toast.error(getApiMessage(e, t("mappings.messages.parseRuleFailed")));
  }

  const targets: MappingTarget[] = (rule.targets ?? []).map((t) => ({
    backend_model: t.backend_model || "",
    provider_id: t.provider_id || "",
    overflow_provider_id: t.overflow_provider_id,
    overflow_model: t.overflow_model,
  }));

  const firstTarget = targets[0];
  const overflow =
    firstTarget?.overflow_provider_id && firstTarget?.overflow_model
      ? {
        provider_id: firstTarget.overflow_provider_id,
        model: firstTarget.overflow_model,
      }
      : null;

  const multimodal = rule.multimodal_fallback ?? null;

  return {
    targets:
      targets.length > 0
        ? targets
        : [
          {
            backend_model: "",
            provider_id: providersList.value[0]?.id ?? "",
          },
        ],
    overflow,
    multimodal,
  };
}

function serializeRule(): string {
  const targets = editTargets.value.map((t, idx) => {
    if (idx === 0 && editOverflow.value) {
      return {
        backend_model: t.backend_model,
        provider_id: t.provider_id,
        overflow_provider_id: editOverflow.value.provider_id,
        overflow_model: editOverflow.value.model,
      };
    }
    return {
      backend_model: t.backend_model,
      provider_id: t.provider_id,
    };
  });

  return JSON.stringify({
    targets,
    ...(editMultimodal.value
      ? { multimodal_fallback: editMultimodal.value }
      : {}),
  });
}

// --- Summary text for left list ---
function summaryText(g: MappingGroup): string {
  const parsed = parseRule(g);
  const parts: string[] = [];
  for (const t of parsed.targets) {
    const prov = providersList.value.find((p) => p.id === t.provider_id);
    const provName =
      prov?.name ?? t.provider_id.slice(0, PROVIDER_NAME_TRUNCATE);
    parts.push(provName);
  }
  if (parsed.overflow) {
    const prov = providersList.value.find(
      (p) => p.id === parsed.overflow!.provider_id,
    );
    parts.push("↓ " + (prov?.name ?? "OF"));
  }
  if (parsed.multimodal) {
    parts.push("MM");
  }
  return parts.join(" → ");
}

// --- Selection & edit sync ---
function selectGroup(id: string) {
  selectedId.value = id;
  showDeleteConfirm.value = false;
}

watch(selectedGroup, (g) => {
  if (!g) return;
  const parsed = parseRule(g);
  editTargets.value = parsed.targets.map((t) => ({ ...t }));
  editOverflow.value = parsed.overflow ? { ...parsed.overflow } : null;
  editMultimodal.value = parsed.multimodal ? { ...parsed.multimodal } : null;
  showDeleteConfirm.value = false;
});

// --- Failover chain ---
function addTarget() {
  const firstProvider = providerGroups.value[0];
  editTargets.value.push({
    backend_model: firstProvider?.models[0]?.name ?? "",
    provider_id: firstProvider?.provider.id ?? "",
  });
}

function removeTarget(index: number) {
  if (editTargets.value.length <= 1) return;
  editTargets.value.splice(index, 1);
}

function updateTarget(index: number, val: SelectedValue) {
  editTargets.value[index] = {
    ...editTargets.value[index],
    provider_id: val.provider_id,
    backend_model: val.model,
  };
}

// --- Overflow ---
function toggleOverflow(on: boolean) {
  if (on) {
    const firstProvider = providerGroups.value[0];
    editOverflow.value = {
      provider_id: firstProvider?.provider.id ?? "",
      model: firstProvider?.models[0]?.name ?? "",
    };
  } else {
    editOverflow.value = null;
  }
}

function updateOverflow(val: SelectedValue) {
  editOverflow.value = {
    provider_id: val.provider_id,
    model: val.model,
  };
}

// --- Multimodal ---
function toggleMultimodal(on: boolean) {
  if (on) {
    const firstProvider = providerGroups.value[0];
    editMultimodal.value = {
      provider_id: firstProvider?.provider.id ?? "",
      backend_model: firstProvider?.models[0]?.name ?? "",
    };
  } else {
    editMultimodal.value = null;
  }
}

function updateMultimodal(val: SelectedValue) {
  editMultimodal.value = {
    provider_id: val.provider_id,
    backend_model: val.model,
  };
}

// --- Data loading ---
async function loadData() {
  const results = await Promise.allSettled([
    api.getMappingGroups(),
    api.getProviders(),
  ]);
  if (results[0].status === "fulfilled") groups.value = results[0].value;
  if (results[1].status === "fulfilled")
    providersList.value = results[1].value as Provider[];

  // Auto-select first if nothing selected
  if (!selectedId.value && groups.value.length > 0) {
    selectedId.value = groups.value[0].id;
  }
}

// --- Save ---
async function handleSave() {
  if (!selectedGroup.value) return;
  const cm = selectedGroup.value.client_model.trim();
  if (!cm) return;

  saving.value = true;
  try {
    await api.updateMappingGroup(selectedGroup.value.id, {
      client_model: cm,
      rule: serializeRule(),
    });
    await loadData();
    toast.success(t("common.saveSuccess"));
  } catch (e: unknown) {
    console.error("ModelMappings.save:", e);
    toast.error(getApiMessage(e, t("mappings.messages.saveFailed")));
  } finally {
    saving.value = false;
  }
}

// --- Toggle active ---
async function handleToggleActive() {
  if (!selectedGroup.value) return;
  try {
    await api.toggleMappingGroup(selectedGroup.value.id);
    await loadData();
  } catch (e: unknown) {
    console.error("ModelMappings.toggle:", e);
    toast.error(getApiMessage(e, t("mappings.messages.toggleFailed")));
  }
}

// --- Delete ---
async function confirmDelete() {
  if (!selectedGroup.value) return;
  try {
    await api.deleteMappingGroup(selectedGroup.value.id);
    showDeleteConfirm.value = false;
    // Select next
    const remaining = groups.value.filter(
      (g) => g.id !== selectedGroup.value!.id,
    );
    selectedId.value = remaining.length > 0 ? remaining[0].id : null;
    await loadData();
    toast.success(t("common.deleteSuccess"));
  } catch (e: unknown) {
    console.error("ModelMappings.delete:", e);
    toast.error(
      getApiMessage(
        e,
        t("mappings.messages.deleteFailed", {
          model: selectedGroup.value.client_model,
        }),
      ),
    );
  }
}

// --- Add ---
function openAddDialog() {
  newClientModel.value = "";
  const firstProvider = providerGroups.value[0];
  newTarget.value = firstProvider
    ? {
      provider_id: firstProvider.provider.id,
      model: firstProvider.models[0]?.name ?? "",
    }
    : undefined;
  addDialogOpen.value = true;
}

async function handleAdd() {
  const cm = newClientModel.value.trim();
  if (!cm || !newTarget.value?.model) return;

  try {
    const rule = JSON.stringify({
      targets: [
        {
          provider_id: newTarget.value.provider_id,
          backend_model: newTarget.value.model,
        },
      ],
    });
    const result = await api.createMappingGroup({
      client_model: cm,
      rule,
    });
    addDialogOpen.value = false;
    await loadData();
    selectedId.value = result.id;
    toast.success(t("common.saveSuccess"));
  } catch (e: unknown) {
    console.error("ModelMappings.add:", e);
    toast.error(getApiMessage(e, t("mappings.messages.saveFailed")));
  }
}

onMounted(loadData);
</script>
