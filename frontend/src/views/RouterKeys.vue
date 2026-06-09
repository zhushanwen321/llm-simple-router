<template>
  <div class="page">
    <!-- Header -->
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-base font-semibold text-foreground">
        {{ t("routerKeys.title") }}
      </h2>
      <Button size="sm" @click="openCreate" class="flex items-center gap-1.5">
        <Plus class="w-3.5 h-3.5" />
        {{ t("routerKeys.createKey") }}
      </Button>
    </div>

    <!-- Anchor bar -->
    <div
      class="flex gap-6 px-4 py-3 mb-3 rounded-lg bg-card border border-input"
    >
      <div class="flex flex-col gap-0.5">
        <span
          class="text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
          >{{ t("routerKeys.statTotal") }}</span
        >
        <span class="text-xl font-semibold leading-none font-mono">{{
          keys.length
        }}</span>
      </div>
      <div class="w-px self-stretch bg-border" />
      <div class="flex flex-col gap-0.5">
        <span
          class="text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
          >{{ t("routerKeys.statActive") }}</span
        >
        <span class="text-xl font-semibold leading-none font-mono text-primary">
          {{ activeCount }}
        </span>
      </div>
      <div class="w-px self-stretch bg-border" />
      <div class="flex flex-col gap-0.5">
        <span
          class="text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
          >{{ t("routerKeys.statWhitelist") }}</span
        >
        <span class="text-xl font-semibold leading-none font-mono">{{
          whitelistCount
        }}</span>
      </div>
    </div>

    <!-- Search -->
    <div class="mb-3">
      <div class="relative max-w-[280px]">
        <Search
          class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50 pointer-events-none"
        />
        <Input
          v-model="searchQuery"
          :placeholder="t('routerKeys.searchPlaceholder')"
          class="h-[30px] pl-[30px] text-[13px]"
        />
      </div>
    </div>

    <!-- Table -->
    <Card flush>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead
              class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60"
            >
              {{ t("routerKeys.tableHeaders.name") }}
            </TableHead>
            <TableHead
              class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60"
            >
              {{ t("routerKeys.tableHeaders.key") }}
            </TableHead>
            <TableHead
              class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60"
            >
              {{ t("routerKeys.tableHeaders.whitelist") }}
            </TableHead>
            <TableHead
              class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60"
            >
              {{ t("routerKeys.tableHeaders.status") }}
            </TableHead>
            <TableHead
              class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60"
            >
              {{ t("routerKeys.tableHeaders.createdAt") }}
            </TableHead>
            <TableHead
              class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 text-right"
            >
              {{ t("routerKeys.tableHeaders.actions") }}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow
            v-for="k in filteredKeys"
            :key="k.id"
            :class="{ 'opacity-40': !k.is_active }"
          >
            <!-- Name -->
            <TableCell>
              <span class="font-medium text-sm max-w-[200px] truncate block">
                {{ k.name }}
              </span>
            </TableCell>

            <!-- Key -->
            <TableCell>
              <div class="flex items-center gap-1.5">
                <span
                  v-if="revealedKeys.has(k.id)"
                  class="font-mono text-xs font-medium break-all"
                >
                  {{ k.key }}
                </span>
                <template v-else>
                  <span class="font-mono text-xs font-medium">
                    {{ k.key_prefix }}
                  </span>
                  <span
                    class="font-mono text-xs text-muted-foreground/40 tracking-wider"
                  >
                    {{ MASK_PLACEHOLDER }}
                  </span>
                </template>
                <Button
                  variant="ghost"
                  size="icon"
                  class="h-6 w-6 shrink-0"
                  @click="copyKey(k)"
                >
                  <Check
                    v-if="copiedId === k.id"
                    class="w-3.5 h-3.5 text-success"
                  />
                  <Copy v-else class="w-3.5 h-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-6 px-1.5 text-[11px] text-muted-foreground shrink-0"
                  @click="toggleReveal(k.id)"
                >
                  {{
                    revealedKeys.has(k.id)
                      ? t("routerKeys.hideKey")
                      : t("routerKeys.showKey")
                  }}
                </Button>
              </div>
            </TableCell>

            <!-- Whitelist -->
            <TableCell>
              <div class="flex items-center gap-1 flex-wrap">
                <template
                  v-if="k.allowed_models && k.allowed_models.length > 0"
                >
                  <Badge
                    v-for="m in k.allowed_models.slice(0, VISIBLE_MODEL_COUNT)"
                    :key="m"
                    variant="outline"
                    class="font-mono text-[10px] font-medium px-1.5 py-0 h-5"
                  >
                    {{ m }}
                  </Badge>
                  <Badge
                    v-if="k.allowed_models.length > VISIBLE_MODEL_COUNT"
                    class="text-[10px] font-medium px-1.5 py-0 h-5"
                  >
                    {{
                      t("routerKeys.moreModels", {
                        count: k.allowed_models.length - VISIBLE_MODEL_COUNT,
                      })
                    }}
                  </Badge>
                </template>
                <Badge
                  v-else
                  variant="secondary"
                  class="text-[10px] font-semibold px-1.5 py-0 h-5"
                >
                  {{ t("common.allModels") }}
                </Badge>
              </div>
            </TableCell>

            <!-- Status -->
            <TableCell>
              <div class="flex items-center gap-1.5">
                <span :class="statusDotClass(k.is_active)" />
                <span class="text-xs text-muted-foreground">
                  {{ k.is_active ? t("common.active") : t("common.inactive") }}
                </span>
              </div>
            </TableCell>

            <!-- Created -->
            <TableCell>
              <span class="font-mono text-[11px] text-muted-foreground/50">
                {{ formatTime(k.created_at) }}
              </span>
            </TableCell>

            <!-- Actions -->
            <TableCell class="text-right">
              <div class="flex items-center justify-end gap-0.5">
                <Button
                  variant="ghost"
                  size="icon"
                  class="h-7 w-7"
                  @click="openEdit(k)"
                >
                  <Pencil class="w-3.5 h-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  class="h-7 w-7"
                  @click="handleToggleActive(k)"
                >
                  <ShieldCheck
                    v-if="k.is_active"
                    class="w-3.5 h-3.5 text-success"
                  />
                  <ShieldX v-else class="w-3.5 h-3.5 text-muted-foreground" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  class="h-7 w-7 text-muted-foreground hover:text-destructive"
                  @click="openDelete(k)"
                >
                  <Trash2 class="w-3.5 h-3.5" />
                </Button>
              </div>
            </TableCell>
          </TableRow>

          <!-- Empty state -->
          <TableRow v-if="filteredKeys.length === 0">
            <TableCell colspan="6" class="text-center py-12">
              <p class="text-muted-foreground text-sm">
                {{
                  keys.length === 0
                    ? t("routerKeys.noKeys")
                    : t("routerKeys.noMatch")
                }}
              </p>
              <p
                v-if="keys.length === 0"
                class="text-muted-foreground/50 text-xs mt-1"
              >
                {{ t("routerKeys.noKeysHint") }}
              </p>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Card>

    <!-- Create / Edit Dialog -->
    <Dialog v-model:open="editDialogOpen">
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {{
              editingKey ? t("routerKeys.editKey") : t("routerKeys.createKey")
            }}
          </DialogTitle>
        </DialogHeader>
        <form @submit.prevent="handleSave" class="space-y-4">
          <!-- Name -->
          <div>
            <Label class="text-xs font-medium text-muted-foreground mb-1 block">
              {{ t("routerKeys.tableHeaders.name") }}
            </Label>
            <Input
              v-model="form.name"
              :placeholder="t('routerKeys.placeholder.name')"
              @input="delete errors.name"
            />
            <p v-if="errors.name" class="text-xs text-destructive mt-1">
              {{ errors.name }}
            </p>
          </div>

          <!-- Whitelist -->
          <div>
            <Label class="text-xs font-medium text-muted-foreground mb-1 block">
              {{ t("routerKeys.whitelistLabel") }}
            </Label>
            <p class="text-[11px] text-muted-foreground/50 mb-2">
              {{ t("routerKeys.whitelistHint") }}
            </p>
            <div class="border rounded-md bg-muted/30 p-2">
              <Input
                v-model="modelFilter"
                :placeholder="t('routerKeys.modelFilterPlaceholder')"
                class="h-7 text-xs border-0 border-b rounded-none mb-2 bg-transparent focus-visible:ring-0"
              />
              <!-- Selected models badges -->
              <div
                v-if="form.allowed_models.length > 0"
                class="flex flex-wrap gap-1 mb-2"
              >
                <Badge
                  v-for="model in form.allowed_models"
                  :key="model"
                  variant="secondary"
                  class="font-mono text-[10px] font-medium px-1.5 py-0 h-5 gap-1"
                >
                  {{ model }}
                  <X
                    class="w-3 h-3 cursor-pointer hover:text-destructive shrink-0"
                    @click="removeModel(model)"
                  />
                </Badge>
              </div>

              <div class="max-h-[200px] overflow-y-auto space-y-0.5">
                <Label
                  v-for="model in filteredModels"
                  :key="model"
                  class="flex items-center gap-2 cursor-pointer px-1.5 py-1 rounded hover:bg-muted text-xs font-normal"
                >
                  <Checkbox
                    :model-value="form.allowed_models.includes(model)"
                    @update:model-value="
                      (val: boolean | 'indeterminate') =>
                        toggleModel(model, val)
                    "
                  />
                  <span class="font-mono text-[11px]">{{ model }}</span>
                </Label>
                <p
                  v-if="availableModels.length === 0"
                  class="text-muted-foreground text-xs text-center py-3"
                >
                  {{ t("routerKeys.noModels") }}
                </p>
              </div>
            </div>
          </div>

          <!-- Active toggle (edit only) -->
          <div v-if="editingKey" class="flex items-center gap-2.5">
            <Switch
              :model-value="form.is_active"
              @update:model-value="form.is_active = $event"
            />
            <Label class="text-sm">
              {{ form.is_active ? t("common.active") : t("common.inactive") }}
            </Label>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              @click="editDialogOpen = false"
            >
              {{ t("common.cancel") }}
            </Button>
            <Button type="submit">{{ t("common.save") }}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <!-- Key Reveal Dialog (after create) -->
    <Dialog v-model:open="revealDialogOpen">
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{{ t("routerKeys.keyCreated") }}</DialogTitle>
        </DialogHeader>
        <div class="space-y-3">
          <div class="rounded-md border border-primary/25 bg-primary/10 p-3">
            <div class="flex items-center gap-2">
              <span class="font-mono text-xs font-medium break-all flex-1">
                {{ createdKeyValue }}
              </span>
              <Button
                variant="ghost"
                size="icon"
                class="h-7 w-7 shrink-0"
                @click="copyRevealKey"
              >
                <Check v-if="revealCopied" class="w-3.5 h-3.5 text-success" />
                <Copy v-else class="w-3.5 h-3.5" />
              </Button>
            </div>
            <div
              class="flex items-center gap-1.5 mt-2 text-warning text-[11px]"
            >
              <AlertTriangle class="w-3 h-3 shrink-0" />
              {{ t("routerKeys.keyShownOnce") }}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button @click="revealDialogOpen = false">{{
            t("common.close")
          }}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Delete Confirm -->
    <AlertDialog
      :open="!!deleteTarget"
      @update:open="
        (v: boolean) => {
          if (!v) deleteTarget = null;
        }
      "
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{
            t("routerKeys.confirmDeleteTitle")
          }}</AlertDialogTitle>
          <AlertDialogDescription>
            {{
              t("routerKeys.confirmDeleteDesc", { name: deleteTarget?.name })
            }}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{{ t("common.cancel") }}</AlertDialogCancel>
          <Button variant="destructive" @click="handleDelete">
            {{ t("common.delete") }}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>

