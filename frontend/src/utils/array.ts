/**
 * 通用数组工具函数
 */

/**
 * 将数组中 from 位置的元素移动到 to 位置，返回新数组（immutable）。
 * 不修改原数组。
 *
 * @param arr - 原数组
 * @param from - 源索引
 * @param to - 目标索引（插入位置）
 * @returns 新数组，元素顺序已调整
 */
export function moveItem<T>(arr: readonly T[], from: number, to: number): T[] {
  if (from === to) return [...arr];
  const result = [...arr];
  const [item] = result.splice(from, 1);
  result.splice(to, 0, item);
  return result;
}
