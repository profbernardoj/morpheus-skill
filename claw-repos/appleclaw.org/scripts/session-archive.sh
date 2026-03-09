#!/bin/bash
# session-archive.sh v2 — Smart session archiver for OpenClaw
#
# 5-phase cleanup:
#   Phase 1: Junk sweep — move .deleted.*, .reset.*, .tmp; remove .bak, .lock
#   Phase 2: Index hygiene — strip skillsSnapshot/systemPromptReport from sessions.json; prune orphan entries
#   Phase 3: Session rotation — archive .jsonl files older than KEEP_DAYS
#   Phase 4: Compression — tar+gz loose archive files into dated tarball
#   Phase 5: Multi-agent — iterate over all agents, not just main
#
# Usage:
#   bash session-archive.sh              # Run all phases if over threshold
#   bash session-archive.sh --check      # Dry-run report across all agents
#   bash session-archive.sh --force      # Run all phases regardless of size
#   bash session-archive.sh --verbose    # Show detailed output
#   bash session-archive.sh --phase 1    # Run only a specific phase (1-4)
#
# Environment:
#   ARCHIVE_THRESHOLD_MB  — trigger threshold in MB (default: 10)
#   SESSIONS_DIR          — override sessions directory (skips multi-agent)
#   KEEP_RECENT           — number of most-recent sessions to keep (default: 5)
#   KEEP_DAYS             — archive sessions older than N days (default: 3)
#   AGENTS_DIR            — agents root (default: ~/.openclaw/agents)
#   ALL_AGENTS            — iterate all agents (default: true)

set -uo pipefail

# ─── Configuration ────────────────────────────────────────────────────────────
ARCHIVE_THRESHOLD_MB="${ARCHIVE_THRESHOLD_MB:-10}"
KEEP_RECENT="${KEEP_RECENT:-5}"
KEEP_DAYS="${KEEP_DAYS:-3}"
AGENTS_DIR="${AGENTS_DIR:-$HOME/.openclaw/agents}"
ALL_AGENTS="${ALL_AGENTS:-true}"

# ─── Flags ────────────────────────────────────────────────────────────────────
CHECK_ONLY=false
FORCE=false
VERBOSE=false
PHASE_FILTER=0  # 0 = all phases

for arg in "$@"; do
  case "$arg" in
    --check)   CHECK_ONLY=true ;;
    --force)   FORCE=true ;;
    --verbose) VERBOSE=true ;;
    --phase)   PHASE_FILTER="__NEXT__" ;;
    [1-5])
      if [[ "$PHASE_FILTER" == "__NEXT__" ]]; then
        PHASE_FILTER="$arg"
      fi
      ;;
    --help|-h)
      cat <<'HELP'
Usage: session-archive.sh [--check] [--force] [--verbose] [--phase N]

Smart session archiver v2 — 5-phase cleanup for OpenClaw sessions.

Phases:
  1  Junk sweep    Move .deleted.*, .reset.*, .tmp; remove stale .bak/.lock
  2  Index hygiene Strip bloat fields from sessions.json; prune orphan entries
  3  Session rotate Archive .jsonl older than KEEP_DAYS (protecting active sessions)
  4  Compression   Tar+gz loose files in archive/ into dated tarball
  5  Multi-agent   (automatic) Iterates all agents in AGENTS_DIR

Options:
  --check    Report status without making changes (dry run)
  --force    Run regardless of current directory size
  --verbose  Show detailed per-file output
  --phase N  Run only phase N (1-4). Phase 5 wrapping is always active.

Environment:
  ARCHIVE_THRESHOLD_MB  Threshold in MB (default: 10)
  SESSIONS_DIR          Override sessions dir (disables multi-agent)
  KEEP_RECENT           Recent sessions to keep (default: 5)
  KEEP_DAYS             Age threshold in days (default: 3)
  AGENTS_DIR            Agents root (default: ~/.openclaw/agents)
  ALL_AGENTS            Iterate all agents (default: true)
HELP
      exit 0
      ;;
  esac
done

