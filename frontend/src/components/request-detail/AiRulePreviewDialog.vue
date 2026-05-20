<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="max-w-lg">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <Sparkles class="h-4 w-4 text-primary shrink-0" />
          {{ t("logs.aiGeneratedRule") }}
          <Badge variant="secondary" class="text-[10px] ml-auto">{{
            t("logs.aiGenerated")
          }}</Badge>
        </DialogTitle>
      </DialogHeader>

      <!-- AI analysis summary -->
      <div
        v-if="summary"
        class="rounded-md bg-success/10 px-3 py-2 flex items-start gap-2"
      >
        <CheckCircle2 class="h-4 w-4 text-success mt-0.5 shrink-0" />
        <p class="text-sm text-success-foreground">{{ summary }}</p>
      </div>

      <!-- Editable form -->
      <div class="space-y-3">
        <div>
          <Label>{{ t("retryRules.dialog.name") }}</Label>
          <Input v-model="form.name" type="text" />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <Label>{{ t("retryRules.dialog.statusCode") }}</Label>
            <Input v-model.number="form.status_code" type="number" />
          </div>
          <div>
            <Label>{{ t("retryRules.dialog.retryStrategy") }}</Label>
            <Select v-model="form.retry_strategy">
              <SelectTrigger>
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
          <Label>{{ t("retryRules.dialog.bodyPattern") }}</Label>
          <Textarea v-model="form.body_pattern" class="font-mono" :rows="2" />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <Label>{{
              form.retry_strategy === "fixed"
                ? t("retryRules.dialog.intervalMs")
                : t("retryRules.dialog.initialDelayMs")
            }}</Label>
            <Input v-model.number="form.retry_delay_ms" type="number" />
          </div>
          <div>
            <Label>{{ t("retryRules.dialog.maxRetries") }}</Label>
            <Input v-model.number="form.max_retries" type="number" />
          </div>
        </div>
        <div v-if="form.retry_strategy === 'exponential'">
          <Label>{{ t("retryRules.dialog.maxDelayMs") }}</Label>
          <Input v-model.number="form.max_delay_ms" type="number" />
        </div>
        <div class="flex items-center gap-2">
          <Switch
            :checked="form.is_active"
            @update:checked="form.is_active = $event"
            id="rule-active"
          />
          <Label for="rule-active">{{ t("retryRules.dialog.enable") }}</Label>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="emit('update:open', false)">
          {{ t("common.cancel") }}
        </Button>
        <Button @click="handleSave">
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
  };
}

const form = ref<RuleForm>(createDefaultForm());

watch(
  () => props.rule,
  (rule) => {
    if (rule) {
      form.value = {
        ...rule,
        is_active: true,
      };
    } else {
      form.value = createDefaultForm();
    }
  },
  { immediate: true },
);

async function handleSave() {
  // 客户端校验
  const errors: string[] = [];
  if (!form.value.name.trim())
    errors.push(t("retryRules.messages.nameRequired"));
  if (
    form.value.status_code < STATUS_CODE_MIN ||
    form.value.status_code > STATUS_CODE_MAX
  )
    errors.push(t("retryRules.messages.statusCodeRange"));
  try {
    new RegExp(form.value.body_pattern);
  } catch {
    errors.push(t("retryRules.messages.bodyPatternInvalid"));
  }
  if (!form.value.body_pattern.trim())
    errors.push(t("retryRules.messages.bodyPatternInvalid"));
  if (form.value.retry_delay_ms < DELAY_MIN_MS)
    errors.push(t("retryRules.messages.delayMin"));
  if (form.value.max_retries < 0 || form.value.max_retries > MAX_RETRIES_LIMIT)
    errors.push(t("retryRules.messages.retriesRange"));
  if (
    form.value.max_delay_ms < DELAY_MIN_MS &&
    form.value.retry_strategy === "exponential"
  )
    errors.push(t("retryRules.messages.delayMin"));

  if (errors.length > 0) {
    toast.error(errors.join("；"));
    return;
  }

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
    });
    toast.success(t("retryRules.messages.saveCompleted"));
    emit("saved");
    emit("update:open", false);
  } catch (e: unknown) {
    console.error("AiRulePreviewDialog.handleSave:", e);
    toast.error(getApiMessage(e, t("retryRules.messages.saveFailed")));
  }
}
</script>
