<template>
  <div class="p-6">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-semibold text-foreground">
        {{ t("retryRules.title") }}
      </h2>
      <Button @click="openCreate" class="flex items-center gap-1">
        <Plus class="w-4 h-4" />
        {{ t("retryRules.addRule") }}
      </Button>
    </div>

    <div class="bg-card rounded-lg border overflow-hidden">
      <Table class="[&_td]:px-4 [&_th]:px-4">
        <TableHeader>
          <TableRow class="bg-muted">
            <TableHead class="text-muted-foreground">{{
              t("retryRules.tableHeaders.name")
            }}</TableHead>
            <TableHead class="text-muted-foreground">{{
              t("retryRules.tableHeaders.statusCode")
            }}</TableHead>
            <TableHead class="text-muted-foreground">{{
              t("retryRules.tableHeaders.bodyPattern")
            }}</TableHead>
            <TableHead class="text-muted-foreground">{{
              t("retryRules.tableHeaders.provider")
            }}</TableHead>
            <TableHead class="text-muted-foreground">{{
              t("retryRules.tableHeaders.retryStrategy")
            }}</TableHead>
            <TableHead class="text-muted-foreground">{{
              t("retryRules.tableHeaders.status")
            }}</TableHead>
            <TableHead class="text-right text-muted-foreground">{{
              t("retryRules.tableHeaders.actions")
            }}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="r in rules" :key="r.id">
            <TableCell class="font-mono text-sm">{{ r.name }}</TableCell>
            <TableCell>{{ r.status_code }}</TableCell>
            <TableCell
              class="font-mono text-xs text-muted-foreground max-w-[200px]"
              ><span class="truncate block">{{
                formatBodyMatch(r)
              }}</span></TableCell
            >
            <TableCell>
              <Badge v-if="!r.provider_id" variant="secondary">{{
                t("retryRules.globalBadge")
              }}</Badge>
              <span v-else>{{ getProviderName(r.provider_id) }}</span>
            </TableCell>
            <TableCell>
              <div class="flex items-center gap-2">
                <Badge variant="outline">
                  {{
                    r.retry_strategy === "fixed"
                      ? t("retryRules.strategy.fixed")
                      : t("retryRules.strategy.exponential")
                  }}
                </Badge>
                <span class="text-xs text-muted-foreground">
                  {{ r.retry_delay_ms / 1000 }}s ·
                  {{ t("retryRules.times", { count: r.max_retries }) }}
                  <template v-if="r.retry_strategy === 'exponential'">
                    ·
                    {{
                      t("retryRules.upperLimit", {
                        value: r.max_delay_ms / 1000,
                      })
                    }}
                  </template>
                </span>
              </div>
            </TableCell>
            <TableCell>
              <Badge :variant="r.is_active ? 'default' : 'secondary'">
                {{ r.is_active ? t("common.enabled") : t("common.disabled") }}
              </Badge>
            </TableCell>
            <TableCell class="text-right">
              <Button
                variant="ghost"
                size="sm"
                @click="openEdit(r)"
                class="mr-2"
                >{{ t("common.edit") }}</Button
              >
              <Button
                variant="ghost"
                size="sm"
                class="text-destructive hover:text-destructive"
                @click="confirmDelete(r)"
                >{{ t("common.delete") }}</Button
              >
            </TableCell>
          </TableRow>
          <TableRow v-if="rules.length === 0">
            <TableCell
              colspan="7"
              class="text-center text-muted-foreground py-8"
              >{{ t("retryRules.noRules") }}</TableCell
            >
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <!-- Create/Edit Dialog -->
    <Dialog v-model:open="dialogOpen">
      <DialogContent class="max-w-lg">
        <DialogHeader>
          <DialogTitle>{{
            editingId
              ? t("retryRules.dialog.editRule")
              : t("retryRules.dialog.addRule")
          }}</DialogTitle>
        </DialogHeader>
        <form @submit.prevent="handleSave" class="space-y-3">
          <div>
            <Label class="block text-sm font-medium text-foreground mb-1">{{
              t("retryRules.dialog.name")
            }}</Label>
            <Input
              v-model="form.name"
              type="text"
              required
              @input="delete errors.name"
            />
            <p v-if="errors.name" class="text-sm text-destructive mt-1">
              {{ errors.name }}
            </p>
          </div>
          <div>
            <Label class="block text-sm font-medium text-foreground mb-1">{{
              t("retryRules.provider")
            }}</Label>
            <Select v-model="form.provider_id">
              <SelectTrigger class="w-full"
                ><SelectValue
                  :placeholder="t('retryRules.providerPlaceholder')"
              /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">{{
                  t("retryRules.providerAll")
                }}</SelectItem>
                <SelectItem v-for="p in providers" :key="p.id" :value="p.id">{{
                  p.name
                }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label class="block text-sm font-medium text-foreground mb-1">{{
              t("retryRules.dialog.statusCode")
            }}</Label>
            <Input
              v-model.number="form.status_code"
              type="number"
              required
              @input="delete errors.status_code"
            />
            <p v-if="errors.status_code" class="text-sm text-destructive mt-1">
              {{ errors.status_code }}
            </p>
          </div>
          <!-- Body Match: Tabs -->
          <div>
            <Label
              class="block text-sm font-medium text-foreground mb-1 flex items-center gap-1"
              >{{ t("retryRules.dialog.bodyPattern") }}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger as-child>
                    <span
                      class="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-muted text-muted-foreground text-[10px] font-bold cursor-help"
                      >?</span
                    >
                  </TooltipTrigger>
                  <TooltipContent
                    side="right"
                    class="max-w-xs text-xs leading-relaxed"
                  >
                    <p class="font-medium mb-1">
                      {{ t("retryRules.dialog.bodyPattern") }}
                    </p>
                    <p>{{ t("retryRules.dialog.bodyPatternTooltip") }}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </Label>
            <Tabs v-model="form.matchMode">
              <TabsList class="mb-2">
                <TabsTrigger value="regex">{{
                  t("retryRules.regexMatch")
                }}</TabsTrigger>
                <TabsTrigger value="json">{{
                  t("retryRules.jsonMatch")
                }}</TabsTrigger>
              </TabsList>
              <TabsContent value="regex">
                <Input
                  v-model="form.body_pattern"
                  type="text"
                  :placeholder="t('retryRules.dialog.bodyPatternPlaceholder')"
                  @input="delete errors.body_pattern"
                />
                <p
                  v-if="errors.body_pattern"
                  class="text-sm text-destructive mt-1"
                >
                  {{ errors.body_pattern }}
                </p>
              </TabsContent>
              <TabsContent value="json">
                <div class="space-y-2">
                  <div
                    v-for="(m, idx) in form.bodyMatchers"
                    :key="idx"
                    class="flex items-start gap-2"
                  >
                    <Input
                      v-model="m.path"
                      :placeholder="t('retryRules.fieldPath')"
                      class="flex-1"
                    />
                    <Select v-model="m.operator">
                      <SelectTrigger class="w-28 shrink-0"
                        ><SelectValue
                      /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="equals">{{
                          t("retryRules.operatorEquals")
                        }}</SelectItem>
                        <SelectItem value="contains">{{
                          t("retryRules.operatorContains")
                        }}</SelectItem>
                        <SelectItem value="exists">{{
                          t("retryRules.operatorExists")
                        }}</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      v-if="m.operator !== 'exists'"
                      v-model="m.value"
                      :placeholder="t('retryRules.matchValue')"
                      class="flex-1"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      class="shrink-0 text-muted-foreground"
                      @click="removeMatcher(idx)"
                    >
                      <X class="w-4 h-4" />
                    </Button>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    @click="addMatcher"
                  >
                    <Plus class="w-3 h-3 mr-1" />
                    {{ t("retryRules.addCondition") }}
                  </Button>
                  <p
                    v-if="errors.body_matchers"
                    class="text-sm text-destructive mt-1"
                  >
                    {{ errors.body_matchers }}
                  </p>
                </div>
              </TabsContent>
            </Tabs>
          </div>
          <div>
            <Label class="block text-sm font-medium text-foreground mb-1">{{
              t("retryRules.dialog.retryStrategy")
            }}</Label>
            <Select v-model="form.retry_strategy">
              <SelectTrigger class="w-full"
                ><SelectValue
                  :placeholder="t('retryRules.dialog.selectStrategy')"
              /></SelectTrigger>
              <SelectContent>
                <SelectItem value="exponential">{{
                  t("retryRules.strategy.exponential")
                }}</SelectItem>
                <SelectItem value="fixed">{{
                  t("retryRules.strategy.fixed")
                }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <Label class="block text-sm font-medium text-foreground mb-1">
                {{
                  form.retry_strategy === "fixed"
                    ? t("retryRules.dialog.intervalMs")
                    : t("retryRules.dialog.initialDelayMs")
                }}
              </Label>
              <Input
                v-model.number="form.retry_delay_ms"
                type="number"
                :min="100"
                required
                @input="delete errors.retry_delay_ms"
              />
              <p
                v-if="errors.retry_delay_ms"
                class="text-sm text-destructive mt-1"
              >
                {{ errors.retry_delay_ms }}
              </p>
            </div>
            <div>
              <Label class="block text-sm font-medium text-foreground mb-1">{{
                t("retryRules.dialog.maxRetries")
              }}</Label>
              <Input
                v-model.number="form.max_retries"
                type="number"
                :min="0"
                :max="100"
                required
                @input="delete errors.max_retries"
              />
              <p
                v-if="errors.max_retries"
                class="text-sm text-destructive mt-1"
              >
                {{ errors.max_retries }}
              </p>
            </div>
          </div>
          <div v-if="form.retry_strategy === 'exponential'">
            <Label class="block text-sm font-medium text-foreground mb-1">{{
              t("retryRules.dialog.maxDelayMs")
            }}</Label>
            <Input
              v-model.number="form.max_delay_ms"
              type="number"
              :min="100"
              required
              @input="delete errors.max_delay_ms"
            />
            <p v-if="errors.max_delay_ms" class="text-sm text-destructive mt-1">
              {{ errors.max_delay_ms }}
            </p>
          </div>
          <div class="flex items-center gap-2">
            <Checkbox v-model="form.is_active" id="rule-active" />
            <Label for="rule-active" class="text-sm text-foreground">{{
              t("retryRules.dialog.enable")
            }}</Label>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              @click="dialogOpen = false"
              >{{ t("common.cancel") }}</Button
            >
            <Button type="submit">{{ t("common.save") }}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <!-- Delete Confirm -->
    <AlertDialog
      :open="!!deleteTarget"
      @update:open="
        (val) => {
          if (!val) deleteTarget = null;
        }
      "
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{
            t("retryRules.deleteConfirm.title")
          }}</AlertDialogTitle>
          <AlertDialogDescription>{{
            t("retryRules.deleteConfirm.description", {
              name: deleteTarget?.name,
            })
          }}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{{ t("common.cancel") }}</AlertDialogCancel>
          <Button variant="destructive" @click="handleDelete">{{
            t("common.delete")
          }}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <RecommendedRules :rules="recommendedRules" @added="onRecommendedAdded" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import { api, getApiMessage, type RecommendedRetryRule } from "@/api/client";
import type { Provider } from "@/types/mapping";
import type { RetryRule } from "@/types/models";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Plus, X } from "lucide-vue-next";
import RecommendedRules from "@/components/retry-rules/RecommendedRules.vue";