# Fix phase filter if --phase was last arg with no number
[[ "$PHASE_FILTER" == "__NEXT__" ]] && PHASE_FILTER=0

# ─── Logging ──────────────────────────────────────────────────────────────────
log()  { echo "[session-archive] $*"; }
vlog() { $VERBOSE && echo "[session-archive]   $*"; }

# ─── Global stats (accumulated across all agents) ────────────────────────────
STAT_JUNK_MOVED=0
STAT_JUNK_REMOVED=0
STAT_INDEX_FIELDS_STRIPPED=0
STAT_INDEX_ORPHANS_PRUNED=0
STAT_INDEX_BYTES_SAVED=0
STAT_SESSIONS_ARCHIVED=0
STAT_SESSIONS_FREED_KB=0
STAT_TARBALL_COUNT=0
STAT_AGENTS_PROCESSED=0

# ─── Phase 1: Junk Sweep ─────────────────────────────────────────────────────
# Moves .deleted.*, .reset.*, .tmp files to archive/
# Removes stale .bak and .lock files (non-recoverable junk)
phase_junk_sweep() {
  local sessions_dir="$1"
  local archive_dir="$sessions_dir/archive"
  local agent_name="$2"
  local moved=0
  local removed=0

  log "Phase 1: Junk sweep [$agent_name]"

  # Collect junk files: .deleted.*, .reset.*, *.tmp
  local -a move_targets=()
  while IFS= read -r -d '' f; do
    move_targets+=("$f")
  done < <(find "$sessions_dir" -maxdepth 1 -type f \( \
    -name "*.deleted.*" -o \
    -name "*.reset.*" -o \
    -name "*.tmp" \
  \) -print0 2>/dev/null)

  # Collect removable junk: *.bak, *.lock
  local -a remove_targets=()
  while IFS= read -r -d '' f; do
    remove_targets+=("$f")
  done < <(find "$sessions_dir" -maxdepth 1 -type f \( \
    -name "*.bak" -o \
    -name "*.lock" \
  \) -print0 2>/dev/null)

  local move_count=${#move_targets[@]}
  local remove_count=${#remove_targets[@]}

  if [[ $move_count -eq 0 && $remove_count -eq 0 ]]; then
    log "  No junk files found"
    return
  fi

  log "  Found: $move_count to archive, $remove_count to remove"

  if $CHECK_ONLY; then
    for f in "${move_targets[@]}"; do
      vlog "Would archive: $(basename "$f")"
    done
    for f in "${remove_targets[@]}"; do
      vlog "Would remove: $(basename "$f")"
    done
    return
  fi

  # Move .deleted/.reset/.tmp → archive/
  if [[ $move_count -gt 0 ]]; then
    mkdir -p "$archive_dir"
    for f in "${move_targets[@]}"; do
      local fname
      fname=$(basename "$f")
      if mv "$f" "$archive_dir/$fname" 2>/dev/null; then
        moved=$((moved + 1))
        vlog "Archived: $fname"
      else
        log "  WARNING: Failed to move $fname"
      fi
    done
  fi

  # Remove .bak/.lock
  for f in "${remove_targets[@]}"; do
    local fname
    fname=$(basename "$f")
    if rm -f "$f" 2>/dev/null; then
      removed=$((removed + 1))
      vlog "Removed: $fname"
    else
      log "  WARNING: Failed to remove $fname"
    fi
  done

  log "  Done: $moved archived, $removed removed"
  STAT_JUNK_MOVED=$((STAT_JUNK_MOVED + moved))
  STAT_JUNK_REMOVED=$((STAT_JUNK_REMOVED + removed))
}

# ─── Phase 2: Index Hygiene ───────────────────────────────────────────────────
# Strips skillsSnapshot and systemPromptReport from sessions.json entries.
# Prunes entries whose .jsonl file no longer exists on disk.
# Backs up sessions.json before any mutation.
phase_index_hygiene() {
  local sessions_dir="$1"
  local agent_name="$2"
  local index_file="$sessions_dir/sessions.json"

  log "Phase 2: Index hygiene [$agent_name]"

  if [[ ! -f "$index_file" ]]; then
    log "  No sessions.json found — skipping"
    return
  fi

  local before_bytes
  before_bytes=$(wc -c < "$index_file" | tr -d ' ')

  # Back up sessions.json BEFORE any mutation
  if ! $CHECK_ONLY; then
    local backup_file="${index_file}.pre-v2-$(date +%Y%m%dT%H%M%S).bak"
    cp "$index_file" "$backup_file" 2>/dev/null
    vlog "Backup: $(basename "$backup_file")"
  fi

  # Use Python for safe JSON manipulation
  local result
  result=$(python3 -c "
import json, os, sys

index_file = sys.argv[1]
sessions_dir = sys.argv[2]
check_only = sys.argv[3] == 'true'

STRIP_FIELDS = ['skillsSnapshot', 'systemPromptReport']

with open(index_file, 'r') as f:
    data = json.load(f)

if not isinstance(data, dict):
    print('ERROR:not a dict')
    sys.exit(0)

fields_stripped = 0
orphans_pruned = 0
orphan_keys = []

for key, val in list(data.items()):
    if not isinstance(val, dict):
        continue

    # Strip bloat fields
    for field in STRIP_FIELDS:
        if field in val:
            fields_stripped += 1
            if not check_only:
                del val[field]

    # Check for orphan entries (no matching .jsonl on disk)
    sid = val.get('sessionId', '')
    if sid:
        jsonl_path = os.path.join(sessions_dir, f'{sid}.jsonl')
        if not os.path.exists(jsonl_path):
            orphans_pruned += 1
            orphan_keys.append(key)

if not check_only and (fields_stripped > 0 or orphans_pruned > 0):
    # Remove orphan entries
    for k in orphan_keys:
        del data[k]

    # Write back compacted
    with open(index_file, 'w') as f:
        json.dump(data, f, separators=(',', ':'))

# Calculate new size
if check_only or (fields_stripped == 0 and orphans_pruned == 0):
    after_bytes = os.path.getsize(index_file)
else:
    after_bytes = os.path.getsize(index_file)

print(f'OK:{fields_stripped}:{orphans_pruned}:{after_bytes}')
" "$index_file" "$sessions_dir" "$($CHECK_ONLY && echo true || echo false)" 2>&1)

  if [[ "$result" == ERROR:* ]]; then
    log "  WARNING: sessions.json is not a dict — skipping"
    return
  fi

  if [[ "$result" != OK:* ]]; then
    log "  WARNING: Python processing failed: $result"
    return
  fi

  # Parse result: OK:fields_stripped:orphans_pruned:after_bytes
  local fields_stripped orphans_pruned after_bytes
  IFS=':' read -r _ fields_stripped orphans_pruned after_bytes <<< "$result"

  if [[ "$fields_stripped" -eq 0 && "$orphans_pruned" -eq 0 ]]; then
    log "  Clean — no bloat fields or orphans found"
    return
  fi

  local saved_bytes=$((before_bytes - after_bytes))

  if $CHECK_ONLY; then
    log "  Would strip $fields_stripped bloat fields, prune $orphans_pruned orphan entries"
    log "  Estimated savings: ~${saved_bytes} bytes ($(echo "scale=1; $saved_bytes / 1024" | bc)KB)"
    # Still accumulate stats for summary even in check mode
    STAT_INDEX_FIELDS_STRIPPED=$((STAT_INDEX_FIELDS_STRIPPED + fields_stripped))
    STAT_INDEX_ORPHANS_PRUNED=$((STAT_INDEX_ORPHANS_PRUNED + orphans_pruned))
    return
  fi

  log "  Stripped $fields_stripped bloat fields, pruned $orphans_pruned orphan entries"
  log "  Saved: ${saved_bytes} bytes ($(echo "scale=1; $saved_bytes / 1024" | bc)KB)"
  log "  Index: ${before_bytes} → ${after_bytes} bytes"

  STAT_INDEX_FIELDS_STRIPPED=$((STAT_INDEX_FIELDS_STRIPPED + fields_stripped))
  STAT_INDEX_ORPHANS_PRUNED=$((STAT_INDEX_ORPHANS_PRUNED + orphans_pruned))
  STAT_INDEX_BYTES_SAVED=$((STAT_INDEX_BYTES_SAVED + saved_bytes))
}

# ─── Phase 3: Session Rotation ────────────────────────────────────────────────
# Archives .jsonl files older than KEEP_DAYS, protecting:
#   - The KEEP_RECENT newest files (regardless of age)
#   - guardian-health-probe.jsonl (system file)
# After archiving, prunes matching orphan entries from sessions.json.
phase_session_rotation() {
  local sessions_dir="$1"
  local agent_name="$2"
  local archive_dir="$sessions_dir/archive"

  log "Phase 3: Session rotation [$agent_name]"

  # Collect all .jsonl files with their mtime, sorted oldest-first
  # Format: "epoch_seconds /full/path"
  local -a all_files=()
  while IFS= read -r line; do
    [[ -n "$line" ]] && all_files+=("$line")
  done < <(
    find "$sessions_dir" -maxdepth 1 -name "*.jsonl" -type f -print0 2>/dev/null | \
    xargs -0 stat -f '%m %N' 2>/dev/null || \
    find "$sessions_dir" -maxdepth 1 -name "*.jsonl" -type f -printf '%T@ %p\n' 2>/dev/null
  )

  local total=${#all_files[@]}
  if [[ $total -eq 0 ]]; then
    log "  No .jsonl files found"
    return
  fi

  # Sort by epoch (oldest first)
  local -a sorted_files=()
  while IFS= read -r line; do
    sorted_files+=("$line")
  done < <(printf '%s\n' "${all_files[@]}" | sort -n)

  # Protected filenames (never archive these)
  local -a protected_names=("guardian-health-probe.jsonl")

  # Calculate age cutoff (KEEP_DAYS ago in epoch seconds)
  local cutoff_epoch
  cutoff_epoch=$(date -v-${KEEP_DAYS}d +%s 2>/dev/null || date -d "${KEEP_DAYS} days ago" +%s 2>/dev/null)

  # Identify the KEEP_RECENT newest files (from the end of sorted list)
  local -a keep_recent_paths=()
  local keep_start=$(( ${#sorted_files[@]} - KEEP_RECENT ))
  [[ $keep_start -lt 0 ]] && keep_start=0
  for (( i = keep_start; i < ${#sorted_files[@]}; i++ )); do
    local path
    path="${sorted_files[$i]#* }"  # strip epoch prefix
    keep_recent_paths+=("$path")
  done

  # Build archive candidates: old files that aren't protected or in KEEP_RECENT
  local -a candidates=()
  local -a candidate_sizes=()
  for entry in "${sorted_files[@]}"; do
    local epoch="${entry%% *}"
    local fpath="${entry#* }"
    local fname
    fname=$(basename "$fpath")

    # Skip if newer than cutoff
    [[ "$epoch" -gt "$cutoff_epoch" ]] && continue

    # Skip if protected name
    local is_protected=false
    for pname in "${protected_names[@]}"; do
      [[ "$fname" == "$pname" ]] && is_protected=true && break
    done
    $is_protected && continue

    # Skip if in KEEP_RECENT set
    local is_recent=false
    for rpath in "${keep_recent_paths[@]}"; do
      [[ "$fpath" == "$rpath" ]] && is_recent=true && break
    done
    $is_recent && continue

    candidates+=("$fpath")
    local fsize_kb
    fsize_kb=$(du -sk "$fpath" 2>/dev/null | awk '{print $1}')
    candidate_sizes+=("${fsize_kb:-0}")
  done

  local candidate_count=${#candidates[@]}

  if [[ $candidate_count -eq 0 ]]; then
    log "  No sessions older than ${KEEP_DAYS}d to archive (total: $total, keeping: $KEEP_RECENT newest)"
    return
  fi

  log "  Found $candidate_count sessions older than ${KEEP_DAYS}d (total: $total, protecting: $KEEP_RECENT newest)"

  if $CHECK_ONLY; then
    local check_kb=0
    for (( i = 0; i < candidate_count; i++ )); do
      vlog "Would archive: $(basename "${candidates[$i]}") (${candidate_sizes[$i]}KB)"
      check_kb=$((check_kb + candidate_sizes[$i]))
    done
    log "  Would free: ~$(echo "scale=1; $check_kb / 1024" | bc)MB"
    # Accumulate stats for summary
    STAT_SESSIONS_ARCHIVED=$((STAT_SESSIONS_ARCHIVED + candidate_count))
    STAT_SESSIONS_FREED_KB=$((STAT_SESSIONS_FREED_KB + check_kb))
    return
  fi

  # Archive
  mkdir -p "$archive_dir"
  local moved=0
  local freed_kb=0

  for (( i = 0; i < candidate_count; i++ )); do
    local fpath="${candidates[$i]}"
    local fname
    fname=$(basename "$fpath")
    local fsize_kb="${candidate_sizes[$i]}"

    if mv "$fpath" "$archive_dir/$fname" 2>/dev/null; then
      moved=$((moved + 1))
      freed_kb=$((freed_kb + fsize_kb))
      vlog "Archived: $fname (${fsize_kb}KB)"
    else
      log "  WARNING: Failed to move $fname"
    fi
  done

  local freed_mb
  freed_mb=$(echo "scale=1; $freed_kb / 1024" | bc)
  log "  Archived $moved sessions, freed ${freed_mb}MB"

  # Prune sessions.json entries for files we just moved
  local index_file="$sessions_dir/sessions.json"
  if [[ -f "$index_file" && $moved -gt 0 ]]; then
    local pruned
    pruned=$(python3 -c "
import json, os, sys

index_file = sys.argv[1]
sessions_dir = sys.argv[2]

with open(index_file, 'r') as f:
    data = json.load(f)

if not isinstance(data, dict):
    print('0')
    sys.exit(0)

pruned = 0
for key in list(data.keys()):
    val = data[key]
    if not isinstance(val, dict):
        continue
    sid = val.get('sessionId', '')
    if sid and not os.path.exists(os.path.join(sessions_dir, f'{sid}.jsonl')):
        del data[key]
        pruned += 1

if pruned > 0:
    with open(index_file, 'w') as f:
        json.dump(data, f, separators=(',', ':'))

print(pruned)
" "$index_file" "$sessions_dir" 2>/dev/null)

    if [[ "${pruned:-0}" -gt 0 ]]; then
      log "  Pruned $pruned orphan index entries"
      STAT_INDEX_ORPHANS_PRUNED=$((STAT_INDEX_ORPHANS_PRUNED + pruned))
    fi
  fi

  STAT_SESSIONS_ARCHIVED=$((STAT_SESSIONS_ARCHIVED + moved))
  STAT_SESSIONS_FREED_KB=$((STAT_SESSIONS_FREED_KB + freed_kb))
}

# ─── Phase 4: Compression ─────────────────────────────────────────────────────
# Compresses loose files in archive/ into a dated tarball.
# Skips if no loose files exist. Removes originals after successful tar+gz.
# Appends to existing dated tarball if one exists for today.
phase_compression() {
  local sessions_dir="$1"
  local agent_name="$2"
  local archive_dir="$sessions_dir/archive"

  log "Phase 4: Compression [$agent_name]"

  if [[ ! -d "$archive_dir" ]]; then
    log "  No archive directory — skipping"
    return
  fi

  # Collect loose files (anything that's not a .tar.gz, .bak, or directory)
  local -a loose_files=()
  while IFS= read -r -d '' f; do
    loose_files+=("$f")
  done < <(find "$archive_dir" -maxdepth 1 -type f \
    ! -name "*.tar.gz" \
    ! -name "*.bak" \
    -print0 2>/dev/null)

  local loose_count=${#loose_files[@]}

  if [[ $loose_count -eq 0 ]]; then
    log "  No loose files in archive — skipping"
    return
  fi

  # Measure loose file size
  local loose_kb=0
  for f in "${loose_files[@]}"; do
    local fk
    fk=$(du -sk "$f" 2>/dev/null | awk '{print $1}')
    loose_kb=$((loose_kb + ${fk:-0}))
  done
  local loose_mb
  loose_mb=$(echo "scale=1; $loose_kb / 1024" | bc)

  log "  Found $loose_count loose files (${loose_mb}MB) in archive/"

  if $CHECK_ONLY; then
    log "  Would compress into dated tarball"
    return
  fi

  # Build tarball name: sessions-YYYY-MM-DD.tar.gz
  local today
  today=$(date +%Y-%m-%d)
  local tarball="$archive_dir/sessions-${today}.tar.gz"

  # If tarball for today already exists, use a numbered suffix
  if [[ -f "$tarball" ]]; then
    local n=1
    while [[ -f "$archive_dir/sessions-${today}-${n}.tar.gz" ]]; do
      n=$((n + 1))
    done
    tarball="$archive_dir/sessions-${today}-${n}.tar.gz"
  fi

  # Build file list (basenames only — we tar from within archive_dir)
  local -a basenames=()
  for f in "${loose_files[@]}"; do
    basenames+=("$(basename "$f")")
  done

  # Create tarball
  if tar -czf "$tarball" -C "$archive_dir" "${basenames[@]}" 2>/dev/null; then
    local tar_kb
    tar_kb=$(du -sk "$tarball" 2>/dev/null | awk '{print $1}')
    local tar_mb
    tar_mb=$(echo "scale=1; ${tar_kb:-0} / 1024" | bc)
    local ratio
    if [[ "${tar_kb:-0}" -gt 0 && "$loose_kb" -gt 0 ]]; then
      ratio=$(echo "scale=1; $loose_kb / $tar_kb" | bc)
    else
      ratio="n/a"
    fi

    # Verify tarball is valid before removing originals
    if tar -tzf "$tarball" >/dev/null 2>&1; then
      # Remove loose originals
      local removed=0
      for f in "${loose_files[@]}"; do
        if rm -f "$f" 2>/dev/null; then
          removed=$((removed + 1))
        fi
      done

      log "  Created: $(basename "$tarball")"
      log "  ${loose_mb}MB → ${tar_mb}MB (${ratio}x compression), $removed files packed"
      STAT_TARBALL_COUNT=$((STAT_TARBALL_COUNT + 1))
    else
      log "  WARNING: Tarball verification failed — keeping loose files"
      rm -f "$tarball" 2>/dev/null
    fi
  else
    log "  WARNING: tar failed — keeping loose files"
    rm -f "$tarball" 2>/dev/null
  fi
}

# ─── Agent processing ────────────────────────────────────────────────────────
process_agent() {
  local sessions_dir="$1"
  local agent_name="$2"

  if [[ ! -d "$sessions_dir" ]]; then
    vlog "Skipping $agent_name — no sessions directory"
    return
  fi

  # Measure current size (excluding archive/)
  local size_kb=0
  while IFS= read -r fsize; do
    size_kb=$((size_kb + fsize))
  done < <(find "$sessions_dir" -maxdepth 1 -type f -exec du -sk {} + 2>/dev/null | awk '{print $1}')
  local size_mb
  size_mb=$(echo "scale=1; $size_kb / 1024" | bc)
  local threshold_kb=$((ARCHIVE_THRESHOLD_MB * 1024))

  local session_count
  session_count=$(find "$sessions_dir" -maxdepth 1 -name "*.jsonl" 2>/dev/null | wc -l | tr -d ' ')

  log "━━━ Agent: $agent_name ━━━"
  log "  Size: ${size_mb}MB | Sessions: $session_count | Threshold: ${ARCHIVE_THRESHOLD_MB}MB"

  # In check mode, always run all phases (they'll just report)
  # In normal mode, skip if under threshold (unless --force)
  if ! $CHECK_ONLY && ! $FORCE && [[ "$size_kb" -lt "$threshold_kb" ]]; then
    log "  ✅ Under threshold — skipping"
    STAT_AGENTS_PROCESSED=$((STAT_AGENTS_PROCESSED + 1))
    return
  fi

  if $CHECK_ONLY; then
    if [[ "$size_kb" -ge "$threshold_kb" ]]; then
      log "  ⚠️  OVER THRESHOLD — archiving recommended"
    else
      local headroom
      headroom=$(echo "scale=1; $ARCHIVE_THRESHOLD_MB - $size_mb" | bc)
      log "  ✅ Under threshold (${headroom}MB headroom)"
    fi
  fi

  # Run phases (respect --phase filter)
  [[ "$PHASE_FILTER" == 0 || "$PHASE_FILTER" == 1 ]] && phase_junk_sweep "$sessions_dir" "$agent_name"
  [[ "$PHASE_FILTER" == 0 || "$PHASE_FILTER" == 2 ]] && phase_index_hygiene "$sessions_dir" "$agent_name"
  [[ "$PHASE_FILTER" == 0 || "$PHASE_FILTER" == 3 ]] && phase_session_rotation "$sessions_dir" "$agent_name"
  [[ "$PHASE_FILTER" == 0 || "$PHASE_FILTER" == 4 ]] && phase_compression "$sessions_dir" "$agent_name"

  STAT_AGENTS_PROCESSED=$((STAT_AGENTS_PROCESSED + 1))
}

# ─── Main: Phase 5 wrapper (multi-agent iteration) ───────────────────────────
main() {
  log "session-archive v2 starting"
  $CHECK_ONLY && log "Mode: CHECK (dry run)"
  $FORCE && log "Mode: FORCE"
  [[ "$PHASE_FILTER" != 0 ]] && log "Phase filter: $PHASE_FILTER only"

  # If SESSIONS_DIR is explicitly set, process only that directory
  if [[ -n "${SESSIONS_DIR:-}" ]]; then
    log "Using explicit SESSIONS_DIR: $SESSIONS_DIR"
    process_agent "$SESSIONS_DIR" "custom"
  elif [[ "$ALL_AGENTS" == "true" && -d "$AGENTS_DIR" ]]; then
    # Phase 5: iterate all agents
    for agent_path in "$AGENTS_DIR"/*/; do
      [[ ! -d "$agent_path" ]] && continue
      local agent_name
      agent_name=$(basename "$agent_path")
      local sessions_path="$agent_path/sessions"
      process_agent "$sessions_path" "$agent_name"
    done
  else
    # Fallback: main agent only
    process_agent "$AGENTS_DIR/main/sessions" "main"
  fi

  # ─── Summary ──────────────────────────────────────────────────────────────
  log ""
  log "═══ Summary ═══"
  log "  Agents processed:     $STAT_AGENTS_PROCESSED"
  log "  Junk files archived:  $STAT_JUNK_MOVED"
  log "  Junk files removed:   $STAT_JUNK_REMOVED"
  log "  Index fields stripped: $STAT_INDEX_FIELDS_STRIPPED"
  log "  Orphan entries pruned: $STAT_INDEX_ORPHANS_PRUNED"
  log "  Index bytes saved:    $STAT_INDEX_BYTES_SAVED"
  log "  Sessions archived:    $STAT_SESSIONS_ARCHIVED"
  log "  Sessions freed (KB):  $STAT_SESSIONS_FREED_KB"
  log "  Tarballs created:     $STAT_TARBALL_COUNT"

  # JSON output for cron/automation consumption
  cat <<EOF
{"version":2,"agents":$STAT_AGENTS_PROCESSED,"junkMoved":$STAT_JUNK_MOVED,"junkRemoved":$STAT_JUNK_REMOVED,"indexFieldsStripped":$STAT_INDEX_FIELDS_STRIPPED,"orphansPruned":$STAT_INDEX_ORPHANS_PRUNED,"indexBytesSaved":$STAT_INDEX_BYTES_SAVED,"sessionsArchived":$STAT_SESSIONS_ARCHIVED,"freedKB":$STAT_SESSIONS_FREED_KB,"tarballs":$STAT_TARBALL_COUNT}
EOF
}

main
