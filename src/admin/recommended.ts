import { FastifyPluginCallback } from "fastify"
import Database from "better-sqlite3"
import { getRecommendedProviders, getRecommendedRetryRules, reloadConfig } from "../config/recommended.js"

interface RecommendedRoutesOptions {
  db: Database.Database
}

export const adminRecommendedRoutes: FastifyPluginCallback<RecommendedRoutesOptions> = (app, options, done) => {
  const { db } = options

  app.get("/admin/api/recommended/providers", async (_req, reply) => {
    const groups = getRecommendedProviders()

    const existing = new Set<string>(
      (db.prepare("SELECT name FROM providers").all() as { name: string }[]).map((r) => r.name),
    )

    const filtered = groups
      .map((g) => ({
        ...g,
        presets: g.presets.filter((p) => !existing.has(p.presetName)),
      }))
      .filter((g) => g.presets.length > 0)

    return reply.send(filtered)
  })

  app.get("/admin/api/recommended/retry-rules", async (_req, reply) => {
    const rules = getRecommendedRetryRules()

    const existing = new Set<string>(
      (db.prepare("SELECT name FROM retry_rules").all() as { name: string }[]).map((r) => r.name),
    )

    return reply.send(rules.filter((r) => !existing.has(r.name)))
  })

  app.post("/admin/api/recommended/reload", async (_req, reply) => {
    reloadConfig()
    return reply.send({ ok: true })
  })

  done()
}
