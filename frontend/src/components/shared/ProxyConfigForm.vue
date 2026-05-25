<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import type { ProxyConfig } from "@/components/shared/types";
import { DEFAULT_PROXY_CONFIG } from "@/components/shared/types";

const props = defineProps<{
  modelValue: ProxyConfig;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: ProxyConfig];
}>();

const { t } = useI18n();

function patch(partial: Partial<ProxyConfig>) {
  emit("update:modelValue", { ...props.modelValue, ...partial });
}

const proxyType = computed(
  () => props.modelValue.proxyType ?? DEFAULT_PROXY_CONFIG.proxyType,
);
const proxyUrl = computed(
  () => props.modelValue.proxyUrl ?? DEFAULT_PROXY_CONFIG.proxyUrl,
);
const proxyUsername = computed(
  () => props.modelValue.proxyUsername ?? DEFAULT_PROXY_CONFIG.proxyUsername,
);
const proxyPassword = computed(
  () => props.modelValue.proxyPassword ?? DEFAULT_PROXY_CONFIG.proxyPassword,
);

function onTypeChange(val: unknown) {
  const strVal =
    typeof val === "string" ? val : val != null ? JSON.stringify(val) : "";
  const value = strVal === "none" ? "" : strVal;
  if (value) {
    patch({ proxyType: value });
  } else {
    emit("update:modelValue", { ...DEFAULT_PROXY_CONFIG });
  }
}
</script>

<template>
  <div class="border border-input rounded-lg p-4 space-y-3">
    <div class="flex items-center gap-3">
      <span
        class="text-xs font-medium text-muted-foreground whitespace-nowrap"
        >{{ t("providers.fields.proxyTitle") }}</span
      >
      <Select
        :model-value="proxyType || 'none'"
        class="w-32"
        @update:model-value="onTypeChange"
      >
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="none">{{
            t("providers.fields.proxyNoProxy")
          }}</SelectItem>
          <SelectItem value="http">{{
            t("providers.fields.proxyHttp")
          }}</SelectItem>
          <SelectItem value="socks5">{{
            t("providers.fields.proxySocks5")
          }}</SelectItem>
        </SelectContent>
      </Select>
    </div>
    <div v-if="proxyType" class="grid grid-cols-4 gap-3">
      <div class="col-span-2">
        <Label class="text-xs text-muted-foreground">{{
          t("providers.fields.proxyUrl")
        }}</Label>
        <Input
          :model-value="proxyUrl"
          type="text"
          class="mt-1 font-mono text-xs"
          :placeholder="
            proxyType === 'socks5'
              ? t('providers.fields.proxyUrlPlaceholderSocks5')
              : t('providers.fields.proxyUrlPlaceholderHttp')
          "
          @update:model-value="patch({ proxyUrl: $event as string })"
        />
      </div>
      <div>
        <Label class="text-xs text-muted-foreground">{{
          t("providers.fields.proxyUsername")
        }}</Label>
        <Input
          :model-value="proxyUsername"
          type="text"
          class="mt-1"
          :placeholder="t('providers.fields.proxyAuthOptional')"
          @update:model-value="patch({ proxyUsername: $event as string })"
        />
      </div>
      <div>
        <Label class="text-xs text-muted-foreground">{{
          t("providers.fields.proxyPassword")
        }}</Label>
        <Input
          :model-value="proxyPassword"
          type="password"
          class="mt-1"
          :placeholder="t('providers.fields.proxyAuthOptional')"
          @update:model-value="patch({ proxyPassword: $event as string })"
        />
      </div>
    </div>
  </div>
</template>
