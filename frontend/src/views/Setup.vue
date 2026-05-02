<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div class="min-h-screen flex items-center justify-center bg-background relative">
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
          <div class="w-12 h-12 bg-primary rounded-lg mx-auto mb-3 flex items-center justify-center">
            <svg class="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
            </svg>
          </div>
          <h1 class="text-xl font-semibold text-foreground">LLM Simple Router</h1>
          <p class="text-sm text-muted-foreground mt-1">{{ t('setup.subtitle') }}</p>
        </div>
        <form @submit.prevent="handleSetup" class="space-y-4">
          <div>
            <Label class="block text-sm font-medium text-foreground mb-1">{{ t('setup.password') }}</Label>
            <Input
              v-model="password"
              type="password"
              :placeholder="t('setup.passwordPlaceholder')"
              :disabled="loading"
            />
          </div>
          <div>
            <Label class="block text-sm font-medium text-foreground mb-1">{{ t('setup.confirmPassword') }}</Label>
            <Input
              v-model="confirmPassword"
              type="password"
              :placeholder="t('setup.confirmPasswordPlaceholder')"
              :disabled="loading"
            />
          </div>
          <p v-if="error" class="text-destructive text-sm">{{ error }}</p>
          <Button
            type="submit"
            class="w-full"
            :disabled="loading"
          >
            {{ loading ? t('setup.settingUp') : t('setup.setupButton') }}
          </Button>
        </form>
      </CardContent>
    </Card>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
import { useRouter } from 'vue-router'
import { api, getApiMessage } from '@/api/client'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Moon, Sun } from 'lucide-vue-next'
import { useTheme } from '@/composables/useTheme'

const { isDark, toggleTheme } = useTheme()

const router = useRouter()
const password = ref('')
const confirmPassword = ref('')
const error = ref('')
const loading = ref(false)

async function handleSetup() {
  if (!password.value || !confirmPassword.value) {
    error.value = t('setup.pleaseInputPassword')
    return
  }
  if (password.value !== confirmPassword.value) {
    error.value = t('setup.passwordMismatch')
    return
  }
  if (password.value.length < 6) { // eslint-disable-line no-magic-numbers
    error.value = t('setup.passwordTooShort')
    return
  }
  error.value = ''
  loading.value = true
  try {
    await api.initializeSetup(password.value)
    router.push('/admin/dashboard')
  } catch (e: unknown) {
    error.value = getApiMessage(e, t('setup.setupFailed'))
  } finally {
    loading.value = false
  }
}
</script>
