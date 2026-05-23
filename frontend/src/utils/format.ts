import { i18n } from "@/i18n";

function currentLocale(): string {
  return i18n.global.locale.value;
}

/** 项目展示时区，所有用户可见的时间都应通过此常量格式化 */
const DISPLAY_TZ = "Asia/Shanghai";

const TZ_OPTS: Intl.DateTimeFormatOptions = { timeZone: DISPLAY_TZ };

// --- 解析 ---

/** 将后端返回的 UTC datetime 字符串正确解析为 Date（补 Z 后缀避免被当作本地时间） */
export function parseUtc(iso: string): Date {
  return new Date(
    iso.endsWith("Z") || iso.includes("+") ? iso : iso.replace(" ", "T") + "Z",
  );
}

// --- 格式化 ---

/** 完整时间：2026/04/25 20:21:00 */
export function formatTime(iso: string): string {
  return parseUtc(iso).toLocaleString(currentLocale(), TZ_OPTS);
}

/** 短时间：04/25 20:21（用于表格、图表标签等紧凑场景） */
export function formatTimeShort(iso: string): string {
  return parseUtc(iso).toLocaleString(currentLocale(), {
    ...TZ_OPTS,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 仅时分：20:21（用于图表 x 轴等） */
export function formatTimeHM(date: Date): string {
  return date.toLocaleTimeString(currentLocale(), {
    ...TZ_OPTS,
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 时分秒：14:32:18（用于日志表格等紧凑场景） */
export function formatTimeHMS(iso: string): string {
  const d = parseUtc(iso);
  const parts = new Intl.DateTimeFormat(currentLocale(), {
    ...TZ_OPTS,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('hour')}:${get('minute')}:${get('second')}`;
}

/** 月日时分：4/25 20:00（用于长周期图表标签） */
export function formatTimeMDH(date: Date): string {
  return date.toLocaleString(currentLocale(), {
    ...TZ_OPTS,
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// --- 数值格式化 ---

/** 日期字符串 → ISO 开始时间（00:00:00.000Z） */
export function toIsoStart(dateStr: string): string {
  if (dateStr.includes("T")) return `${dateStr}:00.000Z`;
  return `${dateStr}T00:00:00.000Z`;
}

/** 日期字符串 → ISO 结束时间（23:59:59.999Z） */
export function toIsoEnd(dateStr: string): string {
  if (dateStr.includes("T")) return `${dateStr}:59.999Z`;
  return `${dateStr}T23:59:59.999Z`;
}

const BYTES_PER_KB = 1024;
const BYTES_PER_MB = BYTES_PER_KB * BYTES_PER_KB;

/** 字节数 → 可读字符串（B / KB / MB） */
export function formatBytes(bytes: number): string {
  if (bytes < BYTES_PER_KB) return `${bytes}B`;
  if (bytes < BYTES_PER_MB) return `${(bytes / BYTES_PER_KB).toFixed(1)}KB`;
  return `${(bytes / BYTES_PER_MB).toFixed(1)}MB`;
}
export function formatSize(text: string): string {
  const bytes = new TextEncoder().encode(text).length;
  if (bytes < BYTES_PER_KB) return `${bytes}B`;
  return `${(bytes / BYTES_PER_KB).toFixed(1)}KB`;
}

const CONTEXT_MILLION = 1_000_000;
const CONTEXT_THOUSAND = 1_000;

/** 上下文窗口数字 → 可读字符串（n / nK / nM） */
export function formatContextWindow(n: number): string {
  if (n >= CONTEXT_MILLION) return `${n / CONTEXT_MILLION}M`;
  if (n >= CONTEXT_THOUSAND) return `${n / CONTEXT_THOUSAND}K`;
  return `${n}`;
}
