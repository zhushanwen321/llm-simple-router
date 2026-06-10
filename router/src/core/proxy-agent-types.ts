/**
 * Proxy Agent 缓存失效接口。
 * admin 层通过此接口在 provider 更新/删除时清除对应的 proxy agent 缓存，
 * 解耦对 proxy 层的直接类型依赖。
 */

export interface IProxyAgentInvalidator {
  /** 使指定 provider 的代理 agent 缓存失效 */
  invalidate(providerId: string): void;
}
