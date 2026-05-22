<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div class="p-6 space-y-4">
    <h2 class="text-lg font-semibold text-foreground">{{ t('proxyEnhancement.title') }}</h2>

    <!-- 每个开关卡片自带未保存标记 -->
    <Card v-for="(item, idx) in features" :key="idx" class="relative">
      <div
        v-if="item.modified"
        class="absolute top-3 right-14 flex items-center gap-1 text-[10px] text-warning"
      >
        <div class="w-1.5 h-1.5 rounded-full bg-warning" />
        <span>{{ t('proxyEnhancement.status.modified') }}</span>
      </div>
      <CardHeader>
        <CardTitle>{{ item.title }}</CardTitle>
        <CardDescription>{{ item.description }}</CardDescription>
      </CardHeader>
      <CardContent>
        <div class="flex items-center gap-3">
          <Switch
            :model-value="item.value"
            @update:model-value="(v) => toggleFeature(idx, v)"
          />
          <Label>
            {{ item.value
              ? t('proxyEnhancement.status.enabled')
              : t('proxyEnhancement.status.disabled') }}
          </Label>
        </div>
      </CardContent>
    </Card>

    <!-- Client Session Headers (行编辑: 直接修改 + 保存按钮) -->
    <Card>
      <CardHeader>
        <CardTitle>{{ t('proxyEnhancement.clientIdentification.title') }}</CardTitle>
        <CardDescription>{{ t('proxyEnhancement.clientIdentification.description') }}</CardDescription>
      </CardHeader>
      <CardContent>
        <div class="space-y-3">
          <div
            v-for="(entry, index) in clientSessionHeaders"
            :key="index"
            class="flex items-center gap-3"
          >
            <Input v-model="entry.client_type" placeholder="client_type" class="w-40 h-8" />
            <Input v-model="entry.session_header_key" placeholder="session header key" class="flex-1 h-8" />
            <Button variant="ghost" size="icon" @click="removeSessionHeaderEntry(index)">
              <Trash2 class="w-4 h-4" />
            </Button>
          </div>
          <Button variant="outline" size="sm" @click="addSessionHeaderEntry">
            <Plus class="w-4 h-4 mr-1" />
            {{ t('proxyEnhancement.clientIdentification.addEntry') }}
          </Button>
        </div>
      </CardContent>
    </Card>

    <!-- 底部持久化栏: 始终可见 -->
    <div
      class="sticky bottom-0 bg-card border-t border-border px-6 py-3 flex items-center justify-between -mx-6 -mb-6"
    >
      <div class="flex items-center gap-2">
        <!-- 未保存指示器 -->
        <template v-if="unsavedCount > 0">
          <Badge variant="warning" class="text-[10px]">
            {{ t('proxyEnhancement.status.unsavedCount', { count: unsavedCount }) }}
          </Badge>
          <span class="text-xs text-muted-foreground">
            {{ t('proxyEnhancement.status.unsavedHint') }}
          </span>
        </template>
        <template v-else>
          <span class="text-xs text-success flex items-center gap-1">
            <Check class="w-3 h-3" />
            {{ t('proxyEnhancement.status.allSaved') }}
          </span>
        </template>
      </div>
      <div class="flex items-center gap-2">
        <Button
          v-if="unsavedCount > 0"
          variant="outline"
          size="sm"
          @click="resetAll"
        >
          {{ t('common.reset') }}
        </Button>
        <Button size="sm" :disabled="saving || unsavedCount === 0" @click="handleSave">
          <span v-if="saving" class="flex items-center gap-1">
            <Loader2 class="w-4 h-4 animate-spin" />
            {{ t('proxyEnhancement.status.saving') }}
          </span>
          <span v-else>
            {{ t('common.save') }}
            <span v-if="unsavedCount > 0">({{ unsavedCount }})</span>
          </span>
        </Button>
      </div>
    </div>
  </div>
</template>
