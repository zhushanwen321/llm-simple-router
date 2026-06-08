<template>
  <Card v-if="rules.length > 0" class="mt-6">
    <Collapsible v-model:open="open">
      <CollapsibleTrigger as-child>
        <CardHeader class="cursor-pointer hover:bg-muted/50 transition-colors">
          <div class="flex items-center justify-between">
            <CardTitle class="text-sm font-medium">
              {{ t("retryRules.recommended.title", { count: rules.length }) }}
            </CardTitle>
            <ChevronDown
              class="h-4 w-4 text-muted-foreground transition-transform"
              :class="{ 'rotate-180': open }"
            />
          </div>
        </CardHeader>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <CardContent>
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-2">
              <Checkbox
                :model-value="allChecked"
                @update:model-value="toggleAll"
              />
              <span class="text-sm text-muted-foreground">
                {{ t("retryRules.recommended.selectAll") }}
              </span>
            </div>
            <Button
              size="sm"
              :disabled="selected.size === 0"
              @click="handleAdd"
            >
              {{
                t("retryRules.recommended.addSelected", {
                  count: selected.size,
                })
              }}
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead class="w-10" />
                <TableHead>{{
                  t("retryRules.recommended.headers.name")
                }}</TableHead>
                <TableHead>{{
                  t("retryRules.recommended.headers.statusCode")
                }}</TableHead>
                <TableHead>{{
                  t("retryRules.recommended.headers.pattern")
                }}</TableHead>
                <TableHead>{{
                  t("retryRules.recommended.headers.strategy")
                }}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="rule in rules" :key="rule.name">
                <TableCell>
                  <Checkbox
                    :model-value="selected.has(rule.name)"
                    @update:model-value="() => toggle(rule.name)"
                  />
                </TableCell>
                <TableCell>{{ rule.name }}</TableCell>
                <TableCell>{{ rule.status_code }}</TableCell>
                <TableCell class="font-mono text-xs max-w-[200px] truncate">
                  {{ rule.body_pattern }}
                </TableCell>
                <TableCell>
                  {{
                    rule.retry_strategy === "fixed"
                      ? t("retryRules.strategy.fixed")
                      : t("retryRules.strategy.exponential")
                  }}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </CollapsibleContent>
    </Collapsible>
  </Card>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import { api, type RecommendedRetryRule } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown } from "@lucide/vue";

const { t } = useI18n();

const props = defineProps<{ rules: RecommendedRetryRule[] }>();
const emit = defineEmits<{ (e: "added"): void }>();

const open = ref(false);
const selected = ref(new Set<string>());

const allChecked = computed(
  () => props.rules.length > 0 && selected.value.size === props.rules.length,
);

function toggle(name: string) {
  const s = new Set(selected.value);
  if (s.has(name)) s.delete(name);
  else s.add(name);
  selected.value = s;
}

function toggleAll(checked: boolean | string) {
  selected.value =
    checked === true ? new Set(props.rules.map((r) => r.name)) : new Set();
}

async function handleAdd() {
  const toAdd = props.rules.filter((r) => selected.value.has(r.name));
  for (const rule of toAdd) {
    await api.createRetryRule({
      name: rule.name,
      status_code: rule.status_code,
      body_pattern: rule.body_pattern,
      is_active: 1,
      retry_strategy: rule.retry_strategy,
      retry_delay_ms: rule.retry_delay_ms,
      max_retries: rule.max_retries,
      max_delay_ms: rule.max_delay_ms,
    });
  }
  toast.success(t("retryRules.messages.addedCount", { count: toAdd.length }));
  selected.value = new Set();
  emit("added");
}
</script>
