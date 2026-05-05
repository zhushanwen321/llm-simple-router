import { createRequire } from "module";
import type Database from "better-sqlite3";
import { existsSync, readdirSync } from "fs";
import { join, resolve } from "path";
import type { TransformPlugin, RequestTransformContext, ResponseTransformContext } from "./plugin-types.js";
import { pluginMatches } from "./plugin-types.js";
import { getAllActiveRules, type TransformRules } from "../../db/transform-rules.js";

const esmRequire = createRequire(import.meta.url);

export class PluginRegistry {
  private plugins: TransformPlugin[] = [];
  private rulesCache: Map<string, TransformRules> = new Map();

  registerPlugin(plugin: TransformPlugin): void {
    this.plugins.push(plugin);
  }

  loadFromDB(db: Database.Database): void {
    const rules = getAllActiveRules(db);
    this.rulesCache.clear();
    for (const rule of rules) {
      this.rulesCache.set(rule.provider_id, rule);
      this.plugins.push(this.ruleToPlugin(rule));
    }
  }

  scanPluginsDir(dir: string): string[] {
    const resolvedDir = resolve(dir);
    const loaded: string[] = [];
    if (!existsSync(resolvedDir)) {
      return loaded;
    }
    const files = readdirSync(resolvedDir).filter(
      (f) => f.endsWith(".js") || f.endsWith(".mjs"),
    );
    for (const file of files) {
      const filePath = join(resolvedDir, file);
      try {
        delete esmRequire.cache[esmRequire.resolve(filePath)];
        const mod = esmRequire(filePath);
        const plugin: TransformPlugin = mod.default || mod;
        if (!plugin.name) {
          continue;
        }
        this.plugins.push(plugin);
        loaded.push(`${plugin.name} (${file})`);
        // eslint-disable-next-line taste/no-silent-catch -- don't crash server for bad plugin
      } catch (err) {
        console.error(`[plugin-registry] Failed to load plugin from ${file}:`, err);
      }
    }
    return loaded;
  }

  getMatchingPlugins(
    provider: { id: string; name: string; api_type: string },
  ): TransformPlugin[] {
    return this.plugins.filter((p) => pluginMatches(p, provider));
  }

  applyBeforeRequest(ctx: RequestTransformContext): void {
    for (const p of this.getMatchingPlugins(ctx.provider)) {
      try {
        p.beforeRequestTransform?.(ctx);
      } catch (err) { // eslint-disable-line taste/no-silent-catch
        console.error(`[plugin-registry] Plugin "${p.name}" beforeRequestTransform error:`, err);
      }
    }
  }

  applyAfterRequest(ctx: RequestTransformContext): void {
    for (const p of this.getMatchingPlugins(ctx.provider)) {
      try {
        p.afterRequestTransform?.(ctx);
      } catch (err) { // eslint-disable-line taste/no-silent-catch
        console.error(`[plugin-registry] Plugin "${p.name}" afterRequestTransform error:`, err);
      }
    }
  }

  applyBeforeResponse(ctx: ResponseTransformContext): void {
    for (const p of this.getMatchingPlugins(ctx.provider)) {
      try {
        p.beforeResponseTransform?.(ctx);
      } catch (err) { // eslint-disable-line taste/no-silent-catch
        console.error(`[plugin-registry] Plugin "${p.name}" beforeResponseTransform error:`, err);
      }
    }
  }

  applyAfterResponse(ctx: ResponseTransformContext): void {
    for (const p of this.getMatchingPlugins(ctx.provider)) {
      try {
        p.afterResponseTransform?.(ctx);
      } catch (err) { // eslint-disable-line taste/no-silent-catch
        console.error(`[plugin-registry] Plugin "${p.name}" afterResponseTransform error:`, err);
      }
    }
  }

  reload(
    db: Database.Database,
    pluginsDir: string,
  ): { loadedPlugins: string[]; rulesCount: number } {
    this.plugins = [];
    this.rulesCache.clear();
    this.loadFromDB(db);
    const loadedPlugins = this.scanPluginsDir(pluginsDir);
    return { loadedPlugins, rulesCount: this.rulesCache.size };
  }

  private ruleToPlugin(rule: TransformRules): TransformPlugin {
    return {
      name: `declarative:${rule.provider_id}`,
      match: { providerId: rule.provider_id },
      afterRequestTransform(ctx: RequestTransformContext): void {
        if (rule.request_defaults) {
          for (const [key, val] of Object.entries(rule.request_defaults)) {
            if (ctx.body[key] === undefined) ctx.body[key] = val;
          }
        }
        if (rule.drop_fields) {
          for (const field of rule.drop_fields) {
            delete ctx.body[field];
          }
        }
        if (rule.field_overrides) {
          for (const [key, val] of Object.entries(rule.field_overrides)) {
            ctx.body[key] = val;
          }
        }
        if (rule.inject_headers) {
          for (const [key, val] of Object.entries(rule.inject_headers)) {
            ctx.headers[key] = val;
          }
        }
      },
      afterResponseTransform(): void {
        // field_overrides only applies to request direction;
        // response should reflect actual upstream data, not override rules
      },
    };
  }
}
