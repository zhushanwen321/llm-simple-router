import { ref, computed } from "vue";
import type { ComputedRef, Ref } from "vue";
import { toast } from "vue-sonner";
import { useI18n } from "vue-i18n";
import { api, getApiMessage } from "@/api/client";
import { getMetricsDetailDays, setMetricsDetailDays } from "@/api/settings-api";

const DEFAULT_RETENTION_DAYS = 3;
const DEFAULT_METRICS_DETAIL_DAYS = 7;

export interface UseLogRetentionReturn {
  // Log retention
  retentionDays: Ref<number>;
  retentionSaving: Ref<boolean>;
  saveRetention: () => Promise<void>;
  loadRetention: () => Promise<void>;
  // Metrics detail
  metricsDetailDays: Ref<number>;
  metricsDetailSaving: Ref<boolean>;
  loadMetricsDetail: () => Promise<void>;
  // Combined
  saveBoth: () => Promise<void>;
  /** metrics_detail_days > retention_days 时返回非空错误消息 */
  validationError: ComputedRef<string>;
}

export function useLogRetention(): UseLogRetentionReturn {
  const { t } = useI18n();
  const retentionDays = ref(DEFAULT_RETENTION_DAYS);
  const retentionSaving = ref(false);
  const metricsDetailDays = ref(DEFAULT_METRICS_DETAIL_DAYS);
  const metricsDetailSaving = ref(false);

  const validationError = computed<string>(() => {
    if (metricsDetailDays.value > retentionDays.value) {
      return t("settings.retention.metricsExceedsLog");
    }
    return "";
  });

  async function saveRetention() {
    retentionSaving.value = true;
    try {
      const result = await api.setLogRetention(retentionDays.value);
      retentionDays.value = result.days;
      toast.success(t("logs.retention.saved"));
    } catch (e: unknown) {
      console.error("logRetention.save:", e);
      toast.error(getApiMessage(e, t("logs.retention.updateFailed")));
    } finally {
      retentionSaving.value = false;
    }
  }

  async function loadRetention() {
    try {
      const { days } = await api.getLogRetention();
      retentionDays.value = days;
    } catch (e: unknown) {
      console.error("logRetention.load:", e);
      toast.error(getApiMessage(e, t("logs.retention.loadFailed")));
    }
  }

  async function loadMetricsDetail() {
    try {
      const { days } = await getMetricsDetailDays();
      metricsDetailDays.value = days;
    } catch (e: unknown) {
      console.error("logRetention.loadMetricsDetail:", e);
      toast.error(
        getApiMessage(e, t("logs.retention.loadMetricsDetailFailed")),
      );
    }
  }

  async function saveBoth() {
    if (validationError.value) {
      toast.error(validationError.value);
      return;
    }
    retentionSaving.value = true;
    metricsDetailSaving.value = true;
    try {
      const [retentionResult, metricsResult] = await Promise.allSettled([
        api.setLogRetention(retentionDays.value),
        setMetricsDetailDays(metricsDetailDays.value),
      ]);
      if (retentionResult.status === "fulfilled") {
        retentionDays.value = retentionResult.value.days;
      }
      if (metricsResult.status === "fulfilled") {
        metricsDetailDays.value = metricsResult.value.days;
      }
      const firstError = [retentionResult, metricsResult].find(
        (r): r is PromiseRejectedResult => r.status === "rejected",
      );
      if (firstError) {
        toast.error(
          getApiMessage(firstError.reason, t("logs.retention.updateFailed")),
        );
        return;
      }
      toast.success(t("logs.retention.bothSaved"));
    } finally {
      retentionSaving.value = false;
      metricsDetailSaving.value = false;
    }
  }

  return {
    retentionDays,
    retentionSaving,
    saveRetention,
    loadRetention,
    metricsDetailDays,
    metricsDetailSaving,
    loadMetricsDetail,
    saveBoth,
    validationError,
  };
}
