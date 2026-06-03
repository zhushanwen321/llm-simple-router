/** Token 格式化常量 */
const TOKEN_BILLION = 1_000_000_000;
const TOKEN_MILLION = 1_000_000;
const TOKEN_THOUSAND = 1_000;
const SIG_DIGIT_THRESHOLD = 10;
const SIG_DIGIT_DECIMALS = 10;

/**
 * 将 token 数量格式化为紧凑字符串：
 * 0 → "0"
 * 500 → "500"
 * 1_500 → "1.5K"
 * 1_500_000 → "1.5M"
 * 1_200_000_000 → "1.2B"
 *
 * 四舍五入到个位（如 1,523,000 → "1.5M"，1,980,000 → "2M"）
 */
export function formatTokenCompact(tokens: number): string {
  if (tokens === 0) return "0";

  const abs = Math.abs(tokens);
  const sign = tokens < 0 ? "-" : "";

  if (abs >= TOKEN_BILLION) {
    return sign + roundToSigDigit(abs / TOKEN_BILLION) + "B";
  }
  if (abs >= TOKEN_MILLION) {
    return sign + roundToSigDigit(abs / TOKEN_MILLION) + "M";
  }
  if (abs >= TOKEN_THOUSAND) {
    return sign + roundToSigDigit(abs / TOKEN_THOUSAND) + "K";
  }
  return sign + Math.round(abs).toString();
}

/**
 * 四舍五入到有效数字位：
 * - 如果值 < 10：保留 1 位小数（1.23 → "1.2"，9.96 → "10"）
 * - 否则：四舍五入到个位（10.4 → "10"，15.6 → "16"）
 */
function roundToSigDigit(value: number): string {
  if (value < SIG_DIGIT_THRESHOLD) {
    const rounded = Math.round(value * SIG_DIGIT_DECIMALS) / SIG_DIGIT_DECIMALS;
    // 避免浮点: 1.0 → "1" 而不是 "1.0"
    if (Number.isInteger(rounded)) return rounded.toString();
    return rounded.toFixed(1);
  }
  return Math.round(value).toString();
}

/**
 * 格式化 token 数量用于 Provider 按钮标注。
 * 0 token 时不显示单位（返回空字符串），由调用方判断是否显示。
 */
export function formatProviderTokenLabel(tokens: number): string {
  if (tokens === 0) return "";
  return formatTokenCompact(tokens);
}
