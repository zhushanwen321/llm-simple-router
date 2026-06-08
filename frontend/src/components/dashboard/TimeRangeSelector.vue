<script setup lang="ts">
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { CalendarDate } from "@internationalized/date";
import type { DateValue } from "@internationalized/date";
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import type { QuickRange } from "@/composables/useTimeSelector";

const {
  timeRangeLabel,
  activeRange,
  showCustom,
  customStartDate,
  customEndDate,
  customError,
  selectQuickRange,
  toggleCustom,
  applyCustom,
} = defineProps<{
  timeRangeLabel: string;
  activeRange: QuickRange | "custom" | null;
  showCustom: boolean;
  customStartDate: Date;
  customEndDate: Date;
  customError: string;
  selectQuickRange: (range: QuickRange) => void;
  toggleCustom: () => void;
  applyCustom: () => void;
}>();

const { t } = useI18n();

const emit = defineEmits<{
  "update:customStartDate": [value: Date];
  "update:customEndDate": [value: Date];
  "update:showCustom": [value: boolean];
  "update:activeRange": [value: QuickRange | "custom" | null];
}>();

interface QuickRangeOption {
  value: QuickRange;
  labelKey: string;
}

const quickRangeOptions: QuickRangeOption[] = [
  { value: "5h", labelKey: "dashboard.timeSelector.quick.5h" },
  { value: "24h", labelKey: "dashboard.timeSelector.quick.24h" },
  { value: "7d", labelKey: "dashboard.timeSelector.quick.7d" },
  { value: "30d", labelKey: "dashboard.timeSelector.quick.30d" },
];

const PAD_LENGTH = 2;

function dtPad(n: number): string {
  return n.toString().padStart(PAD_LENGTH, "0");
}

