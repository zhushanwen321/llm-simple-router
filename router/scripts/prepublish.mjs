// prepublish.mjs — npm publish 前确保编译产物完整
import { cpSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

// 1. 复制 migrations SQL 到 dist（tsc 不会复制非 TS 文件）
const migrationsSrc = resolve(root, "src/db/migrations");
const migrationsDest = resolve(root, "dist/db/migrations");
if (existsSync(migrationsSrc)) {
  cpSync(migrationsSrc, migrationsDest, { recursive: true });
  console.log("✅ Migrations copied to dist/db/migrations/");
}

// 2. 如果有前端构建产物，复制到 frontend-dist/
//    frontend 构建在 router 的父目录中完成
const frontendSrc = resolve(root, "../frontend/dist");
const frontendDest = resolve(root, "frontend-dist");
if (existsSync(frontendSrc)) {
  cpSync(frontendSrc, frontendDest, { recursive: true });
  console.log("✅ Frontend copied to frontend-dist/");
}
