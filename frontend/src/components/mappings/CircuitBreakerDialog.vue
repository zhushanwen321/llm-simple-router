<script setup lang="ts">
import { ref, watch, computed } from "vue";
import { useI18n } from "vue-i18n";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { CircuitBreakerConfig, MappingTarget } from "@/types/mapping";

const props = defineProps<{
  target: MappingTarget;
  modelValue: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [open: boolean];
  save: [config: CircuitBreakerConfig | undefined];
}>();

const { t } = useI18n();

const DEFAULT_WINDOW_SEC = 60;
const DEFAULT_FAILURE_RATE = 0.9;
const DEFAULT_MIN_SAMPLES = 10;
const DEFAULT_COOLDOWN_SEC = 300;
const FAILURE_RATE_PERCENT = 100;

const enabled = ref(false);
const windowSec = ref<number>(DEFAULT_WINDOW_SEC);
const failureRatePct = ref<number>(DEFAULT_FAILURE_RATE * FAILURE_RATE_PERCENT);
const minSamples = ref<number>(DEFAULT_MIN_SAMPLES);
const cooldownSec = ref<number>(DEFAULT_COOLDOWN_SEC);
const statusCodesText = ref("");

function loadFromTarget() {
  const cb = props.target.circuit_breaker;
  enabled.value = cb?.enabled ?? false;
  windowSec.value = cb?.window_sec ?? DEFAULT_WINDOW_SEC;
  failureRatePct.value =
    (cb?.failure_rate ?? DEFAULT_FAILURE_RATE) * FAILURE_RATE_PERCENT;
  minSamples.value = cb?.min_samples ?? DEFAULT_MIN_SAMPLES;
  cooldownSec.value = cb?.cooldown_sec ?? DEFAULT_COOLDOWN_SEC;
  statusCodesText.value =
    cb?.status_codes?.map((c) => c.toString()).join(",") ?? "";
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) loadFromTarget();
  },
);

const parsedStatusCodes = computed<number[] | undefined>(() => {
  const trimmed = statusCodesText.value.trim();
  if (!trimmed) return undefined;
  return trimmed
    .split(/[,\s]+/)
    .map((s) => Number.parseInt(s, 10))
    .filter((n) => !Number.isNaN(n));
});

function close() {
  emit("update:modelValue", false);
}

function handleSave() {
  emit("save", {
    enabled: enabled.value,
    window_sec: windowSec.value,
    failure_rate: failureRatePct.value / FAILURE_RATE_PERCENT,
    min_samples: minSamples.value,
    cooldown_sec: cooldownSec.value,
    status_codes: parsedStatusCodes.value,
  });
  close();
}

function handleClear() {
  emit("save", undefined);
  close();
}
</script>

<template>
  <Dialog
    :open="modelValue"
    @update:open="(v: boolean) => emit('update:modelValue', v)"
  >
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{{ t("mappings.circuitBreaker.title") }}</DialogTitle>
        <DialogDescription>{{
          t("mappings.circuitBreaker.description")
        }}</DialogDescription>
      </DialogHeader>

      <div class="space-y-4 py-2">
        <div class="flex items-center justify-between">
          <Label for="cb-enabled">{{
            t("mappings.circuitBreaker.enabled")
          }}</Label>
          <Switch id="cb-enabled" v-model="enabled" />
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div class="space-y-1">
            <Label for="cb-window">{{
              t("mappings.circuitBreaker.windowSec")
            }}</Label>
            <Input
              id="cb-window"
              v-model.number="windowSec"
              type="number"
              :min="1"
            />
          </div>
          <div class="space-y-1">
            <Label for="cb-failure">{{
              t("mappings.circuitBreaker.failureRate")
            }}</Label>
            <Input
              id="cb-failure"
              v-model.number="failureRatePct"
              type="number"
              :min="0"
              :max="100"
            />
          </div>
          <div class="space-y-1">
            <Label for="cb-min-samples">{{
              t("mappings.circuitBreaker.minSamples")
            }}</Label>
            <Input
              id="cb-min-samples"
              v-model.number="minSamples"
              type="number"
              :min="1"
            />
          </div>
          <div class="space-y-1">
            <Label for="cb-cooldown">{{
              t("mappings.circuitBreaker.cooldownSec")
            }}</Label>
            <Input
              id="cb-cooldown"
              v-model.number="cooldownSec"
              type="number"
              :min="1"
            />
          </div>
        </div>

        <div class="space-y-1">
          <Label for="cb-status-codes">{{
            t("mappings.circuitBreaker.statusCodes")
          }}</Label>
          <Input
            id="cb-status-codes"
            v-model="statusCodesText"
            :placeholder="t('mappings.circuitBreaker.statusCodesPlaceholder')"
          />
          <p class="text-xs text-muted-foreground">
            {{ t("mappings.circuitBreaker.statusCodesHint") }}
          </p>
        </div>
      </div>

      <DialogFooter class="gap-2 sm:gap-2">
        <Button
          variant="ghost"
          class="text-destructive hover:text-destructive"
          @click="handleClear"
        >
          {{ t("mappings.circuitBreaker.clear") }}
        </Button>
        <span class="flex-1" />
        <Button variant="outline" @click="close">{{
          t("mappings.circuitBreaker.cancel")
        }}</Button>
        <Button @click="handleSave">{{
          t("mappings.circuitBreaker.save")
        }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
