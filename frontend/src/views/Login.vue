<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div class="min-h-screen flex items-center justify-center bg-background">
    <Card class="w-full max-w-sm shadow-lg">
      <CardContent class="pt-6">
        <div class="text-center mb-6">
          <div class="w-12 h-12 bg-primary rounded-lg mx-auto mb-3 flex items-center justify-center">
            <svg class="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
            </svg>
          </div>
          <h1 class="text-xl font-semibold text-foreground">LLM Simple Router</h1>
          <p class="text-sm text-muted-foreground mt-1">管理后台登录</p>
        </div>
        <form @submit.prevent="handleLogin" class="space-y-4">
          <div>
            <Label class="block text-sm font-medium text-foreground mb-1">密码</Label>
            <Input
              v-model="password"
              type="password"
              placeholder="输入管理员密码"
              :disabled="loading"
            />
          </div>
          <p v-if="error" class="text-destructive text-sm">{{ error }}</p>
          <Button
            type="submit"
            class="w-full"
            :disabled="loading"
          >
            {{ loading ? '登录中...' : '登 录' }}
          </Button>
        </form>
      </CardContent>
    </Card>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '@/api/client'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

const router = useRouter()
const password = ref('')
const error = ref('')
const loading = ref(false)

async function handleLogin() {
  if (!password.value) return
  error.value = ''
  loading.value = true
  try {
    await api.login(password.value)
    router.push('/')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    error.value = e.response?.data?.error?.message || '登录失败'
  } finally {
    loading.value = false
  }
}
</script>
