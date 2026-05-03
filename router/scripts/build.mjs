import { cpSync, existsSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

// tsc 不会复制非 TS 文件，需要手动复制 migrations SQL
const migrationsSrc = resolve(root, "src/db/migrations");
const migrationsDest = resolve(root, "dist/db/migrations");
if (existsSync(migrationsSrc)) {
  cpSync(migrationsSrc, migrationsDest, { recursive: true });
  console.log("Migrations copied to dist/db/migrations/");
}

// 始终重新构建前端，避免发布时复用旧产物
const frontendDist = resolve(root, "frontend-dist");
if (existsSync(frontendDist)) {
  rmSync(frontendDist, { recursive: true });
}
console.log("Building frontend...");
execSync("npm run build", {
  cwd: resolve(root, "frontend"),
  stdio: "inherit",
});
const frontendBuild = resolve(root, "frontend/dist");
if (existsSync(frontendBuild)) {
  cpSync(frontendBuild, frontendDist, { recursive: true });
  console.log("Frontend built and copied to frontend-dist/");
}