<script setup lang="ts">
import { Card } from "@/components/ui/card";
import { ref, computed, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import { api, getApiMessage } from "@/api/client";
import { useClipboard } from "@/composables/useClipboard";
import { formatTime } from "@/utils/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import {
  Plus,
  Copy,
  Check,
  Pencil,
  Trash2,
  ShieldCheck,
  ShieldX,
  Search,
  AlertTriangle,
  X,
} from "@lucide/vue";
import type { RouterKey } from "@/types/models";

const { t } = useI18n();

// Constants
const VISIBLE_MODEL_COUNT = 2;
const MASK_DOT_COUNT = 14;
const MASK_PLACEHOLDER = "\u2022".repeat(MASK_DOT_COUNT);
const COPY_FEEDBACK_MS = 2000;

// State
const keys = ref<RouterKey[]>([]);
const availableModels = ref<string[]>([]);
const searchQuery = ref("");
const revealedKeys = ref(new Set<string>());
const copiedId = ref<string | null>(null);
const editDialogOpen = ref(false);
const revealDialogOpen = ref(false);
const deleteTarget = ref<RouterKey | null>(null);
const editingKey = ref<RouterKey | null>(null);
const createdKeyValue = ref("");
const revealCopied = ref(false);
const modelFilter = ref("");
const form = ref({ name: "", allowed_models: [] as string[], is_active: true });
const errors = ref<Record<string, string>>({});