const { t } = useI18n();

interface BodyMatcher {
  path: string;
  operator: string;
  value: string;
}
interface FormData {
  name: string;
  status_code: number;
  body_pattern: string;
  provider_id: string;
  is_active: boolean;
  retry_strategy: "fixed" | "exponential";
  retry_delay_ms: number;
  max_retries: number;
  max_delay_ms: number;
  matchMode: "regex" | "json";
  bodyMatchers: BodyMatcher[];
}

const DEFAULT_FORM: FormData = {
  name: "",
  status_code: 429,
  body_pattern: "",
  provider_id: "__all__",
  is_active: true,
  retry_strategy: "exponential",
  retry_delay_ms: 5000,
  max_retries: 10,
  max_delay_ms: 60000,
  matchMode: "regex",
  bodyMatchers: [],
};

const rules = ref<RetryRule[]>([]);
const providers = ref<Provider[]>([]);
const dialogOpen = ref(false);
const editingId = ref<string | null>(null);
const deleteTarget = ref<RetryRule | null>(null);
const form = ref<FormData>({ ...DEFAULT_FORM, bodyMatchers: [] });
const errors = ref<Record<string, string>>({});
const recommendedRules = ref<RecommendedRetryRule[]>([]);

const MIN_STATUS_CODE = 100;
const MAX_STATUS_CODE = 599;
const MIN_DELAY_MS = 100;
const MAX_RETRIES = 100;

