import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";

// ---------- Mock dependencies ----------

vi.mock("vue-i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@/composables/useTransformRules", () => ({
  useTransformRules: () => ({
    transformConfig: ref({ rules: [] }),
    loadTransformRules: vi.fn(),
    saveTransformRules: vi.fn(),
  }),
}));

vi.mock("@/composables/useProviderPresets", () => ({
  useProviderPresets: () => ({
    providerPresets: ref([]),
    presetGroup: ref(""),
    presetPlan: ref(""),
    availablePlans: ref([]),
    onGroupChange: vi.fn(),
    onPresetChange: vi.fn(),
    getCurrentModelsEndpoint: vi.fn(() => undefined),
    getCurrentPresetModels: vi.fn(() => []),
    loadPresets: vi.fn(),
    resetPreset: vi.fn(),
  }),
}));

import { useProviderForm } from "@/composables/useProviderForm";

describe("useProviderForm - validate()", () => {
  let form: ReturnType<typeof useProviderForm>;

  beforeEach(() => {
    form = useProviderForm();
    // Default valid state (preset mode)
    form.form.value.name = "test-provider";
    form.form.value.base_url = "https://api.test.com/v1";
    form.form.value.api_key = "sk-test123";
    form.form.value.endpoints = [];
    form.form.value.models = [];
    form.editingId.value = null;
    // Reset errors
    form.errors.value = {};
  });

  it("should pass validation with valid preset-mode data", () => {
    expect(form.validate()).toBe(true);
    expect(form.errors.value).toEqual({});
  });

  it("should pass validation with valid custom-mode data (endpoints)", () => {
    form.form.value.base_url = "";
    form.form.value.endpoints = [
      {
        api_type: "openai",
        base_url: "https://api.custom.com/v1",
        upstream_path: null,
        api_key: null,
      },
    ];
    expect(form.validate()).toBe(true);
    expect(form.errors.value).toEqual({});
  });

  it("should fail when name is empty", () => {
    form.form.value.name = "";
    expect(form.validate()).toBe(false);
    expect(form.errors.value.name).toBe("providers.validation.nameRequired");
  });

  it("should fail when name has invalid characters", () => {
    form.form.value.name = "test provider!";
    expect(form.validate()).toBe(false);
    expect(form.errors.value.name).toBe("providers.validation.namePattern");
  });

  it("should fail when no endpoints and base_url is empty", () => {
    form.form.value.base_url = "";
    expect(form.validate()).toBe(false);
    expect(form.errors.value.base_url).toBe(
      "providers.validation.baseUrlRequired",
    );
  });

  it("should fail when no endpoints and base_url is invalid", () => {
    form.form.value.base_url = "not-a-url";
    expect(form.validate()).toBe(false);
    expect(form.errors.value.base_url).toBe(
      "providers.validation.baseUrlInvalid",
    );
  });

  it("should pass when endpoints exist and base_url is empty", () => {
    form.form.value.base_url = "";
    form.form.value.endpoints = [
      {
        api_type: "openai",
        base_url: "https://api.custom.com/v1",
        upstream_path: null,
        api_key: null,
      },
    ];
    expect(form.validate()).toBe(true);
  });

  it("should fail when endpoint has empty base_url", () => {
    form.form.value.base_url = "";
    form.form.value.endpoints = [
      {
        api_type: "openai",
        base_url: "",
        upstream_path: null,
        api_key: null,
      },
    ];
    expect(form.validate()).toBe(false);
    expect(form.errors.value["endpoint_0_base_url"]).toBe(
      "providers.validation.baseUrlRequired",
    );
  });

  it("should fail when endpoints have duplicate api_types", () => {
    form.form.value.base_url = "";
    form.form.value.endpoints = [
      {
        api_type: "openai",
        base_url: "https://api.test.com/v1",
        upstream_path: null,
        api_key: null,
      },
      {
        api_type: "openai",
        base_url: "https://api.test.com/v2",
        upstream_path: null,
        api_key: null,
      },
    ];
    expect(form.validate()).toBe(false);
    expect(form.errors.value.endpoints).toBe(
      "providers.validation.duplicateApiType",
    );
  });

  it("should fail when api_key is missing in create mode", () => {
    form.form.value.api_key = "";
    expect(form.validate()).toBe(false);
    expect(form.errors.value.api_key).toBe(
      "providers.validation.apiKeyRequired",
    );
  });

  it("should skip api_key check in edit mode", () => {
    form.editingId.value = "provider-123";
    form.form.value.api_key = "";
    expect(form.validate()).toBe(true);
    expect(form.errors.value.api_key).toBeUndefined();
  });

  it("should pass when both endpoints and top-level base_url exist", () => {
    form.form.value.base_url = "https://api.top.com/v1";
    form.form.value.endpoints = [
      {
        api_type: "openai",
        base_url: "https://api.endpoint.com/v1",
        upstream_path: null,
        api_key: null,
      },
    ];
    expect(form.validate()).toBe(true);
  });

  it("should fail when concurrency is out of range", () => {
    form.form.value.max_concurrency = 0;
    expect(form.validate()).toBe(false);
    expect(form.errors.value.max_concurrency).toBe(
      "providers.validation.concurrencyRange",
    );
  });
});

describe("useProviderForm - buildPayload()", () => {
  let form: ReturnType<typeof useProviderForm>;

  beforeEach(() => {
    form = useProviderForm();
    form.form.value.name = "test-provider";
    form.form.value.base_url = "";
    form.form.value.api_key = "sk-test123";
    form.form.value.endpoints = [];
    form.form.value.models = [];
  });

  it("should use endpoints[0].base_url when base_url is empty and endpoints exist", () => {
    form.form.value.endpoints = [
      {
        api_type: "openai",
        base_url: "https://api.custom.com/v1",
        upstream_path: null,
        api_key: null,
      },
    ];
    const payload = form.buildPayload();
    expect(payload.base_url).toBe("https://api.custom.com/v1");
  });

  it("should keep original base_url when it is non-empty", () => {
    form.form.value.base_url = "https://api.original.com/v1";
    form.form.value.endpoints = [
      {
        api_type: "openai",
        base_url: "https://api.custom.com/v1",
        upstream_path: null,
        api_key: null,
      },
    ];
    const payload = form.buildPayload();
    expect(payload.base_url).toBe("https://api.original.com/v1");
  });

  it("should use base_url as-is when no endpoints exist", () => {
    form.form.value.base_url = "https://api.standalone.com/v1";
    const payload = form.buildPayload();
    expect(payload.base_url).toBe("https://api.standalone.com/v1");
  });

  it("should serialize endpoints correctly", () => {
    form.form.value.endpoints = [
      {
        api_type: "openai",
        base_url: "https://api.openai.com/v1",
        upstream_path: null,
        api_key: null,
      },
      {
        api_type: "anthropic",
        base_url: "https://api.anthropic.com/v1",
        upstream_path: "/custom",
        api_key: "sk-ant-test",
      },
    ];
    const payload = form.buildPayload();
    expect(payload.endpoints).toHaveLength(2);
    expect(payload.endpoints![0].api_type).toBe("openai");
    expect(payload.endpoints![0].base_url).toBe("https://api.openai.com/v1");
    expect(payload.endpoints![1].api_type).toBe("anthropic");
    expect(payload.endpoints![1].upstream_path).toBe("/custom");
  });
});
