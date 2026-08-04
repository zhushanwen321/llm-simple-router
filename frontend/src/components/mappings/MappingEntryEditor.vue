<script setup lang="ts">
import { ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import {
  Plus,
  Trash2,
  ArrowRight,
  Zap,
  ChevronDown,
  AlertTriangle,
  Grid3x3,
  ShieldAlert,
} from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import CascadingModelSelect from "@/components/mappings/CascadingModelSelect.vue";
import CircuitBreakerDialog from "@/components/mappings/CircuitBreakerDialog.vue";
import type {
  MappingTarget,
  MappingEntry,
} from "@/components/quick-setup/types";
import type { MultimodalFallback, CircuitBreakerConfig } from "@/types/mapping";
import type {
  ProviderGroup,
  SelectedValue,
} from "@/components/mappings/cascading-types";

const { t } = useI18n();

const PROVIDER_NAME_TRUNCATE_LEN = 6;

const props = withDefaults(
  defineProps<{
    entry: MappingEntry;
    providerGroups: ProviderGroup[];
    expanded: boolean;
    editableClientModel?: boolean;
  }>(),
  {
    editableClientModel: false,
  },
);

const emit = defineEmits<{
  "update:targets": [targets: MappingTarget[]];
  "update:clientModel": [clientModel: string];
  "update:multimodalFallback": [fallback: MultimodalFallback | undefined];
  "toggle-active": [];
  remove: [];
  expand: [];
}>();

const editingClient = ref(false);
const clientDraft = ref("");

function startEditClient() {
  if (!props.editableClientModel) return;
  clientDraft.value = props.entry.clientModel;
  editingClient.value = true;
}

function saveClient() {
  const val = clientDraft.value.trim();
  if (val && val !== props.entry.clientModel) {
    emit("update:clientModel", val);
  }
  editingClient.value = false;
}

function cancelEditClient() {
  editingClient.value = false;
}

function providerName(providerId: string): string | null {
  if (providerId === "__new__") return null;
  return (
    props.providerGroups.find((p) => p.provider.id === providerId)?.provider
      .name ?? providerId.slice(0, PROVIDER_NAME_TRUNCATE_LEN)
  );
}

// Failover chain
function addTarget() {
  const firstProvider = props.providerGroups[0];
  emit("update:targets", [
    ...props.entry.targets,
    {
      backend_model: firstProvider?.models[0]?.name ?? "",
      provider_id: firstProvider?.provider.id ?? "",
    },
  ]);
}

function removeTarget(index: number) {
  if (props.entry.targets.length <= 1) return;
  emit(
    "update:targets",
    props.entry.targets.filter((_: MappingTarget, i: number) => i !== index),
  );
}

function updateTargetProvider(targetIndex: number, val: SelectedValue) {
  const newTargets = [...props.entry.targets];
  newTargets[targetIndex] = {
    ...newTargets[targetIndex],
    provider_id: val.provider_id,
    backend_model: val.model,
  };
  emit("update:targets", newTargets);
}

// Overflow
function addOverflow() {
  const firstProvider = props.providerGroups[0];
  const newTargets = props.entry.targets.map((t: MappingTarget, i: number) => {
    if (i === 0) {
      return {
        ...t,
        overflow_provider_id: firstProvider?.provider.id ?? "",
        overflow_model: firstProvider?.models[0]?.name ?? "",
      };
    }
    return t;
  });
  emit("update:targets", newTargets);
}

function updateOverflow(val: SelectedValue | undefined) {
  const newTargets = props.entry.targets.map((t: MappingTarget, i: number) => {
    if (i === 0) {
      if (val) {
        return {
          ...t,
          overflow_provider_id: val.provider_id,
          overflow_model: val.model,
        };
      }
      const { overflow_provider_id: _opid, overflow_model: _omod, ...rest } = t;
      return rest as MappingTarget;
    }
    return t;
  });
  emit("update:targets", newTargets);
}

// Multimodal fallback
function addMultimodalFallback() {
  const firstProvider = props.providerGroups[0];
  emit("update:multimodalFallback", {
    provider_id: firstProvider?.provider.id ?? "",
    backend_model: "",
  });
}

function handleFallbackSelect(val: SelectedValue) {
  emit("update:multimodalFallback", {
    provider_id: val.provider_id,
    backend_model: val.model,
  });
}

function removeMultimodalFallback() {
  emit("update:multimodalFallback", undefined);
}

// Tag styling
const tagClasses = computed(() => {
  switch (props.entry.tag) {
    case "def":
      return "bg-primary/15 text-primary";
    case "auto":
      return "bg-green-500/15 text-green-500";
    case "cust":
      return "bg-blue-500/15 text-blue-500";
    case "existing":
      return "bg-muted/40 text-muted-foreground";
    default:
      return "bg-muted/40 text-muted-foreground";
  }
});

const tagLabel = computed(() => {
  switch (props.entry.tag) {
    case "def":
      return t("providers.shared.tagDefault");
    case "auto":
      return t("providers.shared.tagAuto");
    case "cust":
      return t("providers.shared.tagCustom");
    case "existing":
      return t("providers.shared.tagExisting");
    default:
      return "";
  }
});

const hasOverflow = computed(() => !!props.entry.targets[0]?.overflow_model);
const hasMultimodal = computed(
  () => !!props.entry.multimodalFallback?.backend_model,
);

// Circuit breaker（target 级熔断配置）
const cbTargetIndex = ref<number | null>(null);

function openCircuitBreaker(index: number) {
  cbTargetIndex.value = index;
}

function closeCircuitBreaker() {
  cbTargetIndex.value = null;
}

function handleSaveCircuitBreaker(config: CircuitBreakerConfig | undefined) {
  if (cbTargetIndex.value === null) return;
  const idx = cbTargetIndex.value;
  const newTargets = props.entry.targets.map((tgt, i) => {
    if (i !== idx) return tgt;
    if (config) {
      return { ...tgt, circuit_breaker: config };
    }
    const { circuit_breaker: _cb, ...rest } = tgt;
    return rest as MappingTarget;
  });
  emit("update:targets", newTargets);
  closeCircuitBreaker();
}
</script>

<template>
  <div>
    <!-- ============ COLLAPSED: Horizontal Pipeline ============ -->
    <div
      v-if="!expanded"
      class="flex items-center gap-2 cursor-pointer select-none min-h-[28px]"
      @click="emit('expand')"
    >
      <!-- Client model -->
      <span
        class="font-mono text-xs font-semibold text-foreground min-w-[90px] truncate shrink-0"
        :title="entry.clientModel"
      >
        {{ entry.clientModel }}
      </span>

      <!-- Arrow -->
      <ArrowRight class="size-3 text-muted-foreground/30 shrink-0" />

      <!-- Pipeline chain -->
      <div class="flex items-center gap-1 min-w-0 flex-1 flex-wrap">
        <!-- Primary pill -->
        <template v-if="entry.targets.length > 0">
          <span
            class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-mono bg-primary/10 border border-border text-primary whitespace-nowrap"
          >
            <span class="text-[10px] font-semibold">①</span>
            {{ entry.targets[0].backend_model }}
            <span
              v-if="providerName(entry.targets[0].provider_id)"
              class="text-[10px] opacity-60"
              >{{ providerName(entry.targets[0].provider_id) }}</span
            >
          </span>
        </template>

        <!-- Failover pills -->
        <template
          v-for="(target, tIdx) in entry.targets.slice(1)"
          :key="'fo-' + tIdx"
        >
          <span class="text-orange-400/40 text-xs shrink-0">|</span>
          <span
            class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-mono bg-muted/30 border border-border text-muted-foreground whitespace-nowrap"
          >
            <span class="text-[10px] font-semibold">{{
              tIdx === 0 ? "②" : tIdx === 1 ? "③" : `${tIdx + 2}`
            }}</span>
            {{ target.backend_model }}
          </span>
        </template>

        <!-- Overflow pill -->
        <template v-if="hasOverflow">
          <span class="text-muted-foreground/30 text-xs shrink-0">|</span>
          <span
            class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-mono border border-dashed border-border text-primary/60 whitespace-nowrap"
          >
            ↓ {{ entry.targets[0].overflow_model }}
          </span>
        </template>

        <!-- Multimodal pill -->
        <template v-if="hasMultimodal">
          <span class="text-muted-foreground/30 text-xs shrink-0">|</span>
          <span
            class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-mono border border-dashed border-border text-blue-500/60 whitespace-nowrap"
          >
            <Grid3x3 class="size-2.5" />
            {{ entry.multimodalFallback!.backend_model }}
          </span>
        </template>
      </div>

      <!-- Tag badge -->
      <span
        class="text-[10px] px-1.5 py-px rounded font-medium leading-none shrink-0"
        :class="tagClasses"
      >
        {{ tagLabel }}
      </span>

      <!-- Toggle -->
      <div class="shrink-0 flex items-center" @click.stop>
        <Switch
          :model-value="entry.active"
          @update:model-value="emit('toggle-active')"
          class="scale-75"
        />
      </div>

      <!-- Delete -->
      <Button
        variant="ghost"
        size="icon-xs"
        class="shrink-0 text-muted-foreground/20 hover:text-destructive"
        @click.stop="emit('remove')"
      >
        <Trash2 class="size-3" />
      </Button>

      <!-- Hint -->
      <span
        class="text-[10px] text-muted-foreground/30 hidden sm:inline shrink-0 whitespace-nowrap"
      >
        {{ t("mappings.editor.clickToEdit") }}
      </span>
    </div>

    <!-- ============ EXPANDED: Vertical Editor ============ -->
    <div v-else class="space-y-2">
      <!-- Client model row -->
      <div class="flex items-center gap-2">
        <span
          class="text-[10px] text-muted-foreground/60 shrink-0 w-10 uppercase tracking-wider font-medium"
          >{{ t("mappings.editor.clientLabel") }}</span
        >
        <div
          v-if="editingClient"
          class="flex-1 flex items-center gap-1"
          @click.stop
        >
          <Input
            v-model="clientDraft"
            class="h-7 flex-1 text-xs font-mono border-[1px] border-border"
            :placeholder="t('mappings.editor.clientInputPlaceholder')"
            @keydown.enter.prevent="saveClient"
            @keydown.escape.prevent="cancelEditClient"
            @blur="saveClient"
            autofocus
          />
        </div>
        <div v-else class="flex-1 flex items-center gap-1.5">
          <span
            class="font-mono text-xs font-semibold text-foreground"
            :class="{
              'cursor-pointer hover:text-primary transition-colors':
                editableClientModel,
            }"
            @click="startEditClient"
          >
            {{ entry.clientModel }}
          </span>
          <Button
            v-if="editableClientModel"
            variant="ghost"
            size="xs"
            class="text-[10px] text-muted-foreground/40"
            @click.stop="startEditClient"
          >
            {{ t("mappings.editor.edit") }}
          </Button>
        </div>
      </div>

      <!-- ===== Failover chain ===== -->
      <div class="pt-0.5">
        <div class="flex items-center gap-1 mb-1">
          <Zap class="size-3 text-muted-foreground/50" />
          <span
            class="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider"
            >{{ t("mappings.editor.failoverChain") }}</span
          >
        </div>

        <div
          v-for="(target, tIdx) in entry.targets"
          :key="tIdx"
          class="space-y-0"
        >
          <div class="flex items-center gap-2">
            <span
              class="text-xs font-medium shrink-0 w-5 text-center px-0.5 py-0.5 rounded"
              :class="
                tIdx === 0
                  ? 'bg-primary/10 text-primary'
                  : 'bg-muted/40 text-muted-foreground'
              "
              >{{
                tIdx === 0
                  ? "①"
                  : tIdx === 1
                    ? "②"
                    : tIdx === 2
                      ? "③"
                      : `${tIdx + 1}`
              }}</span
            >
            <div class="flex-1">
              <CascadingModelSelect
                :providers="providerGroups"
                :model-value="{
                  provider_id: target.provider_id,
                  model: target.backend_model,
                }"
                compact
                :placeholder="t('providers.shared.selectModel')"
                @update:model-value="
                  (v: SelectedValue) => updateTargetProvider(tIdx, v)
                "
              />
            </div>
            <Button
              variant="ghost"
              size="icon-xs"
              class="shrink-0"
              :class="
                target.circuit_breaker?.enabled
                  ? 'text-warning'
                  : 'text-muted-foreground/30'
              "
              :aria-label="t('mappings.circuitBreaker.toggleButton')"
              @click="openCircuitBreaker(tIdx)"
            >
              <ShieldAlert class="size-3" />
            </Button>
            <Button
              v-if="tIdx > 0 && entry.targets.length > 1"
              variant="ghost"
              size="icon-xs"
              class="shrink-0 text-muted-foreground/30 hover:text-destructive"
              @click="removeTarget(tIdx)"
            >
              <Trash2 class="size-3" />
            </Button>
          </div>
          <div
            v-if="tIdx < entry.targets.length - 1"
            class="flex items-center gap-1 pl-7 py-0.5"
          >
            <div class="w-px h-1.5 bg-orange-400/30"></div>
            <span class="text-[9px] text-orange-400/50">{{
              t("mappings.editor.failoverOnError")
            }}</span>
          </div>
        </div>

        <Button
          variant="ghost"
          class="flex items-center justify-center gap-1 w-full py-1 mt-0.5 text-xs text-muted-foreground/40 border-[1px] border-dashed border-border rounded hover:text-primary hover:border-primary/40"
          @click="addTarget"
        >
          <Plus class="size-3" />
          {{ t("mappings.addBackup") }}
        </Button>
      </div>

      <!-- ===== Context overflow ===== -->
      <div class="pt-2 mt-1 border-t border-dashed border-primary/15">
        <div class="flex items-center gap-1.5 mb-1">
          <ChevronDown class="size-3 text-primary/50" />
          <span
            class="text-[10px] font-medium text-primary/60 uppercase tracking-wider"
            >{{ t("mappings.editor.contextOverflow") }}</span
          >
          <span class="text-[9px] text-primary/40 hidden sm:inline">{{
            t("mappings.editor.contextOverflowHint")
          }}</span>
        </div>

        <div v-if="hasOverflow" class="flex items-center gap-2">
          <span
            class="text-xs shrink-0 w-5 text-center px-0.5 py-0.5 rounded bg-primary/6 text-primary/60"
            >↓</span
          >
          <div class="flex-1">
            <CascadingModelSelect
              :providers="providerGroups"
              :model-value="
                entry.targets[0]?.overflow_provider_id &&
                entry.targets[0]?.overflow_model
                  ? {
                      provider_id: entry.targets[0].overflow_provider_id,
                      model: entry.targets[0].overflow_model,
                    }
                  : undefined
              "
              compact
              dashed
              :placeholder="t('providers.shared.overflowPlaceholder')"
              @update:model-value="(v: SelectedValue) => updateOverflow(v)"
            />
          </div>
          <Button
            variant="ghost"
            size="icon-xs"
            class="shrink-0 text-muted-foreground/30 hover:text-destructive"
            @click="updateOverflow(undefined)"
          >
            <Trash2 class="size-3" />
          </Button>
        </div>

        <Button
          v-else
          variant="ghost"
          size="xs"
          class="text-xs text-muted-foreground/50 hover:text-primary/60"
          @click="addOverflow"
        >
          <Plus class="size-3" />
          {{ t("providers.shared.addOverflow") }}
        </Button>
      </div>

      <!-- ===== Multimodal fallback ===== -->
      <div class="pt-2 mt-1 border-t border-dashed border-blue-500/15">
        <div class="flex items-center gap-1.5 mb-1">
          <Grid3x3 class="size-3 text-blue-500/50" />
          <span
            class="text-[10px] font-medium text-blue-500/60 uppercase tracking-wider"
            >{{ t("mappings.editor.multimodalFallback") }}</span
          >
          <Badge
            v-if="hasMultimodal"
            variant="outline"
            class="text-[9px] px-1.5 py-0 leading-none text-primary/60 border-[1px] border-primary/20"
          >
            {{ t("mappings.multimodalFallback.configured") }}
          </Badge>
        </div>

        <div v-if="hasMultimodal" class="flex items-center gap-2">
          <span
            class="text-xs shrink-0 w-5 text-center px-0.5 py-0.5 rounded bg-blue-500/6 text-blue-500/60"
            ><Grid3x3 class="size-2.5"
          /></span>
          <div class="flex-1">
            <CascadingModelSelect
              :providers="providerGroups"
              :model-value="{
                provider_id: entry.multimodalFallback!.provider_id,
                model: entry.multimodalFallback!.backend_model,
              }"
              compact
              dashed
              :placeholder="
                t('mappings.multimodalFallback.selectProviderModel')
              "
              @update:model-value="
                (v: SelectedValue) => handleFallbackSelect(v)
              "
            />
          </div>
          <Button
            variant="ghost"
            size="icon-xs"
            class="shrink-0 text-muted-foreground/30 hover:text-destructive"
            @click="removeMultimodalFallback"
          >
            <Trash2 class="size-3" />
          </Button>
        </div>

        <Button
          v-else
          variant="ghost"
          size="xs"
          class="text-xs text-muted-foreground/50 hover:text-primary/60"
          @click="addMultimodalFallback"
        >
          <Plus class="size-3" />
          {{ t("mappings.multimodalFallback.add") }}
        </Button>

        <!-- Warning box -->
        <div
          v-if="hasMultimodal"
          class="mt-2 px-2.5 py-2 rounded border-[1px] border-orange-400/25 bg-orange-400/5 flex gap-2"
        >
          <AlertTriangle class="size-3.5 text-orange-400 shrink-0 mt-0.5" />
          <div class="text-[10px] leading-relaxed space-y-0.5">
            <div class="text-orange-400 font-medium">
              {{ t("mappings.multimodalFallback.sessionLockWarning") }}
            </div>
            <div class="text-muted-foreground/60">
              {{ t("mappings.multimodalFallback.sessionLockReason") }}
            </div>
            <div class="text-muted-foreground/40">
              {{ t("mappings.multimodalFallback.costSuggestion") }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <CircuitBreakerDialog
      v-if="cbTargetIndex !== null"
      :target="entry.targets[cbTargetIndex]"
      :model-value="true"
      @update:model-value="closeCircuitBreaker"
      @save="handleSaveCircuitBreaker"
    />
  </div>
</template>
