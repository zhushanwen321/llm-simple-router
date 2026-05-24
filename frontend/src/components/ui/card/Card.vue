<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { cn } from "@/lib/utils";

const props = withDefaults(
  defineProps<{
    class?: HTMLAttributes["class"];
    size?: "default" | "sm";
    /** 无 padding + overflow-hidden，用于包裹 Table 等全宽内容 */
    flush?: boolean;
  }>(),
  {
    size: "default",
    flush: false,
  },
);
</script>

<template>
  <div
    data-slot="card"
    :data-size="size"
    :data-flush="flush || undefined"
    :class="
      cn(
        'border-border bg-card text-card-foreground rounded-lg border text-sm group/card flex flex-col',
        flush
          ? 'overflow-hidden'
          : 'overflow-hidden gap-4 py-4 has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 *:[img:first-child]:rounded-t-lg *:[img:last-child]:rounded-b-lg',
        'data-[size=sm]:gap-3 data-[size=sm]:py-3 data-[size=sm]:has-data-[slot=card-footer]:pb-0',
        props.class,
      )
    "
  >
    <slot />
  </div>
</template>
