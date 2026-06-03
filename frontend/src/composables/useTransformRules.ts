import { ref } from "vue";
import { toast } from "vue-sonner";
import { useI18n } from "vue-i18n";
import { api, getApiMessage } from "@/api/client";
import { buildTransformRule } from "@/utils/transform-domain";
import type { TransformConfig } from "@/components/shared/types";

export function useTransformRules() {
  const { t } = useI18n();
  const transformConfig = ref<TransformConfig>({
    injectHeaders: "",
    dropFields: "",
    requestDefaults: "",
  });
  const transformExists = ref(false);

  async function loadTransformRules(providerId: string) {
    try {
      const res = await api.getTransformRules(providerId);
      if (res) {
        transformConfig.value.dropFields = (res.drop_fields || []).join(", ");
        transformConfig.value.requestDefaults = res.request_defaults
          ? JSON.stringify(res.request_defaults)
          : "";
        transformConfig.value.injectHeaders = res.inject_headers
          ? JSON.stringify(res.inject_headers)
          : "";
        transformExists.value = true;
      } else {
        transformConfig.value = {
          injectHeaders: "",
          dropFields: "",
          requestDefaults: "",
        };
        transformExists.value = false;
      }
    } catch (e) {
      console.error("transformRules.load:", e);
      toast.error(getApiMessage(e, t("providers.transform.loadFailed")));
      transformConfig.value = {
        injectHeaders: "",
        dropFields: "",
        requestDefaults: "",
      };
      transformExists.value = false;
    }
  }

  function saveTransformRules(editingId: string | null) {
    if (!editingId) return Promise.resolve();
    const result = buildTransformRule({
      injectHeaders: transformConfig.value.injectHeaders,
      dropFields: transformConfig.value.dropFields,
      requestDefaults: transformConfig.value.requestDefaults,
    });
    if (result.errorKey) {
      toast.error(t(`providers.transform.${result.errorKey}`));
      return Promise.resolve();
    }
    const parsed = result.rule
      ? JSON.parse(result.rule)
      : { drop_fields: null, request_defaults: null, inject_headers: null };
    return api
      .upsertTransformRules(editingId, { ...parsed, is_active: 1 })
      .then(() => {
        transformExists.value = true;
        toast.success(t("providers.transform.saved"));
      })
      .catch((e) => {
        console.error("transformRules.save:", e);
        toast.error(getApiMessage(e, t("common.saveFailed")));
      });
  }

  function handleDeleteTransformRules(editingId: string | null) {
    if (!editingId) return Promise.resolve();
    return api
      .deleteTransformRules(editingId)
      .then(() => {
        transformConfig.value = {
          injectHeaders: "",
          dropFields: "",
          requestDefaults: "",
        };
        transformExists.value = false;
        toast.success(t("providers.transform.deleted"));
      })
      .catch((e) => {
        console.error("transformRules.delete:", e);
        toast.error(getApiMessage(e, t("providers.transform.deleteFailed")));
      });
  }

  return {
    transformConfig,
    transformExists,
    loadTransformRules,
    saveTransformRules,
    handleDeleteTransformRules,
  };
}
