import { FastifyPluginCallback } from "fastify"
import Database from "better-sqlite3"
import { getRecommendedProviders, getRecommendedRetryRules, reloadConfig } from "../config/recommended.js"

interface RecommendedRoutesOptions {
  db: Database.Database
}

export const adminRecommendedRoutes: FastifyPluginCallback<RecommendedRoutesOptions> = (app, options, done) => {
  const { db } = options

  app.get("/admin/api/recommended/providers", async (_req, reply) => {
    return reply.send(getRecommendedProviders())
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