const OPERATOR_LABELS: Record<string, string> = {
  equals: t("retryRules.operatorEquals"),
  contains: t("retryRules.operatorContains"),
  exists: t("retryRules.operatorExists"),
};

function getProviderName(id: string): string {
  const p = providers.value.find((pr) => pr.id === id);
  return p ? p.name : id;
}

function formatBodyMatch(r: RetryRule): string {
  if (r.body_matchers) {
    try {
      const matchers = JSON.parse(r.body_matchers) as BodyMatcher[];
      return matchers
        .map((m) => {
          const op = OPERATOR_LABELS[m.operator] ?? m.operator;
          return m.operator === "exists"
            ? `${m.path} ${op}`
            : `${m.path} ${op} "${m.value}"`;
        })
        .join(", ");
    } catch {
      return r.body_matchers;
    }
  }
  return r.body_pattern;
}

function addMatcher() {
  form.value.bodyMatchers.push({ path: "", operator: "contains", value: "" });
}

function removeMatcher(idx: number) {
  form.value.bodyMatchers.splice(idx, 1);
}

function validate(): boolean {
  const errs: Record<string, string> = {};
  if (!form.value.name.trim())
    errs.name = t("retryRules.validation.nameRequired");

  const sc = Number(form.value.status_code);
  if (!Number.isInteger(sc) || sc < MIN_STATUS_CODE || sc > MAX_STATUS_CODE)
    errs.status_code = t("retryRules.validation.statusCodeRange", {
      min: MIN_STATUS_CODE,
      max: MAX_STATUS_CODE,
    });

  if (form.value.matchMode === "regex") {
    if (!form.value.body_pattern.trim())
      errs.body_pattern = t("retryRules.validation.bodyPatternRequired");
    else {
      try {
        new RegExp(form.value.body_pattern);
      } catch {
        errs.body_pattern = t("retryRules.validation.bodyPatternInvalid");
      }
    }
  } else {
    const valid = form.value.bodyMatchers.some(
      (m) => m.path.trim() && (m.operator === "exists" || m.value.trim()),
    );
    if (!valid)
      errs.body_matchers = t("retryRules.validation.bodyPatternRequired");
  }

  const delay = Number(form.value.retry_delay_ms);
  if (!delay || delay < MIN_DELAY_MS)
    errs.retry_delay_ms = t("retryRules.validation.delayMin", {
      min: MIN_DELAY_MS,
    });

  const retries = Number(form.value.max_retries);
  if (!Number.isInteger(retries) || retries < 0 || retries > MAX_RETRIES)
    errs.max_retries = t("retryRules.validation.retriesRange", {
      max: MAX_RETRIES,
    });

  if (form.value.retry_strategy === "exponential") {
    const maxDelay = Number(form.value.max_delay_ms);
    if (!maxDelay || maxDelay < MIN_DELAY_MS)
      errs.max_delay_ms = t("retryRules.validation.delayMin", {
        min: MIN_DELAY_MS,
      });
  }

  errors.value = errs;
  return Object.keys(errs).length === 0;
}

