#!/bin/bash
# setup-agent-chat.sh — Install and manage the agent-chat XMTP daemon
#
# Sets up the agent-chat daemon as a user-level service:
# - macOS: launchd (~/Library/LaunchAgents/com.everclaw.agent-chat.plist)
# - Linux: systemd user service (~/.config/systemd/user/everclaw-agent-chat.service)
#
# No sudo required — everything runs as the current user.
#
# Usage:
#   bash scripts/setup-agent-chat.sh              # Auto-detect OS, install and start
#   bash scripts/setup-agent-chat.sh --macos      # Force macOS mode
#   bash scripts/setup-agent-chat.sh --linux      # Force Linux mode
#   bash scripts/setup-agent-chat.sh --status     # Check daemon status
#   bash scripts/setup-agent-chat.sh --restart    # Restart the daemon
#   bash scripts/setup-agent-chat.sh --logs       # Tail daemon logs
#   bash scripts/setup-agent-chat.sh --uninstall  # Remove the service
#
# Template variables (substituted at install time):
#   {{NODE_BIN}}       — Path to node binary (auto-detected, handles nvm/brew)
#   {{DAEMON_PATH}}    — Full path to daemon.mjs
#   {{EVERCLAW_PATH}}  — Path to EverClaw data directory (default: ~/.everclaw)
#
# Requirements:
#   - Node.js >= 20.0.0
#   - EverClaw installed with agent-chat skill
#   - XMTP identity generated (run: everclaw agent-chat setup-identity)

set -euo pipefail

# === Constants ===
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EVERCLAW_ROOT="$(dirname "$SCRIPT_DIR")"

# Detect agent-chat skill location:
# 1. Direct in workspace (unpacked: ~/.openclaw/workspace/skills/agent-chat)
# 2. Nested under everclaw skill (ClawHub: skills/everclaw/skills/agent-chat)
# 3. EVERCLAW_PATH override for custom locations
if [[ -n "${EVERCLAW_SKILL_PATH:-}" ]]; then
  SKILL_DIR="$EVERCLAW_SKILL_PATH"
elif [[ -f "$EVERCLAW_ROOT/skills/agent-chat/daemon.mjs" ]]; then
  SKILL_DIR="$EVERCLAW_ROOT/skills/agent-chat"
elif [[ -f "$EVERCLAW_ROOT/skills/everclaw/skills/agent-chat/daemon.mjs" ]]; then
  SKILL_DIR="$EVERCLAW_ROOT/skills/everclaw/skills/agent-chat"
else
  SKILL_DIR="$EVERCLAW_ROOT/skills/agent-chat"  # Default, will fail check
fi

SERVICE_NAME="com.everclaw.agent-chat"
DAEMON_SCRIPT="$SKILL_DIR/daemon.mjs"

# EVERCLAW_PATH should point to the base directory for logs/xmtp data
# Default to ~/.everclaw for data, regardless of skill location
EVERCLAW_DATA_PATH="${EVERCLAW_PATH:-$HOME/.everclaw}"
XMTP_DIR="$EVERCLAW_DATA_PATH/xmtp"
LOGS_DIR="$EVERCLAW_DATA_PATH/logs"
HEALTH_FILE="$XMTP_DIR/health.json"

# Template variables (will be substituted)
NODE_BIN=""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# === Helper Functions ===

log() { echo -e "${GREEN}[agent-chat]${NC} $1"; }
log_info() { echo -e "${BLUE}[agent-chat]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[agent-chat]${NC} $1"; }
log_err() { echo -e "${RED}[agent-chat]${NC} $1" >&2; }

detect_os() {
  case "$(uname)" in
    Darwin) echo "macos" ;;
    Linux)  echo "linux" ;;
    *)      echo "unknown" ;;
  esac
}

find_node() {
  # Priority: env override, nvm, brew, PATH
  if [[ -n "${NODE_PATH_OVERRIDE:-}" ]]; then
    echo "$NODE_PATH_OVERRIDE"
    return 0
  fi

  # Check nvm
  if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
    # shellcheck source=/dev/null
    source "$HOME/.nvm/nvm.sh" 2>/dev/null || true
    local nvm_node
    nvm_node=$(which node 2>/dev/null || echo "")
    if [[ -n "$nvm_node" ]]; then
      echo "$nvm_node"
      return 0
    fi
  fi

  # Check brew Node
  if [[ -x "/opt/homebrew/bin/node" ]]; then
    echo "/opt/homebrew/bin/node"
    return 0
  fi
  if [[ -x "/usr/local/bin/node" ]]; then
    echo "/usr/local/bin/node"
    return 0
  fi

  # Fallback to PATH
  local path_node
  path_node=$(command -v node 2>/dev/null || echo "")
  if [[ -n "$path_node" ]]; then
    echo "$path_node"
    return 0
  fi

  return 1
}

