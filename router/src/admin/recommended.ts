import { FastifyPluginCallback } from "fastify"
import Database from "better-sqlite3"
import { getRecommendedProviders, getRecommendedRetryRules, reloadConfig } from "../config/recommended.js"
import { lookupCapabilities } from "../config/model-context.js"

interface RecommendedRoutesOptions {
  db: Database.Database
}

export const adminRecommendedRoutes: FastifyPluginCallback<RecommendedRoutesOptions> = (app, options, done) => {
  const { db } = options

  app.get("/admin/api/recommended/providers", async (_req, reply) => {
    const groups = getRecommendedProviders()
    // 给每个预设的模型补上 capabilities
    for (const group of groups) {
      for (const preset of group.presets) {
        const capMap: Record<string, string[]> = {}
        for (const m of preset.models) {
          capMap[m] = lookupCapabilities(m)
        }
        preset.modelCapabilities = capMap
      }
    }
    return reply.send(groups)
  })

  app.get("/admin/api/recommended/retry-rules", async (_req, reply) => {
    const rules = getRecommendedRetryRules()

    const existing = new Set<string>(
      (db.prepare("SELECT name FROM retry_rules").all() as { name: string }[]).map((r) => r.name),
    )

    // Return all rules with `exists` flag, so the frontend can show all and mark existing ones
    return reply.send(rules.map(r => ({
      ...r,
      exists: existing.has(r.name),
    })))
  })

  app.post("/admin/api/recommended/reload", async (_req, reply) => {
    reloadConfig()
    return reply.send({ ok: true })
  })

  done()
}