async function loadData() {
  try {
    rules.value = await api.getRetryRules();
  } catch (e: unknown) {
    console.error("RetryRules.loadData:", e);
    toast.error(getApiMessage(e, t("retryRules.messages.loadFailed")));
  }
}

async function loadProviders() {
  try {
    providers.value = await api.getProviders();
  } catch (e: unknown) {
    console.error("RetryRules.loadProviders:", e);
    toast.error(getApiMessage(e, t("retryRules.messages.loadFailed")));
  }
}

async function loadRecommended() {
  try {
    recommendedRules.value = await api.recommended.getRetryRules();
  } catch {
    recommendedRules.value = [];
  }
}

function openCreate() {
  editingId.value = null;
  form.value = { ...DEFAULT_FORM, bodyMatchers: [] };
  errors.value = {};
  dialogOpen.value = true;
}

function openEdit(r: RetryRule) {
  editingId.value = r.id;
  let matchMode: "regex" | "json" = "regex";
  let bodyMatchers: BodyMatcher[] = [];
  if (r.body_matchers) {
    matchMode = "json";
    try {
      bodyMatchers = JSON.parse(r.body_matchers) as BodyMatcher[];
    } catch {
      bodyMatchers = [];
    }
  }
  form.value = {
    name: r.name,
    status_code: r.status_code,
    body_pattern: r.body_pattern,
    provider_id: r.provider_id ?? "__all__",
    is_active: !!r.is_active,
    retry_strategy: r.retry_strategy,
    retry_delay_ms: r.retry_delay_ms,
    max_retries: r.max_retries,
    max_delay_ms: r.max_delay_ms,
    matchMode,
    bodyMatchers,
  };
  errors.value = {};
  dialogOpen.value = true;
}