function jsDateToCalendarDate(d: Date): CalendarDate {
  return new CalendarDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

function formatDatetimeLabel(d: Date): string {
  return `${d.getFullYear()}-${dtPad(d.getMonth() + 1)}-${dtPad(d.getDate())} ${dtPad(d.getHours())}:${dtPad(d.getMinutes())}`;
}

function handleCalUpdate(
  val: DateValue | DateValue[] | undefined,
): CalendarDate | undefined {
  if (!val) return undefined;
  const dv = Array.isArray(val) ? val[0] : val;
  if (dv) return new CalendarDate(dv.year, dv.month, dv.day);
  return undefined;
}

const startPopoverOpen = ref(false);
const endPopoverOpen = ref(false);
const startCalDate = ref<CalendarDate | undefined>();
const startHourInput = ref("00");
const startMinuteInput = ref("00");
const endCalDate = ref<CalendarDate | undefined>();
const endHourInput = ref("00");
const endMinuteInput = ref("00");

function syncStartPopover() {
  const d = customStartDate;
  startCalDate.value = jsDateToCalendarDate(d);
  startHourInput.value = dtPad(d.getHours());
  startMinuteInput.value = dtPad(d.getMinutes());
}

function syncEndPopover() {
  const d = customEndDate;
  endCalDate.value = jsDateToCalendarDate(d);
  endHourInput.value = dtPad(d.getHours());
  endMinuteInput.value = dtPad(d.getMinutes());
}

function onStartCalUpdate(val: DateValue | DateValue[] | undefined) {
  startCalDate.value = handleCalUpdate(val);
}

function onEndCalUpdate(val: DateValue | DateValue[] | undefined) {
  endCalDate.value = handleCalUpdate(val);
}

function confirmStartDate() {
  if (startCalDate.value) {
    const h = parseInt(startHourInput.value, 10) || 0;
    const m = parseInt(startMinuteInput.value, 10) || 0;
    emit(
      "update:customStartDate",
      new Date(
        startCalDate.value.year,
        startCalDate.value.month - 1,
        startCalDate.value.day,
        h,
        m,
        0,
        0,
      ),
    );
  }
  startPopoverOpen.value = false;
}

function confirmEndDate() {
  if (endCalDate.value) {
    const h = parseInt(endHourInput.value, 10) || 0;
    const m = parseInt(endMinuteInput.value, 10) || 0;
    emit(
      "update:customEndDate",
      new Date(
        endCalDate.value.year,
        endCalDate.value.month - 1,
        endCalDate.value.day,
        h,
        m,
        0,
        0,
      ),
    );
  }
  endPopoverOpen.value = false;
}
</script>

<template>
  <div class="bg-card rounded-lg px-4 py-2.5 mb-3">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        <span class="font-mono text-xs font-medium text-foreground">
          {{ timeRangeLabel }}
        </span>
        <div class="flex gap-0.5">
          <Button
            v-for="opt in quickRangeOptions"
            :key="opt.value"
            :variant="activeRange === opt.value ? 'secondary' : 'ghost'"
            size="sm"
            class="h-7 px-3 text-xs font-mono"
            @click="selectQuickRange(opt.value)"
          >
            {{ t(opt.labelKey) }}
          </Button>
          <Button
            :variant="showCustom ? 'secondary' : 'ghost'"
            size="sm"
            class="h-7 px-3 text-xs font-mono"
            @click="toggleCustom"
          >
            {{ t("dashboard.timeSelector.custom") }}
          </Button>
        </div>
      </div>
    </div>

    <!-- Custom datetime picker (expanded below) -->
    <div v-if="showCustom" class="mt-2 space-y-1.5">
      <div class="flex flex-wrap items-center gap-2">
        <Label class="text-xs text-muted-foreground">{{
          t("dashboard.timeSelector.startDate")
        }}</Label>
        <Popover
          v-model:open="startPopoverOpen"
          @update:open="
            (v: boolean) => {
              if (v) syncStartPopover();
            }
          "
        >
          <PopoverTrigger as-child>
            <Button
              variant="outline"
              size="sm"
              class="h-7 px-2.5 text-xs font-mono"
            >
              {{ formatDatetimeLabel(customStartDate) }}
            </Button>
          </PopoverTrigger>
          <PopoverContent class="w-auto p-0" align="start">
            <div class="p-2">
              <Calendar
                :model-value="startCalDate"
                @update:model-value="onStartCalUpdate"
              />
              <div class="flex items-center gap-1.5 px-2 pb-2 pt-1">
                <Input
                  v-model="startHourInput"
                  class="h-7 w-12 text-center text-xs font-mono"
                  placeholder="HH"
                />
                <span class="text-xs text-muted-foreground">:</span>
                <Input
                  v-model="startMinuteInput"
                  class="h-7 w-12 text-center text-xs font-mono"
                  placeholder="MM"
                />
                <Button
                  size="sm"
                  class="h-7 ml-auto"
                  @click="confirmStartDate"
                  >{{ t("common.ok") }}</Button
                >
              </div>
            </div>
          </PopoverContent>
        </Popover>
        <Label class="text-xs text-muted-foreground">{{
          t("dashboard.timeSelector.endDate")
        }}</Label>
        <Popover
          v-model:open="endPopoverOpen"
          @update:open="
            (v: boolean) => {
              if (v) syncEndPopover();
            }
          "
        >
          <PopoverTrigger as-child>
            <Button
              variant="outline"
              size="sm"
              class="h-7 px-2.5 text-xs font-mono"
            >
              {{ formatDatetimeLabel(customEndDate) }}
            </Button>
          </PopoverTrigger>
          <PopoverContent class="w-auto p-0" align="start">
            <div class="p-2">
              <Calendar
                :model-value="endCalDate"
                @update:model-value="onEndCalUpdate"
              />
              <div class="flex items-center gap-1.5 px-2 pb-2 pt-1">
                <Input
                  v-model="endHourInput"
                  class="h-7 w-12 text-center text-xs font-mono"
                  placeholder="HH"
                />
                <span class="text-xs text-muted-foreground">:</span>
                <Input
                  v-model="endMinuteInput"
                  class="h-7 w-12 text-center text-xs font-mono"
                  placeholder="MM"
                />
                <Button size="sm" class="h-7 ml-auto" @click="confirmEndDate">{{
                  t("common.ok")
                }}</Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
        <Button size="sm" class="h-7" @click="applyCustom">
          {{ t("dashboard.timeSelector.apply") }}
        </Button>
      </div>
      <p v-if="customError" class="text-xs text-danger font-mono" role="alert">
        {{ customError }}
      </p>
    </div>
  </div>
</template>
