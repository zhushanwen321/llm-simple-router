<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { Check } from "lucide-vue-next";
import { Badge } from "@/components/ui/badge";

const { t } = useI18n();

type StepState = "done" | "current" | "upcoming";

const props = defineProps<{
  currentStep: number;
  clientSelected: boolean;
  providerConfigured: boolean;
  mappingsCreated: boolean;
  retryRulesConfigured: boolean;
}>();

const steps = [
  { labelKey: "quickSetup.steps.selectClient", optional: false },
  { labelKey: "quickSetup.steps.configureProvider", optional: false },
  { labelKey: "quickSetup.steps.modelMappings", optional: false },
  { labelKey: "quickSetup.steps.retryRules", optional: true },
] as const;

const isDone = (i: number): boolean =>
  [
    props.clientSelected,
    props.providerConfigured,
    props.mappingsCreated,
    props.retryRulesConfigured,
  ][i];

const state = (i: number): StepState => {
  if (isDone(i)) return "done";
  return i === props.currentStep ? "current" : "upcoming";
};

const connectorDone = (i: number): boolean =>
  i < steps.length - 1 && (isDone(i) || state(i + 1) !== "upcoming");
</script>

<template>
  <!-- Grid: 7 columns = circle, line, circle, line, circle, line, circle -->
  <div
    class="grid items-start px-5 py-4"
    style="grid-template-columns: auto 1fr auto 1fr auto 1fr auto"
  >
    <template v-for="(step, i) in steps" :key="i">
      <!-- Step node -->
      <div class="flex flex-col items-center gap-1.5">
        <div
          class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold border-2 transition-all"
          :class="{
            'bg-primary border-primary text-primary-foreground':
              state(i) === 'done',
            'border-primary text-primary bg-primary/10': state(i) === 'current',
            'border-border text-muted-foreground': state(i) === 'upcoming',
          }"
        >
          <Check
            v-if="state(i) === 'done'"
            class="w-3.5 h-3.5"
            :stroke-width="3"
          />
          <template v-else>{{ i + 1 }}</template>
        </div>
        <span
          class="text-[11px] font-medium text-center leading-tight"
          :class="
            state(i) === 'current' ? 'text-foreground' : 'text-muted-foreground'
          "
        >
          {{ t(step.labelKey) }}
        </span>
        <Badge
          v-if="step.optional"
          class="text-[10px] h-4 px-1.5 font-normal bg-blue-500/12 text-blue-400"
        >
          {{ t("quickSetup.steps.optional") }}
        </Badge>
      </div>
      <!-- Connector line -->
      <div
        v-if="i < steps.length - 1"
        class="h-0.5 min-w-4 transition-colors mt-3.5"
        :class="connectorDone(i) ? 'bg-primary opacity-50' : 'bg-border'"
      />
    </template>
  </div>
</template>