async function handleSave() {
  if (!validate()) return;
  try {
    const body_matchers =
      form.value.matchMode === "json"
        ? JSON.stringify(
          form.value.bodyMatchers.filter(
            (m) =>
              m.path.trim() && (m.operator === "exists" || m.value.trim()),
          ),
        )
        : null;
    const payload = {
      name: form.value.name,
      status_code: Number(form.value.status_code),
      body_pattern: form.value.body_pattern,
      provider_id:
        form.value.provider_id === "__all__" ? null : form.value.provider_id,
      body_matchers,
      is_active: form.value.is_active ? 1 : 0,
      retry_strategy: form.value.retry_strategy,
      retry_delay_ms: Number(form.value.retry_delay_ms),
      max_retries: Number(form.value.max_retries),
      max_delay_ms: Number(form.value.max_delay_ms),
    };
    if (editingId.value) await api.updateRetryRule(editingId.value, payload);
    else await api.createRetryRule(payload);
    dialogOpen.value = false;
    await loadData();
  } catch (e: unknown) {
    console.error("RetryRules.handleSave:", e);
    toast.error(getApiMessage(e, t("retryRules.messages.saveFailed")));
  }
}

function confirmDelete(r: RetryRule) {
  deleteTarget.value = r;
}

async function handleDelete() {
  const target = deleteTarget.value;
  if (!target) return;
  deleteTarget.value = null;
  try {
    await api.deleteRetryRule(target.id);
    await loadData();
  } catch (e: unknown) {
    console.error("RetryRules.handleDelete:", e);
    toast.error(getApiMessage(e, t("retryRules.messages.deleteFailed")));
  }
}

async function onRecommendedAdded() {
  await Promise.allSettled([loadRecommended(), loadData()]);
}

onMounted(() => {
  loadData();
  loadRecommended();
  loadProviders();
});
</script>
