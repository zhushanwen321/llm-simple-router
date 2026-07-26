<script setup lang="ts">
import { ref, computed, nextTick } from "vue";
import { useI18n } from "vue-i18n";
import { ChevronDown, ChevronRight } from "@lucide/vue";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { CascadingGroup, CascadingSelectedValue } from "./types";
import type { PointerDownOutsideEvent } from "reka-ui";

const { t } = useI18n();

const props = withDefaults(
  defineProps<{
    groups: CascadingGroup[];
    modelValue?: CascadingSelectedValue;
    placeholder?: string;
    compact?: boolean;
    /** Dashed border variant (for overflow/multimodal selects) */
    dashed?: boolean;
  }>(),
  {
    placeholder: "",
    compact: false,
    dashed: false,
  },
);

const resolvedPlaceholder = computed(
  () => props.placeholder || t("common.selectPlaceholder"),
);

const emit = defineEmits<{
  "update:modelValue": [value: CascadingSelectedValue];
}>();

const LEAVE_DELAY_MS = 150;

const open = ref(false);
const hoveredGroupKey = ref<string | null>(null);
const groupRefs = ref<Map<string, HTMLElement>>(new Map());
const submenuPosition = ref({ top: 0, left: 0 });
let leaveTimer: ReturnType<typeof setTimeout> | null = null;

function setGroupRef(key: string, el: unknown) {
  if (el) groupRefs.value.set(key, el as HTMLElement);
  else groupRefs.value.delete(key);
}

function onGroupEnter(groupKey: string) {
  if (leaveTimer) {
    clearTimeout(leaveTimer);
    leaveTimer = null;
  }
  hoveredGroupKey.value = groupKey;
  nextTick(() => positionSubmenu(groupKey));
}

function onGroupLeave() {
  leaveTimer = setTimeout(() => {
    hoveredGroupKey.value = null;
  }, LEAVE_DELAY_MS);
}

function onSubmenuEnter() {
  if (leaveTimer) {
    clearTimeout(leaveTimer);
    leaveTimer = null;
  }
}

function onSubmenuLeave() {
  leaveTimer = setTimeout(() => {
    hoveredGroupKey.value = null;
  }, LEAVE_DELAY_MS);
}

function positionSubmenu(groupKey: string) {
  const el = groupRefs.value.get(groupKey);
  if (!el) return;
  const rect = el.getBoundingClientRect();
  submenuPosition.value = {
    top: rect.top,
    left: rect.right,
  };
}

/**
 * reka-ui DismissableLayer 检测 pointerdown outside 时会关闭 Popover。
 * 子菜单 Teleport 到 body 后不在 [data-dismissable-layer] 内，
 * 被误判为外部点击。用 reka-ui 提供的 pointerDownOutside 事件，
 * 当点击目标在子菜单内时 preventDefault() 阻止关闭。
 */
function onPointerDownOutside(e: PointerDownOutsideEvent) {
  const target = e.detail.originalEvent.target as HTMLElement | undefined;
  if (target?.closest("[data-cascade-submenu]")) {
    e.preventDefault();
  }
}

/**
 * [HISTORICAL] capture 阶段拦截子菜单内 pointerdown，阻止其冒泡到 document。
 *
 * 根因：子菜单 Teleport 到 body 后不在任何 DismissableLayer 内。reka-ui 的
 * Dialog（外层 DismissableLayer）在 document 上监听 pointerdown，判定点击落在
 * 自己 layer 外就把整个 Dialog 关闭——这是「Dialog 内选模型选不中」的根因。
 * 上面的 onPointerDownOutside.preventDefault 只拦得住 Popover 自身 dismiss，
 * 拦不住外层 Dialog；在 capture 阶段 stopPropagation 才能从根上切断。
 *
 * 不影响后续 click：pointerdown.preventDefault 只阻止默认行为（焦点转移等），
 * 不阻止浏览器后续派发 click 事件，selectOption 仍正常触发。
 * 实测验证：ModelMappings 新建分组 Dialog + Schedules 规则 Dialog 均恢复正常。
 */
function onSubmenuPointerDown(e: PointerEvent) {
  e.stopPropagation();
}

