<template>
  <AuthLayout :subtitle="t('setup.subtitle')">
    <form @submit.prevent="handleSetup" class="space-y-4">
      <div>
        <Label class="block text-sm font-medium text-foreground mb-1">{{
          t("setup.password")
        }}</Label>
        <Input
          v-model="password"
          type="password"
          :placeholder="t('setup.passwordPlaceholder')"
          :disabled="loading"
        />
      </div>
      <div>
        <Label class="block text-sm font-medium text-foreground mb-1">{{
          t("setup.confirmPassword")
        }}</Label>
        <Input
          v-model="confirmPassword"
          type="password"
          :placeholder="t('setup.confirmPasswordPlaceholder')"
          :disabled="loading"
        />
      </div>
      <p v-if="error" class="text-destructive text-sm">{{ error }}</p>
      <Button type="submit" class="w-full" :disabled="loading">
        {{ loading ? t("setup.settingUp") : t("setup.setupButton") }}
      </Button>
    </form>
  </AuthLayout>
</template>
”}, {

<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
const { t } = useI18n();
import { useRouter } from "vue-router";
import { api, getApiMessage } from "@/api/client";
import { markSetupDone } from "@/router";
import AuthLayout from "@/components/layout/AuthLayout.vue";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

const router = useRouter();
const password = ref("");
const confirmPassword = ref("");
const error = ref("");
const loading = ref(false);

async function handleSetup() {
  if (!password.value || !confirmPassword.value) {
    error.value = t("setup.pleaseInputPassword");
    return;
  }
  if (password.value !== confirmPassword.value) {
    error.value = t("setup.passwordMismatch");
    return;
  }
  const MIN_PASSWORD_LENGTH = 6;
  if (password.value.length < MIN_PASSWORD_LENGTH) {
    error.value = t("setup.passwordTooShort");
    return;
  }
  error.value = "";
  loading.value = true;
  try {
    await api.initializeSetup(password.value);
    markSetupDone();
    router.push({ name: "dashboard" });
  } catch (e: unknown) {
    error.value = getApiMessage(e, t("setup.setupFailed"));
  } finally {
    loading.value = false;
  }
}
</script>
