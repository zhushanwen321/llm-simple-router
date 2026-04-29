/**
 * 轻量服务容器 — 懒加载单例工厂注册表。
 *
 * 用法：
 *   const c = new ServiceContainer();
 *   c.register("db", () => db);
 *   c.register("tracker", (c) => new RequestTracker(c.resolve("db")));
 *   const tracker = c.resolve<RequestTracker>("tracker");
 *
 * 注册的工厂最多执行一次（惰性求值 + 缓存）。
 */
export class ServiceContainer {
  private readonly factories = new Map<string, (c: ServiceContainer) => unknown>();
  private readonly cache = new Map<string, unknown>();

  /** 注册服务工厂。重复注册同一 key 会覆盖（但已缓存的实例不会被清除）。 */
  register<T>(key: string, factory: (c: ServiceContainer) => T): void {
    this.factories.set(key, factory);
  }

  /** 获取服务实例。首次调用时执行工厂并缓存。 */
  resolve<T>(key: string): T {
    if (this.cache.has(key)) return this.cache.get(key) as T;

    const factory = this.factories.get(key);
    if (!factory) throw new Error(`Service not registered: "${key}"`);

    const instance = factory(this);
    this.cache.set(key, instance);
    return instance as T;
  }
}
