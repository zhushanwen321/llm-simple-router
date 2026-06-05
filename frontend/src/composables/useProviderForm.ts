import { ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import type { ProviderPayload } from "@/api/client";
import type { Provider, ModelInfo, ProviderEndpoint } from "@/types/mapping";
import { DEFAULT_CONTEXT_WINDOW, DEFAULT_STREAM_TIMEOUT_MS } from "@/constants";
import type { ModelConfig } from "@/components/quick-setup/types";
import { useTransformRules } from "@/composables/useTransformRules";
import { useProviderPresets } from "@/composables/useProviderPresets";
import type { ConcurrencyMode } from "@/types/concurrency";
import {
  DEFAULT_CONCURRENCY_CONFIG,
  DEFAULT_CONCURRENCY_MANUAL_CONFIG,
} from "@/components/shared/types";

const MAX_CONCURRENCY = 100;
const MAX_QUEUE_SIZE = 1000;

const MS_PER_SECOND = 1000;

interface FormState {
  name: string;
  api_type: string;
  base_url: string;
  upstream_path: string;
  api_key: string;
  endpoints: ProviderEndpoint[];
  models: ModelInfo[];
  is_active: boolean;
  max_concurrency: number;
  queue_timeout_ms: number;
  max_queue_size: number;
  adaptive_enabled: boolean;
  proxy_type: string;
  proxy_url: string;
  proxy_username: string;
  proxy_password: string;
}

const DEFAULT_FORM: FormState = {
  name: "",
  api_type: "anthropic",
  base_url: "",
  upstream_path: "",
  api_key: "",
  endpoints: [],
  models: [],
  is_active: true,
  max_concurrency: DEFAULT_CONCURRENCY_CONFIG.max_concurrency,
  queue_timeout_ms: DEFAULT_CONCURRENCY_CONFIG.queue_timeout_ms,
  max_queue_size: DEFAULT_CONCURRENCY_CONFIG.max_queue_size,
  adaptive_enabled: true,
  proxy_type: "",
  proxy_url: "",
  proxy_username: "",
  proxy_password: "",
};

const CONTEXT_WINDOW_OPTIONS = [
  { label: "8K", value: "8000" },
  { label: "16K", value: "16000" },
  { label: "32K", value: "32000" },
  { label: "64K", value: "64000" },
  { label: "128K", value: "128000" },
  { label: "160K", value: "160000" },
  { label: "200K", value: "200000" },
  { label: "256K", value: "256000" },
  { label: "1M", value: "1000000" },
] as const;

export const API_TYPE_LABELS: Record<string, string> = {
  openai: "OpenAI Chat Completions",
  "openai-responses": "OpenAI Responses",
  anthropic: "Anthropic Messages",
};

export { CONTEXT_WINDOW_OPTIONS, MS_PER_SECOND };

type ProviderFormPayload = Pick<
  ProviderPayload,
  | "name"
  | "api_type"
  | "base_url"
  | "upstream_path"
  | "models"
  | "is_active"
  | "max_concurrency"
  | "queue_timeout_ms"
  | "max_queue_size"
  | "adaptive_enabled"
  | "proxy_type"
  | "proxy_url"
  | "proxy_username"
  | "proxy_password"
  | "endpoints"
> & { api_key?: string };

export function useProviderForm() {
  const { t } = useI18n();
  const { transformConfig, loadTransformRules, saveTransformRules } =
    useTransformRules();

  const form = ref<FormState>({ ...DEFAULT_FORM });
  const errors = ref<Record<string, string>>({});
  const concurrencyMode = ref<ConcurrencyMode>("auto");
  const dialogOpen = ref(false);
  const editingId = ref<string | null>(null);
  const modelInput = ref("");
  const modelContextWindow = ref(DEFAULT_CONTEXT_WINDOW);
  const contextWindowSelect = computed({
    get: () => `${modelContextWindow.value}`,
    set: (val: string) => {
      modelContextWindow.value = Number(val);
    },
  });

  const presetHook = useProviderPresets(form);

  function validate(): boolean {
    const errs: Record<string, string> = {};

    // Name validation (always required)
    if (!form.value.name.trim()) {
      errs.name = t("providers.validation.nameRequired");
    } else if (!/^[a-zA-Z0-9_-]+$/.test(form.value.name.trim())) {
      errs.name = t("providers.validation.namePattern");
    }

    // Base URL or endpoints: 当有 endpoints 时通过 endpoint level 校验，否则校验顶层 base_url
    const hasEndpoints = form.value.endpoints.length > 0;
    if (!hasEndpoints) {
      if (!form.value.base_url.trim()) {
        errs.base_url = t("providers.validation.baseUrlRequired");
      } else {
        try {
          new URL(form.value.base_url.trim());
        } catch {
          errs.base_url = t("providers.validation.baseUrlInvalid");
        }
      }
    }

    if (!editingId.value && !form.value.api_key.trim())
      errs.api_key = t("providers.validation.apiKeyRequired");

    // endpoints 校验
    if (hasEndpoints) {
      const eps = form.value.endpoints;
      for (let i = 0; i < eps.length; i++) {
        if (!eps[i].base_url.trim()) {
          errs[`endpoint_${i}_base_url`] = t(
            "providers.validation.baseUrlRequired",
          );
        }
      }
      const types = eps.map((e) => e.api_type);
      if (new Set(types).size !== types.length) {
        errs.endpoints = t("providers.validation.duplicateApiType");
      }
    }
    if (concurrencyMode.value !== "none") {
      const mc = form.value.max_concurrency;
      if (!mc || mc < 1 || mc > MAX_CONCURRENCY)
        errs.max_concurrency = t("providers.validation.concurrencyRange", {
          min: 1,
          max: MAX_CONCURRENCY,
        });
      if (form.value.queue_timeout_ms < 0)
        errs.queue_timeout_ms = t("providers.validation.negativeNotAllowed");
      const qs = form.value.max_queue_size;
      if (!qs || qs < 1 || qs > MAX_QUEUE_SIZE)
        errs.max_queue_size = t("providers.validation.queueSizeRange", {
          min: 1,
          max: MAX_QUEUE_SIZE,
        });
    }
    errors.value = errs;
    return Object.keys(errs).length === 0;
  }

  function buildPayload(): ProviderFormPayload {
    const payload: ProviderFormPayload = {
      name: form.value.name,
      api_type: form.value.api_type,
      base_url:
        form.value.endpoints.length > 0 && !form.value.base_url
          ? form.value.endpoints[0].base_url
          : form.value.base_url,
      upstream_path: form.value.upstream_path || undefined,
      endpoints:
        form.value.endpoints.length > 0
          ? form.value.endpoints.map((ep) => ({
            api_type: ep.api_type,
            base_url: ep.base_url,
            upstream_path: ep.upstream_path || undefined,
            api_key: ep.api_key || undefined,
          }))
          : undefined,
      models: form.value.models.map((m) => ({
        name: m.name,
        context_window: m.context_window ?? undefined,
        patches: m.patches ?? undefined,
        stream_timeout_ms: m.stream_timeout_ms ?? undefined,
        capabilities: m.capabilities ?? undefined,
      })),
      is_active: form.value.is_active ? 1 : 0,
      max_concurrency:
        concurrencyMode.value === "none" ? 0 : form.value.max_concurrency,
      queue_timeout_ms:
        concurrencyMode.value === "none" ? 0 : form.value.queue_timeout_ms,
      max_queue_size:
        concurrencyMode.value === "none"
          ? DEFAULT_CONCURRENCY_MANUAL_CONFIG.max_queue_size
          : form.value.max_queue_size,
      adaptive_enabled: concurrencyMode.value === "auto" ? 1 : 0,
      proxy_type: form.value.proxy_type || null,
      proxy_url: form.value.proxy_url?.trim() || null,
      proxy_username: form.value.proxy_username?.trim() || null,
      proxy_password: form.value.proxy_password || null,
    };
    if (form.value.api_key) payload.api_key = form.value.api_key;
    return payload;
  }

  function addModel(caps?: string[], patchList?: string[]) {
    const input = modelInput.value.trim();
    if (!input) return;
    const names = input
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const name of names) {
      if (!form.value.models.some((m) => m.name === name)) {
        form.value.models.push({
          name,
          context_window: modelContextWindow.value || DEFAULT_CONTEXT_WINDOW,
          patches: patchList ?? [],
          stream_timeout_ms: DEFAULT_STREAM_TIMEOUT_MS,
          capabilities: caps ?? ["text"],
        });
      }
    }
    modelInput.value = "";
    modelContextWindow.value = DEFAULT_CONTEXT_WINDOW;
  }

  function removeModel(index: number) {
    form.value.models.splice(index, 1);
  }

  function updateModel(index: number, updated: ModelConfig) {
    form.value.models[index].context_window = updated.contextWindow;
    form.value.models[index].patches = updated.patches;
  }

  /** 切换模型的指定能力。text 为基础能力，不可关闭。 */
  function toggleModelCapability(index: number, capability: string) {
    if (capability === "text") return;
    const model = form.value.models[index];
    const caps = model.capabilities ?? ["text"];
    const hasIt = caps.includes(capability);
    model.capabilities = hasIt
      ? caps.filter((c) => c !== capability)
      : [...caps, capability];
  }

  function updateModelTimeout(index: number, seconds: string | number) {
    const val = Number(seconds);
    form.value.models[index].stream_timeout_ms =
      val > 0 ? val * MS_PER_SECOND : null;
  }

  function onConcurrencyModeChange(mode: ConcurrencyMode) {
    concurrencyMode.value = mode;
    if (mode === "auto") {
      if (!form.value.max_concurrency || form.value.max_concurrency < 1)
        form.value.max_concurrency = DEFAULT_CONCURRENCY_CONFIG.max_concurrency;
      form.value.adaptive_enabled = true;
    } else if (mode === "manual") {
      if (!form.value.max_concurrency || form.value.max_concurrency < 1)
        form.value.max_concurrency =
          DEFAULT_CONCURRENCY_MANUAL_CONFIG.max_concurrency;
      form.value.adaptive_enabled = false;
    }
  }

  function isOfficialOpenai(url: string): boolean {
    return url.includes("api.openai.com");
  }

  function openCreate() {
    editingId.value = null;
    form.value = { ...DEFAULT_FORM, models: [], endpoints: [] };
    concurrencyMode.value = "auto";
    modelInput.value = "";
    modelContextWindow.value = DEFAULT_CONTEXT_WINDOW;
    presetHook.presetGroup.value = "";
    presetHook.presetPlan.value = "";
    errors.value = {};
    dialogOpen.value = true;
  }

  function openEdit(p: Provider) {
    editingId.value = p.id;
    const mc = p.max_concurrency ?? 0;
    if (mc === 0) concurrencyMode.value = "none";
    else if (p.adaptive_enabled) concurrencyMode.value = "auto";
    else concurrencyMode.value = "manual";
    form.value = {
      name: p.name,
      api_type: p.api_type,
      base_url: p.base_url,
      upstream_path: p.upstream_path || "",
      api_key: "",
      endpoints: (p.endpoints ?? []).map((ep) => ({
        api_type: ep.api_type,
        base_url: ep.base_url,
        upstream_path: ep.upstream_path ?? null,
        api_key: ep.api_key ?? null,
      })),
      models: (p.models || []).map((m) => ({
        name: m.name,
        context_window: m.context_window ?? DEFAULT_CONTEXT_WINDOW,
        patches: m.patches ?? [],
        stream_timeout_ms: m.stream_timeout_ms ?? null,
        capabilities: m.capabilities ?? ["text"],
      })),
      is_active: !!p.is_active,
      max_concurrency:
        concurrencyMode.value === "none"
          ? DEFAULT_CONCURRENCY_CONFIG.max_concurrency
          : mc,
      queue_timeout_ms:
        p.queue_timeout_ms ?? DEFAULT_CONCURRENCY_CONFIG.queue_timeout_ms,
      max_queue_size:
        p.max_queue_size ?? DEFAULT_CONCURRENCY_CONFIG.max_queue_size,
      adaptive_enabled: concurrencyMode.value === "auto",
      proxy_type: p.proxy_type || "",
      proxy_url: p.proxy_url || "",
      proxy_username: p.proxy_username || "",
      proxy_password: "",
    };
    presetHook.presetGroup.value = "";
    presetHook.presetPlan.value = "";
    modelInput.value = "";
    modelContextWindow.value = DEFAULT_CONTEXT_WINDOW;
    errors.value = {};
    dialogOpen.value = true;
    loadTransformRules(p.id);
  }

  return {
    form,
    errors,
    concurrencyMode,
    dialogOpen,
    editingId,
    modelInput,
    modelContextWindow,
    contextWindowSelect,
    transformConfig,
    presetHook,
    validate,
    buildPayload,
    addModel,
    removeModel,
    updateModel,
    updateModelTimeout,
    toggleModelCapability,
    onConcurrencyModeChange,
    isOfficialOpenai,
    openCreate,
    openEdit,
    saveTransformRules,
  };
}
