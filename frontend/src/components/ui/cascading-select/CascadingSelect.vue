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
const SUBMENU_GAP_PX = 2;
const VIEWPORT_MARGIN_PX = 8;

const open = ref(false);
const hoveredGroupKey = ref<string | null>(null);
const groupRefs = ref<Map<string, HTMLElement>>(new Map());
const submenuRef = ref<HTMLElement | null>(null);
const submenuPosition = ref({ top: 0, left: 0, maxHeight: 0 });
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
  hoveredGroupKey.value = null;
}

function positionSubmenu(groupKey: string) {
  const el = groupRefs.value.get(groupKey);
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const viewportH = window.innerHeight;
  const available = viewportH - VIEWPORT_MARGIN_PX - VIEWPORT_MARGIN_PX;
  // Natural submenu height (may exceed viewport); clamp to available space.
  const naturalH = submenuRef.value?.scrollHeight ?? 0;
  const maxHeight = Math.min(available, naturalH || available);
  // Anchor to the group's top, then nudge up so the menu stays in the viewport.
  let top = rect.top;
  if (top + maxHeight > viewportH - VIEWPORT_MARGIN_PX) {
    top = viewportH - VIEWPORT_MARGIN_PX - maxHeight;
  }
  if (top < VIEWPORT_MARGIN_PX) top = VIEWPORT_MARGIN_PX;
  submenuPosition.value = {
    top,
    left: rect.right + SUBMENU_GAP_PX,
    maxHeight,
  };
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

// Reka-ui's DismissableLayer treats the teleported submenu as "outside" the
// PopoverContent, so a click on a model option fires pointer-down-outside →
// closes the popover → unmounts the submenu before @click resolves. Mark the
// submenu with data-cascading-submenu and preventDefault on those events when
// the target is inside it, so clicks on submenu items reach selectOption().
function isInsideSubmenu(event: Event): boolean {
  const target = event.target as HTMLElement | null;
  return !!target?.closest("[data-cascading-submenu]");
}

function onPointerDownOutside(event: Event) {
  if (isInsideSubmenu(event)) event.preventDefault();
}

function onInteractOutside(event: Event) {
  if (isInsideSubmenu(event)) event.preventDefault();
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
      @interact-outside="onInteractOutside"
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
          ref="submenuRef"
          data-cascading-submenu
          class="fixed z-[201] min-w-48 overflow-y-auto rounded-md bg-popover p-1 text-popover-foreground shadow-md"
          :style="{
            top: `${submenuPosition.top}px`,
            left: `${submenuPosition.left}px`,
            maxHeight: submenuPosition.maxHeight
              ? `${submenuPosition.maxHeight}px`
              : '80vh',
          }"
          @mouseenter="onSubmenuEnter"
          @mouseleave="onSubmenuLeave"
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
