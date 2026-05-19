<template>
  <div v-if="!localeLoaded" />
  <template v-else>
    <div v-if="isAuthenticated" class="h-screen flex overflow-hidden">
      <Sidebar />
      <main class="flex-1 overflow-auto bg-muted">
        <router-view />
      </main>
    </div>
    <router-view v-else />
  </template>
  <Teleport to="body">
    <Toaster
      :theme="theme"
      richColors
      position="top-center"
      :toastOptions="{ duration: 4000 }"
    />
  </Teleport>
</template>

<script setup lang="ts">
import { computed } from "vue";
import Sidebar from "@/components/layout/Sidebar.vue";
import { Toaster } from "@/components/ui/sonner";
import { isDark } from "@/composables/useTheme";
import { localeLoaded } from "@/i18n";
import { isAuthenticated } from "@/router";

const theme = computed(() => (isDark.value ? "dark" : "light"));
</script>