check_node_version() {
  if ! command -v node &>/dev/null; then
    log_err "Node.js not found. Please install Node.js >= 20.0.0"
    return 1
  fi

  local version
  version=$(node --version | sed 's/^v//')
  local major
  major=$(echo "$version" | cut -d. -f1)

  if [[ "$major" -lt 20 ]]; then
    log_err "Node.js version $version is too old. Requires >= 20.0.0"
    return 1
  fi

  log "Node.js version: $version ✓"
  return 0
}

check_daemon_exists() {
  if [[ ! -f "$DAEMON_SCRIPT" ]]; then
    log_err "Daemon script not found: $DAEMON_SCRIPT"
    log_err "Ensure EverClaw is installed with the agent-chat skill"
    return 1
  fi
  return 0
}

check_xmtp_identity() {
  if [[ ! -d "$XMTP_DIR" ]]; then
    log_warn "XMTP identity directory not found: $XMTP_DIR"
    log_warn "Run: everclaw agent-chat setup-identity"
    return 1
  fi

  # Check for identity files (key or db)
  local has_identity=0
  [[ -f "$XMTP_DIR/key" ]] && has_identity=1
  [[ -f "$XMTP_DIR/identity.json" ]] && has_identity=1
  [[ -f "$XMTP_DIR/.secrets.json" ]] && has_identity=1
  [[ -d "$XMTP_DIR/db" ]] && has_identity=1

  if [[ $has_identity -eq 0 ]]; then
    log_warn "No XMTP identity found in $XMTP_DIR"
    log_warn "Run: everclaw agent-chat setup-identity"
    return 1
  fi

  return 0
}

set_permissions() {
  # Secure the XMTP directory
  if [[ -d "$XMTP_DIR" ]]; then
    chmod 700 "$XMTP_DIR"
    # Secure any key files
    find "$XMTP_DIR" -name "*.key" -o -name "key" -o -name "*.pem" 2>/dev/null | while read -r keyfile; do
      chmod 600 "$keyfile" 2>/dev/null || true
    done
    log "Secured $XMTP_DIR (700) and key files (600)"
  fi

  # Create logs directory
  mkdir -p "$LOGS_DIR"
  chmod 750 "$LOGS_DIR"
}

# === macOS launchd Functions ===

install_launchd() {
  local plist_path="$HOME/Library/LaunchAgents/$SERVICE_NAME.plist"

  # Create logs directory
  mkdir -p "$LOGS_DIR"
  mkdir -p "$HOME/Library/LaunchAgents"

  # Substitute template
  # Note: daemon lives in SKILL_DIR, data lives in EVERCLAW_DATA_PATH
  log "Installing launchd service..."
  sed -e "s|{{NODE_BIN}}|$NODE_BIN|g" \
      -e "s|{{DAEMON_PATH}}|$DAEMON_SCRIPT|g" \
      -e "s|{{EVERCLAW_PATH}}|$EVERCLAW_DATA_PATH|g" \
      "$SKILL_DIR/templates/launchd/${SERVICE_NAME}.plist" > "$plist_path"

  log "Created $plist_path"

  # Unload existing service (legacy method for compatibility)
  launchctl unload "$plist_path" 2>/dev/null || true

  # Load service (modern method)
  local uid
  uid=$(id -u)
  if launchctl bootstrap "gui/$uid" "$plist_path" 2>/dev/null; then
    log "Service loaded via launchctl bootstrap"
  else
    # Fallback to legacy load
    launchctl load "$plist_path" 2>/dev/null || true
    log_warn "Used legacy launchctl load (bootstrap unavailable)"
  fi

  log "Daemon installed and started ✓"
  log "Logs: $LOGS_DIR/agent-chat.log"
  log "Status: launchctl list | grep everclaw"
}

