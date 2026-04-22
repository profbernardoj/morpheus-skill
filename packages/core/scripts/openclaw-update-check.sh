#!/bin/bash
set -euo pipefail

# OpenClaw Update Safety Check
# Run this BEFORE applying an OpenClaw update to verify nothing has changed
# that could compromise the installation.
#
# Usage: bash openclaw-update-check.sh [path-to-openclaw]
#
# Checks:
#   1. MIT license present and unmodified
#   2. No unexpected OpenAI integration references
#   3. No openai npm package in dependencies
#   4. Version and git info for audit trail

OPENCLAW_DIR="${1:-$(npm root -g 2>/dev/null)/openclaw}"
FAIL=0
WARN=0

echo "=== OpenClaw Pre-Update Safety Check ==="
echo "Directory: $OPENCLAW_DIR"
echo ""

if [[ ! -d "$OPENCLAW_DIR" ]]; then
  echo "❌ Directory not found: $OPENCLAW_DIR"
  echo "   Usage: bash openclaw-update-check.sh /path/to/openclaw"
  exit 1
fi

cd "$OPENCLAW_DIR"

# --- 1. License Check ---
echo "1. Checking license..."

if [[ -f LICENSE ]]; then
  LICENSE_HEAD=$(head -1 LICENSE 2>/dev/null || echo "")
  if echo "$LICENSE_HEAD" | grep -qi "MIT"; then
    echo "  [OK] MIT license found"
  else
    echo "  [FAIL] License may have changed:"
    echo "    $LICENSE_HEAD"
    FAIL=$((FAIL + 1))
  fi
else
  echo "  [FAIL] No LICENSE file found"
  FAIL=$((FAIL + 1))
fi

# --- 2. OpenAI Integration Check ---
echo ""
echo "2. Checking for OpenAI integration..."

OPENAI_COUNT=$(grep -ri "openai" . --include="*.js" --include="*.json" --include="*.ts" 2>/dev/null \
  | grep -v node_modules | grep -v ".d.ts" | grep -v "openai-completions" | grep -v "openai-compatible" \
  | grep -v "CHANGELOG" | grep -v "package-lock" | wc -l || true)
OPENAI_COUNT=$(echo "$OPENAI_COUNT" | tr -d ' \n')

if [[ "$OPENAI_COUNT" == "0" ]]; then
  echo "  [OK] No unexpected OpenAI references found"
else
  echo "  [WARN] Found $OPENAI_COUNT OpenAI references:"
  grep -ri "openai" . --include="*.js" --include="*.json" --include="*.ts" 2>/dev/null \
    | grep -v node_modules | grep -v ".d.ts" | grep -v "openai-completions" | grep -v "openai-compatible" \
    | grep -v "CHANGELOG" | grep -v "package-lock" | head -20 || true
  echo ""
  echo "  Review these matches before proceeding."
  WARN=$((WARN + 1))
fi

# --- 3. Package Dependency Check ---
echo ""
echo "3. Checking for openai npm dependency..."

if [[ -f package.json ]]; then
  if grep -q '"openai"' package.json 2>/dev/null; then
    echo "  [FAIL] openai package found in package.json:"
    grep '"openai"' package.json
    FAIL=$((FAIL + 1))
  else
    echo "  [OK] No openai package in package.json"
  fi
else
  echo "  [WARN] No package.json found (npm global install)"
  WARN=$((WARN + 1))
fi

# --- 4. Version Info ---
echo ""
echo "4. Installation info..."

if [[ -d .git ]]; then
  echo "  Git repo found. Recent commits:"
  git log --oneline -10 2>/dev/null || echo "  [WARN] Could not read git log"
else
  echo "  [INFO] Not a git repo (npm installed)"
  echo "  Package version:"
  grep '"version"' package.json 2>/dev/null | head -1 || echo "  [WARN] Could not read version"
fi

# --- Summary ---
echo ""
echo "=== Check Complete ==="
echo ""

if [[ "$FAIL" -gt 0 ]]; then
  echo "❌ $FAIL FAIL(s), $WARN warning(s)"
  echo "   DO NOT UPDATE. Investigate failures first."
  exit 1
elif [[ "$WARN" -gt 0 ]]; then
  echo "⚠️  0 failures, $WARN warning(s)"
  echo "   Review warnings above, then proceed with:"
  echo "     openclaw update.run"
else
  echo "✅ All checks passed"
  echo "   Safe to proceed with:"
  echo "     openclaw update.run"
fi
