import { moveItem } from "../array";

describe("moveItem", () => {
  it("前移：将第 0 个元素移到第 2 位", () => {
    expect(moveItem([1, 2, 3, 4], 0, 2)).toEqual([2, 3, 1, 4]);
  });

  it("末→首：将最后一个元素移到最前面", () => {
    expect(moveItem([1, 2, 3, 4], 3, 0)).toEqual([4, 1, 2, 3]);
  });

  it("首→末边界：将第一个元素移到最后", () => {
    expect(moveItem([1, 2, 3, 4], 0, 3)).toEqual([2, 3, 4, 1]);
  });

  it("相邻交换：将第 1 个元素与第 2 个交换", () => {
    expect(moveItem([1, 2, 3, 4], 1, 2)).toEqual([1, 3, 2, 4]);
  });

  it("no-op：to === from 时返回相同顺序", () => {
    expect(moveItem([1, 2, 3, 4], 1, 1)).toEqual([1, 2, 3, 4]);
  });

  it("空数组", () => {
    expect(moveItem([], 0, 0)).toEqual([]);
  });

  it("单元素 no-op", () => {
    expect(moveItem([1], 0, 0)).toEqual([1]);
  });

  it("to 超出数组末尾时追加到末尾", () => {
    expect(moveItem([1, 2, 3, 4], 0, 10)).toEqual([2, 3, 4, 1]);
  });

  it("不修改原数组（immutable）", () => {
    const original = [1, 2, 3, 4];
    const result = moveItem(original, 0, 2);
    expect(original).toEqual([1, 2, 3, 4]);
    expect(result).not.toBe(original);
  });
});