// Computed
const activeCount = computed(
  () => keys.value.filter((k) => k.is_active).length,
);
const whitelistCount = computed(
  () =>
    keys.value.filter((k) => k.allowed_models && k.allowed_models.length > 0)
      .length,
);

const filteredKeys = computed(() => {
  const q = searchQuery.value.toLowerCase();
  if (!q) return keys.value;
  return keys.value.filter(
    (k) =>
      k.name.toLowerCase().includes(q) ||
      (k.key && k.key.toLowerCase().includes(q)),
  );
});

const filteredModels = computed(() => {
  const q = modelFilter.value.toLowerCase();
  if (!q) return availableModels.value;
  return availableModels.value.filter((m) => m.toLowerCase().includes(q));
});

// Helpers
function statusDotClass(isActive: number) {
  const base = "w-1.5 h-1.5 rounded-full shrink-0";
  return isActive
    ? `${base} bg-success shadow-[0_0_6px_var(--color-success)/0.4]`
    : `${base} bg-muted-foreground/30`;
}

// Actions
async function copyKey(k: RouterKey) {
  const raw = k.key;
  if (!raw) return;
  const ok = await copyToClipboard(raw);
  if (!ok) return;
  copiedId.value = k.id;
  setTimeout(() => {
    if (copiedId.value === k.id) copiedId.value = null;
  }, COPY_FEEDBACK_MS);
}

