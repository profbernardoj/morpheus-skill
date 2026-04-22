#!/bin/bash
# workspace-pii-remediation.sh
# Remediate PII in workspace files before committing
# Run with: bash scripts/workspace-pii-remediation.sh [--dry-run]
#
# This script applies the same PII replacements used in the git history rewrite
# to files in the workspace that have not yet been committed.

set +e  # Don't exit on non-zero returns (remediate_file returns 1 when changes found)

DRY_RUN=false
if [[ "$1" == "--dry-run" ]]; then
  DRY_RUN=true
  echo "=== DRY RUN MODE - No changes will be made ==="
  echo ""
fi

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Workspace root
WORKSPACE="$HOME/.openclaw/workspace"

# Counters
FILES_FIXED=0
TOTAL_REPLACEMENTS=0

# Function to apply remediation to a file
remediate_file() {
  local file="$1"
  local changes=0

  if [[ ! -f "$file" ]]; then
    return
  fi

  # Create backup
  if [[ "$DRY_RUN" == false ]]; then
    cp "$file" "${file}.bak"
  fi

  # Apply replacements
  # 1. Home directory paths
  sed -i '' 's|~|~|g' "$file" 2>/dev/null || true
  # 2. Full name -> generic
  sed -i '' 's|[REDACTED]|EverClaw Contributor|g' "$file" 2>/dev/null || true
  sed -i '' 's|[REDACTED]|EverClaw Contributor|g' "$file" 2>/dev/null || true
  # 3. Possessive
  sed -i '' "s|David's preference|default|g" "$file" 2>/dev/null || true
  sed -i '' "s|David's|the user's|g" "$file" 2>/dev/null || true
  # 4. Phone numbers
  sed -i '' 's|+15129488566|+1XXXXXXXXXX|g' "$file" 2>/dev/null || true
  sed -i '' 's|15129488566|XXXXXXXXXXX|g' "$file" 2>/dev/null || true
  # 5. Venice API keys
  sed -i '' 's|VENICE-INFERENCE-KEY-[A-Za-z0-9_-]*|VENICE-INFERENCE-KEY-REDACTED|g' "$file" 2>/dev/null || true
  # 6. Old Morpheus keys
  sed -i '' 's|sk-ZJXioE\.[a-f0-9]*|sk-REDACTED|g' "$file" 2>/dev/null || true
  # 7. 1Password references
  sed -i '' 's|Bernardo Agent Vault|AGENT_VAULT|g' "$file" 2>/dev/null || true
  sed -i '' 's|bernardo-agent|AGENT_USER|g' "$file" 2>/dev/null || true
  # 8. Church reference (in non-personal contexts)
  sed -i '' 's|Crossroads Church Austin|Crossroads Church|g' "$file" 2>/dev/null || true
  # 9. School district
  sed -i '' 's|Round Rock ISD|local school district|g' "$file" 2>/dev/null || true
  sed -i '' 's|RRISD|local ISD|g' "$file" 2>/dev/null || true
  # 10. Signal account
  sed -i '' 's|SIGNAL_ACCOUNT="+1XXXXXXXXXX"|SIGNAL_ACCOUNT="${SIGNAL_ACCOUNT:-}"|g' "$file" 2>/dev/null || true

  # Check if file changed
  if [[ -f "${file}.bak" ]]; then
    if ! diff -q "$file" "${file}.bak" > /dev/null 2>&1; then
      changes=1
      FILES_FIXED=$((FILES_FIXED + 1))
      echo -e "${GREEN}✓ Fixed:${NC} $file"
    else
      # No changes, remove backup
      rm "${file}.bak"
    fi
  fi

  return $changes
}

echo -e "${YELLOW}=== Workspace PII Remediation ===${NC}"
echo ""
echo "Target: $WORKSPACE"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# FILES TO REMEDIATE (from PII audit)
# ═══════════════════════════════════════════════════════════════════════════════

FILES_TO_FIX=(
  # Projects
  "$WORKSPACE/projects/soulbound-identity/README.md"
  "$WORKSPACE/projects/soulbound-identity/lib/hash-identity.mjs"
  "$WORKSPACE/projects/soulbound-identity/lib/registration-builder.mjs"
  "$WORKSPACE/projects/soulbound-identity/config/bernardo.json"
  "$WORKSPACE/projects/soulbound-identity/config/agents-roster.json"

  # Skills
  "$WORKSPACE/skills/night-shift/SKILL.md"
  "$WORKSPACE/skills/relationships/SKILL.md"

  # EverClaw fork
  "$WORKSPACE/everclaw-fork/LICENSE"
  "$WORKSPACE/everclaw-fork/scripts/mor-launch-headless.sh"
  "$WORKSPACE/everclaw-fork/scripts/gateway-guardian.sh"
  "$WORKSPACE/everclaw-fork/scripts/x402-client.mjs"
  "$WORKSPACE/everclaw-fork/SKILL.md"

  # Mission Control
  "$WORKSPACE/mission-control/index.html"

  # Shifts
  "$WORKSPACE/shifts/handoff.md"
  "$WORKSPACE/shifts/tasks.md"

  # Scripts
  "$WORKSPACE/scripts/coingecko-x402.mjs"
  "$WORKSPACE/scripts/finance-tracker-x402.mjs"
  "$WORKSPACE/scripts/finance-tracker.sh"
  "$WORKSPACE/scripts/filter-repo-pii.sh"
  "$WORKSPACE/scripts/fix-pii-all-repos.sh"
)

# ═══════════════════════════════════════════════════════════════════════════════
# RUN REMEDIATION
# ═══════════════════════════════════════════════════════════════════════════════

for file in "${FILES_TO_FIX[@]}"; do
  if [[ -f "$file" ]]; then
    if [[ "$DRY_RUN" == true ]]; then
      echo -e "${YELLOW}[DRY] Would check:${NC} $file"
    else
      remediate_file "$file"
    fi
  else
    echo -e "${YELLOW}Skipping (not found):${NC} $file"
  fi
done

# ═══════════════════════════════════════════════════════════════════════════════
# ADD TEMP FILES TO .gitignore
# ═══════════════════════════════════════════════════════════════════════════════

if [[ "$DRY_RUN" == false ]]; then
  echo ""
  echo -e "${YELLOW}=== Adding temp files to .gitignore ===${NC}"

  GITIGNORE="$WORKSPACE/.gitignore"

  # Add entries if not already present
  for pattern in "answers-msg*.txt" "report.txt"; do
    if ! grep -q "^$pattern$" "$GITIGNORE" 2>/dev/null; then
      echo "" >> "$GITIGNORE"
      echo "# Temporary files" >> "$GITIGNORE"
      echo "$pattern" >> "$GITIGNORE"
      echo -e "${GREEN}✓ Added to .gitignore:${NC} $pattern"
    fi
  done
fi

# ═══════════════════════════════════════════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════════════════════════════════════════

echo ""
echo -e "${YELLOW}=== Summary ===${NC}"
if [[ "$DRY_RUN" == true ]]; then
  echo "Dry run complete. ${#FILES_TO_FIX[@]} files would be checked."
  echo "Run without --dry-run to apply changes."
else
  echo "Files fixed: $FILES_FIXED"
  echo ""
  echo -e "${GREEN}✓ PII remediation complete${NC}"
  echo ""
  echo "Next steps:"
  echo "  1. Review changes: git diff"
  echo "  2. Run PII scan: pii-scan.sh --repo-scan ."
  echo "  3. If clean, commit: git add -A && git commit -m 'fix: remediate PII in workspace files'"
fi