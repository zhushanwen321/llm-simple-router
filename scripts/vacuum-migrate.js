#!/usr/bin/env node
/**
 * One-time script to switch existing database to auto_vacuum=INCREMENTAL mode.
 * Requires VACUUM which locks the database for the duration.
 * Run during a maintenance window.
 *
 * Usage: node scripts/vacuum-migrate.js [db-path]
 * Default db-path: ~/.llm-simple-router/router.db
 */
import Database from "better-sqlite3";
import { homedir } from "os";
import { join } from "path";

const dbPath = process.argv[2] || join(homedir(), ".llm-simple-router", "router.db");
console.log(`Migrating database: ${dbPath}`);

const db = new Database(dbPath);

const [{ auto_vacuum }] = db.pragma("auto_vacuum");
console.log(`Current auto_vacuum: ${auto_vacuum} (0=NONE, 1=FULL, 2=INCREMENTAL)`);

if (auto_vacuum === 2) {
  console.log("Already in INCREMENTAL mode. Checking if VACUUM is needed...");
} else {
  console.log("Setting auto_vacuum = INCREMENTAL...");
  db.pragma("auto_vacuum = INCREMENTAL");
}

const [{ page_count: beforePages }] = db.pragma("page_count");
const [{ page_size: pageSize }] = db.pragma("page_size");
console.log(`Pages before VACUUM: ${beforePages} (page size: ${pageSize})`);
console.log("Running VACUUM (this may take several minutes for large databases)...");

const start = Date.now();
db.exec("VACUUM");
const elapsed = ((Date.now() - start) / 1000).toFixed(1);

const [{ page_count: afterPages }] = db.pragma("page_count");
console.log(`Pages after VACUUM: ${afterPages}`);
console.log(`Freed ${beforePages - afterPages} pages (~${((beforePages - afterPages) * pageSize / 1024 / 1024).toFixed(1)} MB)`);
console.log(`Completed in ${elapsed}s`);

db.close();