async function copyRevealKey() {
  const ok = await copyToClipboard(createdKeyValue.value);
  if (!ok) return;
  revealCopied.value = true;
  setTimeout(() => {
    revealCopied.value = false;
  }, COPY_FEEDBACK_MS);
}

const { copy: copyToClipboard } = useClipboard();

function toggleReveal(id: string) {
  const s = revealedKeys.value;
  if (s.has(id)) {
    s.delete(id);
  } else {
    s.add(id);
  }
  // Trigger reactivity
  revealedKeys.value = new Set(s);
}

function toggleModel(model: string, val: boolean | "indeterminate") {
  const models = form.value.allowed_models;
  if (val === true && !models.includes(model)) {
    models.push(model);
  } else if (!val) {
    const idx = models.indexOf(model);
    if (idx >= 0) models.splice(idx, 1);
  }
}

function removeModel(model: string) {
  const models = form.value.allowed_models;
  const idx = models.indexOf(model);
  if (idx >= 0) models.splice(idx, 1);
}

// Dialogs
function openCreate() {
  editingKey.value = null;
  form.value = { name: "", allowed_models: [], is_active: true };
  modelFilter.value = "";
  errors.value = {};
  editDialogOpen.value = true;
}

function openEdit(k: RouterKey) {
  editingKey.value = k;
  form.value = {
    name: k.name,
    allowed_models: k.allowed_models ? [...k.allowed_models] : [],
    is_active: !!k.is_active,
  };
  modelFilter.value = "";
  errors.value = {};
  editDialogOpen.value = true;
}

function openDelete(k: RouterKey) {
  deleteTarget.value = k;
}

async function handleSave() {
  const errs: Record<string, string> = {};
  const name = form.value.name.trim();
  if (!name) errs.name = t("routerKeys.nameRequired");
  errors.value = errs;
  if (Object.keys(errs).length > 0) return;

  try {
    if (editingKey.value) {
      await api.updateRouterKey(editingKey.value.id, {
        name: form.value.name,
        allowed_models:
          form.value.allowed_models.length > 0
            ? form.value.allowed_models
            : null,
        is_active: form.value.is_active ? 1 : 0,
      });
      editDialogOpen.value = false;
      await loadData();
    } else {
      const res = await api.createRouterKey({
        name: form.value.name,
        allowed_models:
          form.value.allowed_models.length > 0
            ? form.value.allowed_models
            : null,
      });
      editDialogOpen.value = false;
      createdKeyValue.value = res.key;
      revealCopied.value = false;
      revealDialogOpen.value = true;
      await loadData();
    }
  } catch (e: unknown) {
    console.error("routerKeys.save:", e);
    toast.error(getApiMessage(e, t("routerKeys.saveFailed")));
  }
}

async function handleToggleActive(k: RouterKey) {
  try {
    await api.updateRouterKey(k.id, { is_active: k.is_active ? 0 : 1 });
    await loadData();
  } catch (e: unknown) {
    console.error("routerKeys.toggleActive:", e);
    toast.error(getApiMessage(e, t("routerKeys.toggleActiveFailed")));
  }
}

async function handleDelete() {
  const target = deleteTarget.value;
  if (!target) return;
  deleteTarget.value = null;
  try {
    await api.deleteRouterKey(target.id);
    await loadData();
  } catch (e: unknown) {
    console.error("routerKeys.delete:", e);
    toast.error(getApiMessage(e, t("routerKeys.deleteFailed")));
  }
}

// Data loading
async function loadData() {
  try {
    const init = await api.getRouterKeysInit();
    keys.value = init.keys;
    availableModels.value = init.available_models;
  } catch (e: unknown) {
    console.error("routerKeys.load:", e);
    toast.error(getApiMessage(e, t("routerKeys.loadFailed")));
  }
}

onMounted(loadData);
</script>

<style scoped>
:deep(tbody tr) {
  @apply border-b border-border transition-colors duration-100;
}
:deep(tbody tr:last-child) {
  @apply border-b-0;
}
:deep(tbody tr:hover) {
  @apply bg-accent;
}
</style>
