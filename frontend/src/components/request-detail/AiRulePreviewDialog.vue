<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="sm:max-w-xl">
      <DialogHeader class="gap-1.5">
        <div class="flex items-center gap-2">
          <Sparkles class="h-4 w-4 text-primary shrink-0" />
          <DialogTitle>{{ t("logs.aiGeneratedRule") }}</DialogTitle>
        </div>
        <Badge variant="secondary" class="w-fit text-[10px]">
          {{ t("logs.aiGenerated") }}
        </Badge>
      </DialogHeader>

      <!-- AI analysis summary -->
      <div
        v-if="summary"
        class="rounded-lg border border-success/20 bg-success/5 px-3 py-2.5 flex items-start gap-2.5"
      >
        <div
          class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-success/10 mt-0.5"
        >
          <CheckCircle2 class="h-3 w-3 text-success" />
        </div>
        <p class="text-sm text-success-foreground leading-relaxed">
          {{ summary }}
        </p>
      </div>

      <!-- Editable form -->
      <div class="space-y-4">
        <!-- Basic info -->
        <div class="space-y-3">
          <div>
            <Label class="text-xs text-muted-foreground font-medium">
              {{ t("retryRules.dialog.name") }}
            </Label>
            <Input v-model="form.name" type="text" class="mt-1" />
          </div>
          <div>
            <Label class="text-xs text-muted-foreground font-medium">
              {{ t("retryRules.provider") }}
            </Label>
            <Select v-model="form.provider_id">
              <SelectTrigger class="mt-1">
                <SelectValue
                  :placeholder="t('retryRules.providerPlaceholder')"
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">{{
                  t("retryRules.providerAll")
                }}</SelectItem>
                <SelectItem v-for="p in providers" :key="p.id" :value="p.id">
                  {{ p.name }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <!-- Match conditions -->
        <div class="rounded-lg border bg-muted/30 p-3 space-y-3">
          <p
            class="text-xs font-medium text-muted-foreground uppercase tracking-wide"
          >
            {{ t("logs.matchConditions") }}
          </p>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <Label class="text-xs text-muted-foreground font-medium">
                {{ t("retryRules.dialog.statusCode") }}
              </Label>
              <Input
                v-model.number="form.status_code"
                type="number"
                class="mt-1"
              />
            </div>
            <div>
              <Label class="text-xs text-muted-foreground font-medium">
                {{ t("retryRules.dialog.retryStrategy") }}
              </Label>
              <Select v-model="form.retry_strategy">
                <SelectTrigger class="mt-1">
                  <SelectValue />
                </SelectTrigger>
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
          </div>
          <div>
            <Label class="text-xs text-muted-foreground font-medium">
              {{ t("retryRules.dialog.bodyPattern") }}
            </Label>
            <Textarea
              v-model="form.body_pattern"
              class="font-mono mt-1"
              :rows="2"
            />
          </div>
        </div>

        <!-- Retry params -->
        <div class="rounded-lg border bg-muted/30 p-3 space-y-3">
          <p
            class="text-xs font-medium text-muted-foreground uppercase tracking-wide"
          >
            {{ t("logs.retryParams") }}
          </p>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <Label class="text-xs text-muted-foreground font-medium">
                {{
                  form.retry_strategy === "fixed"
                    ? t("retryRules.dialog.intervalMs")
                    : t("retryRules.dialog.initialDelayMs")
                }}
              </Label>
              <Input
                v-model.number="form.retry_delay_ms"
                type="number"
                class="mt-1"
              />
            </div>
            <div>
              <Label class="text-xs text-muted-foreground font-medium">
                {{ t("retryRules.dialog.maxRetries") }}
              </Label>
              <Input
                v-model.number="form.max_retries"
                type="number"
                class="mt-1"
              />
            </div>
          </div>
          <div v-if="form.retry_strategy === 'exponential'">
            <Label class="text-xs text-muted-foreground font-medium">
              {{ t("retryRules.dialog.maxDelayMs") }}
            </Label>
            <Input
              v-model.number="form.max_delay_ms"
              type="number"
              class="mt-1"
            />
          </div>
        </div>

        <!-- Enable switch -->
        <div class="flex items-center gap-2.5 pt-1">
          <Switch
            :checked="form.is_active"
            @update:checked="form.is_active = $event"
            id="rule-active"
          />
          <Label
            for="rule-active"
            class="text-sm text-foreground cursor-pointer"
          >
            {{ t("retryRules.dialog.enable") }}
          </Label>
        </div>
      </div>

      <DialogFooter class="border-t pt-4 mt-2">
        <Button variant="outline" @click="emit('update:open', false)">
          {{ t("common.cancel") }}
        </Button>
        <Button :disabled="saving" @click="handleSave">
          {{ t("logs.saveRule") }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import { api, getApiMessage } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sparkles, CheckCircle2 } from "lucide-vue-next";

interface RuleFormData {
  name: string;
  status_code: number;
  body_pattern: string;
  retry_strategy: "fixed" | "exponential";
  retry_delay_ms: number;
  max_retries: number;
  max_delay_ms: number;
  provider_id: string | null;
}

interface RuleForm extends RuleFormData {
  is_active: boolean;
}

const { t } = useI18n();

// 校验常量
const STATUS_CODE_MIN = 100;
const STATUS_CODE_MAX = 599;
const DELAY_MIN_MS = 100;
const MAX_RETRIES_LIMIT = 100;

const props = defineProps<{
  open: boolean;
  rule: RuleFormData | null;
  summary: string;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  saved: [];
}>();

function createDefaultForm(): RuleForm {
  return {
    name: "",
    status_code: 429,
    body_pattern: "",
    retry_strategy: "exponential",
    retry_delay_ms: 5000,
    max_retries: 10,
    max_delay_ms: 60000,
    is_active: true,
    provider_id: "__all__",
  };
}

const form = ref<RuleForm>(createDefaultForm());

watch(
  [() => props.open, () => props.rule],
  ([open, rule]) => {
    if (open && rule) {
      form.value = { ...rule, is_active: true, provider_id: "__all__" };
      saving.value = false;
      loadProviders();
    }
  },
  { immediate: true },
);

const providers = ref<{ id: string; name: string }[]>([]);

async function loadProviders() {
  try {
    providers.value = await api.getProviders();
  } catch (e: unknown) {
    console.error("AiRulePreviewDialog.loadProviders:", e);
    toast.error(getApiMessage(e, t("logs.messages.loadProvidersFailed")));
  }
}

const saving = ref(false);

async function handleSave() {
  if (saving.value) return;

  // 客户端校验
  const errors: string[] = [];
  if (!form.value.name.trim())
    errors.push(t("retryRules.messages.nameRequired"));
  const sc = form.value.status_code;
  if (
    typeof sc !== "number" ||
    isNaN(sc) ||
    sc < STATUS_CODE_MIN ||
    sc > STATUS_CODE_MAX
  )
    errors.push(t("retryRules.messages.statusCodeRange"));
  try {
    new RegExp(form.value.body_pattern);
  } catch {
    errors.push(t("retryRules.messages.bodyPatternInvalid"));
  }
  if (!form.value.body_pattern.trim())
    errors.push(t("retryRules.messages.bodyPatternInvalid"));
  const rd = form.value.retry_delay_ms;
  if (typeof rd !== "number" || isNaN(rd) || rd < DELAY_MIN_MS)
    errors.push(t("retryRules.messages.delayMin"));
  const mr = form.value.max_retries;
  if (typeof mr !== "number" || isNaN(mr) || mr < 0 || mr > MAX_RETRIES_LIMIT)
    errors.push(t("retryRules.messages.retriesRange"));
  const md = form.value.max_delay_ms;
  if (
    form.value.retry_strategy === "exponential" &&
    (typeof md !== "number" || isNaN(md) || md < DELAY_MIN_MS)
  )
    errors.push(t("retryRules.messages.delayMin"));

  if (errors.length > 0) {
    toast.error(errors.join("; "));
    return;
  }

  saving.value = true;
  try {
    await api.createRetryRule({
      name: form.value.name,
      status_code: Number(form.value.status_code),
      body_pattern: form.value.body_pattern,
      is_active: form.value.is_active ? 1 : 0,
      retry_strategy: form.value.retry_strategy,
      retry_delay_ms: Number(form.value.retry_delay_ms),
      max_retries: Number(form.value.max_retries),
      max_delay_ms:
        form.value.retry_strategy === "exponential"
          ? Number(form.value.max_delay_ms)
          : undefined,
      provider_id:
        form.value.provider_id === "__all__"
          ? null
          : form.value.provider_id || null,
    });
    toast.success(t("retryRules.messages.saveCompleted"));
    emit("saved");
    emit("update:open", false);
  } catch (e: unknown) {
    console.error("AiRulePreviewDialog.handleSave:", e);
    toast.error(getApiMessage(e, t("retryRules.messages.saveFailed")));
  } finally {
    saving.value = false;
  }
}
</script>
