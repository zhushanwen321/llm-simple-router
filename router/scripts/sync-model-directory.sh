#!/usr/bin/env bash
# sync-model-directory.sh
# 从 ai-model-directory 拉取全量模型元数据，提取 capabilities 和 context_window，
# 生成精简 JSON 供路由器启动时加载。
#
# 用法: bash scripts/sync-model-directory.sh [--check]
#   --check  仅检查是否有更新，不写入文件（用于 CI）

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_DIR="$(dirname "$SCRIPT_DIR")/config"
OUTPUT="$CONFIG_DIR/model-directory.json"
SOURCE_URL="https://raw.githubusercontent.com/The-Best-Codes/ai-model-directory/main/data/all.min.json"
TMP_JSON="$(mktemp)"
TMP_COMPACT="$(mktemp)"
trap 'rm -f "$TMP_JSON" "$TMP_COMPACT"' EXIT

echo "[sync-model-directory] Fetching $SOURCE_URL ..."
if ! curl -sL --max-time 30 -o "$TMP_JSON" "$SOURCE_URL"; then
  echo "[sync-model-directory] ERROR: Failed to fetch all.min.json" >&2
  if [ -f "$OUTPUT" ]; then
  echo "[sync-model-directory] Keeping existing $OUTPUT"
  exit 0
  else
  echo "[sync-model-directory] No existing file, exiting with error" >&2
  exit 1
  fi
fi

# Validate JSON
if ! python3 -c "import json,sys; json.load(open('$TMP_JSON'))" 2>/dev/null; then
  echo "[sync-model-directory] ERROR: Downloaded file is not valid JSON" >&2
  if [ -f "$OUTPUT" ]; then
  echo "[sync-model-directory] Keeping existing $OUTPUT"
  exit 0
  else
  exit 1
  fi
fi

# Extract capabilities and context_windows
python3 - "$TMP_JSON" "$TMP_COMPACT" <<'PYEOF'
import json, sys

src = sys.argv[1]
dst = sys.argv[2]

with open(src) as f:
  data = json.load(f)

capabilities = {}
context_windows = {}

for _provider_id, provider in data.items():
  models = provider.get("models", {})
  for _model_id, model in models.items():
    mid = model.get("id", _model_id)
    # capabilities from modalities.input
    inputs = model.get("modalities", {}).get("input", ["text"])
    caps = []
    for cap in ("text", "image", "audio", "video"):
      if cap in inputs:
        caps.append(cap)
    if not caps:
      caps = ["text"]
    capabilities[mid] = caps
    # context window
    ctx = model.get("limit", {}).get("context")
    if isinstance(ctx, int) and ctx > 0:
      context_windows[mid] = ctx

with open(dst, "w") as f:
  json.dump({"capabilities": capabilities, "context_windows": context_windows}, f, separators=(",", ":"))

print(f"[sync-model-directory] Extracted {len(capabilities)} capabilities, {len(context_windows)} context_windows")
PYEOF

if [ ! -f "$TMP_COMPACT" ]; then
  echo "[sync-model-directory] ERROR: Python extraction failed" >&2
  exit 1
fi

# Check mode
if [ "${1:-}" = "--check" ]; then
  if [ -f "$OUTPUT" ]; then
  if diff -q "$OUTPUT" "$TMP_COMPACT" > /dev/null 2>&1; then
    echo "[sync-model-directory] No changes"
    exit 0
  fi
  fi
  echo "[sync-model-directory] Updates available"
  exit 0
fi

# Write output
mkdir -p "$CONFIG_DIR"
mv "$TMP_COMPACT" "$OUTPUT"
echo "[sync-model-directory] Written to $OUTPUT ($(wc -c < "$OUTPUT" | tr -d ' ') bytes)"
