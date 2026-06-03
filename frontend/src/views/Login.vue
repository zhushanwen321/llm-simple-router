<template>
  <AuthLayout :subtitle="t('login.subtitle')">
    <form @submit.prevent="handleLogin" class="space-y-4">
      <div>
        <Label class="block text-sm font-medium text-foreground mb-1">{{
          t("login.password")
        }}</Label>
        <Input
          v-model="password"
          type="password"
          :placeholder="t('login.passwordPlaceholder')"
          :disabled="loading"
        />
      </div>
      <p v-if="error" class="text-destructive text-sm">{{ error }}</p>
      <Button type="submit" class="w-full" :disabled="loading">
        {{ loading ? t("login.loggingIn") : t("login.loginButton") }}
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
import AuthLayout from "@/components/layout/AuthLayout.vue";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

const router = useRouter();
const password = ref("");
const error = ref("");
const loading = ref(false);

async function handleLogin() {
  if (!password.value) return;
  error.value = "";
  loading.value = true;
  try {
    await api.login(password.value);
    router.push("/");
  } catch (e: unknown) {
    console.error("login:", e);
    error.value = getApiMessage(e, t("login.loginFailed"));
  } finally {
    loading.value = false;
  }
}
</script>