const displayText = computed(() => {
  if (!props.modelValue) return "";
  const group = props.groups.find((g) => g.key === props.modelValue!.groupKey);
  if (!group) return "";
  const option = group.options.find((o) => o.value === props.modelValue!.value);
  if (!option) return "";
  return `${group.label} / ${option.label}`;
});

function selectOption(groupKey: string, value: string) {
  emit("update:modelValue", { groupKey, value });
  open.value = false;
}

function onOpenChange(val: boolean) {
  open.value = val;
  if (!val) hoveredGroupKey.value = null;
}
</script>

<template>
  <Popover :open="open" @update:open="onOpenChange">
    <PopoverTrigger as-child>
      <div
        class="flex w-full items-center justify-between rounded-md bg-background ring-offset-background cursor-pointer hover:bg-accent hover:text-accent-foreground"
        :class="[
          compact
            ? 'h-7 text-xs px-2 py-1 rounded-md'
            : 'h-10 text-sm px-3 py-2 border border-border rounded-md',
          !compact && dashed ? 'border-dashed border-primary/20' : '',
          { 'ring-2 ring-ring ring-offset-2': open },
        ]"
      >
        <span
          class="truncate"
          :class="modelValue ? 'text-foreground' : 'text-muted-foreground'"
        >
          {{ displayText || resolvedPlaceholder }}
        </span>
        <ChevronDown class="h-4 w-4 shrink-0 opacity-50" />
      </div>
    </PopoverTrigger>

    <!-- z-[200] > dialog overlay z-modal(100) -->
    <PopoverContent
      :align="'start'"
      :side-offset="4"
      class="z-[200] w-auto min-w-56 max-h-[80vh] overflow-y-auto p-1"
      @pointer-down-outside="onPointerDownOutside"
    >
      <div
        v-for="group in groups"
        :key="group.key"
        :ref="(el) => setGroupRef(group.key, el)"
        class="relative flex cursor-pointer items-center justify-between rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
        :class="{
          'bg-accent text-accent-foreground z-10':
            hoveredGroupKey === group.key,
        }"
        @mouseenter="onGroupEnter(group.key)"
        @mouseleave="onGroupLeave"
      >
        <span class="truncate max-w-40">{{ group.label }}</span>
        <span
          v-if="group.badge"
          class="ml-1 text-[10px] px-1 py-px rounded bg-emerald-500/15 text-emerald-400 shrink-0"
          >{{ group.badge }}</span
        >
        <ChevronRight class="ml-1 h-4 w-4 shrink-0 opacity-50" />
      </div>

      <!-- Level 2: Teleported to body to avoid overflow clipping -->
      <Teleport to="body">
        <div
          v-if="
            hoveredGroupKey &&
            groups.find((g) => g.key === hoveredGroupKey)?.options.length
          "
          data-cascade-submenu
          class="fixed z-[201] min-w-48 max-h-[80vh] overflow-y-auto rounded-md bg-popover p-1 text-popover-foreground shadow-md"
          :style="{
            top: `${submenuPosition.top}px`,
            left: `${submenuPosition.left}px`,
          }"
          @mouseenter="onSubmenuEnter"
          @mouseleave="onSubmenuLeave"
          @pointerdown.capture="onSubmenuPointerDown"
        >
          <div
            v-for="option in groups.find((g) => g.key === hoveredGroupKey)
              ?.options ?? []"
            :key="option.value"
            class="flex cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
            :class="{
              'bg-accent text-accent-foreground':
                modelValue?.groupKey === hoveredGroupKey &&
                modelValue?.value === option.value,
            }"
            @click="selectOption(hoveredGroupKey!, option.value)"
          >
            <span class="truncate">{{ option.label }}</span>
            <span
              v-if="option.tag"
              class="shrink-0 text-xs text-muted-foreground"
              >{{ option.tag }}</span
            >
          </div>
        </div>
      </Teleport>

      <div
        v-if="groups.length === 0"
        class="px-2 py-1.5 text-sm text-muted-foreground"
      >
        {{ t("common.noOptions") }}
      </div>
    </PopoverContent>
  </Popover>
</template>
