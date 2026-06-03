<template>
  <div
    class="min-h-screen flex items-center justify-center bg-background relative"
  >
    <Button
      variant="ghost"
      size="icon"
      class="absolute top-4 right-4 text-muted-foreground hover:text-foreground"
      @click="toggleTheme"
    >
      <Moon v-if="!isDark" class="w-4 h-4" />
      <Sun v-else class="w-4 h-4" />
    </Button>
    <Card class="w-full max-w-sm shadow-lg">
      <CardContent class="pt-6">
        <div class="text-center mb-6">
          <div
            class="w-12 h-12 bg-primary rounded-lg mx-auto mb-3 flex items-center justify-center"
          >
            <svg
              class="w-7 h-7 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
          </div>
          <h1 class="text-xl font-semibold text-foreground">
            LLM Simple Router
          </h1>
          <p class="text-sm text-muted-foreground mt-1">{{ subtitle }}</p>
        </div>
        <slot />
      </CardContent>
    </Card>
  </div>
</template>

<script setup lang="ts">
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Moon, Sun } from "lucide-vue-next";
import { useTheme } from "@/composables/useTheme";

const { isDark, toggleTheme } = useTheme();

defineProps<{
  subtitle: string;
}>();
</script>