uninstall_launchd() {
  local plist_path="$HOME/Library/LaunchAgents/$SERVICE_NAME.plist"
  local uid
  uid=$(id -u)

  log "Uninstalling launchd service..."

  # Stop and unload (try modern method first)
  launchctl bootout "gui/$uid/$SERVICE_NAME" 2>/dev/null || true

  # Fallback: legacy unload
  launchctl unload "$plist_path" 2>/dev/null || true

  # Remove plist
  if [[ -f "$plist_path" ]]; then
    rm "$plist_path"
    log "Removed $plist_path"
  fi

  log "Daemon uninstalled ✓"
}

status_launchd() {
  local plist_path="$HOME/Library/LaunchAgents/$SERVICE_NAME.plist"

  if [[ ! -f "$plist_path" ]]; then
    log_info "Not installed"
    return 1
  fi

  log_info "Installed: $plist_path"

  # Check if running
  if launchctl list "$SERVICE_NAME" &>/dev/null; then
    log "Status: ${GREEN}running${NC}"
    launchctl list "$SERVICE_NAME" 2>/dev/null || true

    # Check health file
    if [[ -f "$HEALTH_FILE" ]]; then
      log "Health: $(cat "$HEALTH_FILE" 2>/dev/null || echo "unknown")"
    fi
  else
    log "Status: ${YELLOW}stopped${NC}"
  fi
  return 0
}

restart_launchd() {
  local plist_path="$HOME/Library/LaunchAgents/$SERVICE_NAME.plist"
  local uid
  uid=$(id -u)

  log "Restarting daemon..."

  # Try modern method
  launchctl bootout "gui/$uid/$SERVICE_NAME" 2>/dev/null || true
  sleep 1

  if launchctl bootstrap "gui/$uid" "$plist_path" 2>/dev/null; then
    log "Restarted ✓"
  else
    # Fallback to legacy
    launchctl unload "$plist_path" 2>/dev/null || true
    launchctl load "$plist_path" 2>/dev/null || true
    log "Restarted (legacy mode) ✓"
  fi
}

logs_launchd() {
  local log_out="$LOGS_DIR/agent-chat.log"
  if [[ -f "$log_out" ]]; then
    tail -f "$log_out"
  else
    log_err "Log file not found: $log_out"
    return 1
  fi
}

# === Linux systemd Functions ===

install_systemd() {
  local service_dir="$HOME/.config/systemd/user"
  local service_path="$service_dir/everclaw-agent-chat.service"

  # Create service directory
  mkdir -p "$service_dir"

  # Substitute template
  # Note: daemon lives in SKILL_DIR, data lives in EVERCLAW_DATA_PATH
  log "Installing systemd user service..."
  sed -e "s|{{NODE_BIN}}|$NODE_BIN|g" \
      -e "s|{{DAEMON_PATH}}|$DAEMON_SCRIPT|g" \
      -e "s|{{EVERCLAW_PATH}}|$EVERCLAW_DATA_PATH|g" \
      "$SKILL_DIR/templates/systemd/everclaw-agent-chat.service" > "$service_path"

  log "Created $service_path"

  # Enable lingering (allows user services to run at boot)
  if command -v loginctl &>/dev/null; then
    loginctl enable-linger "$USER" 2>/dev/null || true
    log "Enabled user lingering for boot startup"
  fi

  # Reload systemd daemon
  systemctl --user daemon-reload

  # Enable and start
  systemctl --user enable everclaw-agent-chat.service
  systemctl --user start everclaw-agent-chat.service

  log "Daemon installed and started ✓"
  log "Logs: journalctl --user -u everclaw-agent-chat -f"
  log "Status: systemctl --user status everclaw-agent-chat"
}

uninstall_systemd() {
  local service_path="$HOME/.config/systemd/user/everclaw-agent-chat.service"

  log "Uninstalling systemd service..."

  # Stop and disable
  systemctl --user stop everclaw-agent-chat.service 2>/dev/null || true
  systemctl --user disable everclaw-agent-chat.service 2>/dev/null || true

  # Remove service file
  if [[ -f "$service_path" ]]; then
    rm "$service_path"
    systemctl --user daemon-reload
    log "Removed $service_path"
  fi

  log "Daemon uninstalled ✓"
}

status_systemd() {
  local service_path="$HOME/.config/systemd/user/everclaw-agent-chat.service"

  if [[ ! -f "$service_path" ]]; then
    log_info "Not installed"
    return 1
  fi

  log_info "Installed: $service_path"

  # Check status
  if systemctl --user is-active everclaw-agent-chat.service &>/dev/null; then
    log "Status: ${GREEN}running${NC}"
    systemctl --user status everclaw-agent-chat.service --no-pager || true

    # Check health file
    if [[ -f "$HEALTH_FILE" ]]; then
      log "Health: $(cat "$HEALTH_FILE" 2>/dev/null || echo "unknown")"
    fi
  else
    log "Status: ${YELLOW}stopped${NC}"
    systemctl --user status everclaw-agent-chat.service --no-pager 2>/dev/null || true
  fi
  return 0
}

restart_systemd() {
  log "Restarting daemon..."
  systemctl --user restart everclaw-agent-chat.service
  log "Restarted ✓"
}

logs_systemd() {
  journalctl --user -u everclaw-agent-chat -f
}

# === Main CLI ===

print_usage() {
  cat <<EOF
Usage: bash setup-agent-chat.sh [OPTIONS]

Options:
  --macos          Force macOS mode (launchd)
  --linux          Force Linux mode (systemd user service)
  --status         Check daemon status
  --restart        Restart the daemon
  --logs           Tail daemon logs
  --uninstall      Remove the daemon service
  --skip-deps      Skip dependency checks (for installer use)
  --dry-run        Show what would be done without making changes
  -h, --help       Show this help

Environment Variables:
  EVERCLAW_PATH      EverClaw installation path (default: ~/.everclaw)
  NODE_PATH_OVERRIDE Override path to node binary

Examples:
  bash scripts/setup-agent-chat.sh           # Install with auto-detection
  bash scripts/setup-agent-chat.sh --status  # Check if running
  bash scripts/setup-agent-chat.sh --logs    # Follow logs
EOF
}

main() {
  local os=""
  local action="install"
  local skip_deps=false
  local dry_run=false

  # Parse arguments
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --macos)   os="macos" ;;
      --linux)   os="linux" ;;
      --status)  action="status" ;;
      --restart) action="restart" ;;
      --logs)    action="logs" ;;
      --uninstall) action="uninstall" ;;
      --skip-deps) skip_deps=true ;;
      --dry-run) dry_run=true ;;
      -h|--help) print_usage; exit 0 ;;
      *) log_err "Unknown option: $1"; print_usage; exit 1 ;;
    esac
    shift
  done

  # Auto-detect OS if not specified
  if [[ -z "$os" ]]; then
    os=$(detect_os)
  fi

  if [[ "$os" == "unknown" ]]; then
    log_err "Unsupported OS: $(uname)"
    log_err "Supported: macOS, Linux"
    exit 1
  fi

  # Find Node.js
  if ! NODE_BIN=$(find_node); then
    log_err "Could not find Node.js. Please install Node.js >= 20.0.0"
    exit 1
  fi

  log "Node: $NODE_BIN"
  log "OS: $os"
  log "Skill: $SKILL_DIR"
  log "Data: $EVERCLAW_DATA_PATH"

  # Early exit for status/logs without checks
  if [[ "$action" == "status" ]]; then
    if [[ "$os" == "macos" ]]; then
      status_launchd
    else
      status_systemd
    fi
    exit $?
  fi

  if [[ "$action" == "logs" ]]; then
    if [[ "$os" == "macos" ]]; then
      logs_launchd
    else
      logs_systemd
    fi
    exit $?
  fi

  # Pre-flight checks for install/restart/uninstall
  if [[ "$action" == "install" ]]; then
    if [[ "$skip_deps" != true ]]; then
      check_node_version || exit 1
      check_daemon_exists || exit 1
      check_xmtp_identity || true  # Non-fatal warning
    fi

    set_permissions
  fi

  if [[ "$dry_run" == true ]]; then
    log_info "Dry run — would $action on $os"
    exit 0
  fi

  # Dispatch to OS-specific handler
  case "$action" in
    install)
      if [[ "$os" == "macos" ]]; then
        install_launchd
      else
        install_systemd
      fi
      ;;
    uninstall)
      if [[ "$os" == "macos" ]]; then
        uninstall_launchd
      else
        uninstall_systemd
      fi
      ;;
    restart)
      if [[ "$os" == "macos" ]]; then
        restart_launchd
      else
        restart_systemd
      fi
      ;;
  esac
}

main "$@"