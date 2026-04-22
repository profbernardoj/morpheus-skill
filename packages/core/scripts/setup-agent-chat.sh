#!/bin/bash
# setup-agent-chat.sh — Install and manage the XMTP agent-chat daemon
#
# Sets up the always-on XMTP daemon for agent-to-agent messaging.
# Supports macOS (launchd) and Linux (user-level systemd).
#
# Multi-identity: use --agent-id <id> to create per-agent daemon instances.
# Each agent gets its own XMTP identity, service file, and data directory.
#
# Usage:
#   bash setup-agent-chat.sh                          # Install default (host) daemon
#   bash setup-agent-chat.sh --agent-id alice         # Install alice's buddy bot daemon
#   bash setup-agent-chat.sh --status                # Check default daemon
#   bash setup-agent-chat.sh --status --agent-id alice  # Check alice's daemon
#   bash setup-agent-chat.sh --uninstall              # Remove default daemon
#   bash setup-agent-chat.sh --uninstall --agent-id alice  # Remove alice's daemon
#   bash setup-agent-chat.sh --restart               # Restart default daemon
#   bash setup-agent-chat.sh --logs                  # Show recent logs
#   bash setup-agent-chat.sh --skip-start            # Install but don't start
#   bash setup-agent-chat.sh --list                  # List all agent-chat daemons
#   bash setup-agent-chat.sh --help                  # Show help
#
# Template variables (substituted at install time):
#   {{NODE_BIN}}      — Path to node binary (resolves nvm/brew/system)
#   {{EVERCLAW_PATH}} — Path to EverClaw skill directory
#   {{AGENT_ID}}     — Agent identifier (empty string for default host agent)
#
# Requirements:
#   - Node.js >= 20.0.0
#   - XMTP identity already generated (run setup-identity.mjs first)
#
# Security:
#   - XMTP data dirs: chmod 700
#   - .secrets.json: chmod 600
#   - Runs as current user (no sudo required)

set -euo pipefail

# ─── Configuration ───────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"
AGENT_CHAT_DIR="$SKILL_DIR/skills/agent-chat"
EVERCLAW_HOME="${EVERCLAW_HOME:-$HOME/.everclaw}"
LOG_DIR="$EVERCLAW_HOME/logs"
NODE_BIN="${NODE_BIN:-$(command -v node 2>/dev/null || echo "")}"

# ─── Agent ID Parsing ────────────────────────────────────────────────────────

AGENT_ID=""
COMMAND="install"

# Validate agent ID: lowercase alphanumeric + hyphens, start with alphanumeric, max 63 chars
# Prevents directory traversal, service injection, and filesystem issues
validate_agent_id() {
  if [[ -z "$1" ]]; then
    return 0  # empty = default host, valid
  fi
  if [[ ! "$1" =~ ^[a-z0-9][a-z0-9-]{0,62}$ ]]; then
    err "Invalid agent ID: '$1'. Must be 1-63 chars, lowercase alphanumeric + hyphens, start with alphanumeric."
    exit 1
  fi
  # Additional path traversal check
  if [[ "$1" == *".."* ]] || [[ "$1" == *"/"* ]]; then
    err "Invalid agent ID: '$1' contains path traversal characters."
    exit 1
  fi
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --agent-id)
        shift
        AGENT_ID="${1:?--agent-id requires a value}"
        validate_agent_id "$AGENT_ID"
        ;;
      --status)
        COMMAND="status"
        ;;
      --uninstall)
        COMMAND="uninstall"
        ;;
      --restart)
        COMMAND="restart"
        ;;
      --logs)
        COMMAND="logs"
        ;;
      --skip-start)
        COMMAND="skip-start"
        ;;
      --list)
        COMMAND="list"
        ;;
      --help|-h)
        COMMAND="help"
        ;;
      install|"")
        COMMAND="install"
        ;;
      *)
        err "Unknown argument: $1"
        COMMAND="help"
        ;;
    esac
    shift
  done
}

# Derived paths based on agent ID
derive_paths() {
  if [[ -n "$AGENT_ID" ]]; then
    XMTP_DIR="$EVERCLAW_HOME/xmtp-${AGENT_ID}"
    SERVICE_NAME="com.everclaw.agent-chat.${AGENT_ID}"
    SERVICE_NAME_SYSTEMD="everclaw-agent-chat-${AGENT_ID}"
    LOG_FILE="$LOG_DIR/agent-chat-${AGENT_ID}.log"
    ERR_FILE="$LOG_DIR/agent-chat-${AGENT_ID}.err"
    AGENT_LABEL="agent '${AGENT_ID}'"
  else
    XMTP_DIR="$EVERCLAW_HOME/xmtp"
    SERVICE_NAME="com.everclaw.agent-chat"
    SERVICE_NAME_SYSTEMD="everclaw-agent-chat"
    LOG_FILE="$LOG_DIR/agent-chat.log"
    ERR_FILE="$LOG_DIR/agent-chat.err"
    AGENT_LABEL="default (host)"
  fi
}

# Colors (disabled if not a terminal)
if [[ -t 1 ]]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[0;33m'
  BLUE='\033[0;34m'
  NC='\033[0m' # No Color
else
  RED=''
  GREEN=''
  YELLOW=''
  BLUE=''
  NC=''
fi

# ─── Helpers ─────────────────────────────────────────────────────────────────

log() { echo -e "${GREEN}[agent-chat]${NC} $1"; }
warn() { echo -e "${YELLOW}[agent-chat]${NC} ⚠️  $1"; }
err() { echo -e "${RED}[agent-chat]${NC} ❌ $1"; }
info() { echo -e "${BLUE}[agent-chat]${NC} $1"; }

die() {
  err "$1"
  exit "${2:-1}"
}

# Find node binary, handling nvm/brew/system paths
find_node() {
  # Check nvm first (most common for Node 20+)
  if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
    # shellcheck source=/dev/null
    source "$HOME/.nvm/nvm.sh" 2>/dev/null || true
    local nvm_node
    nvm_node="$(nvm which current 2>/dev/null || echo "")"
    if [[ -x "$nvm_node" ]]; then
      echo "$nvm_node"
      return 0
    fi
  fi

  # Check Homebrew
  local brew_node
  brew_node="$(command -v brew 2>/dev/null && brew --prefix node 2>/dev/null)/bin/node"
  if [[ -x "$brew_node" ]]; then
    echo "$brew_node"
    return 0
  fi

  # Fallback to PATH
  local path_node
  path_node="$(command -v node 2>/dev/null || echo "")"
  if [[ -x "$path_node" ]]; then
    echo "$path_node"
    return 0
  fi

  return 1
}

# Check Node version >= 20
check_node_version() {
  local node_path="${1:-$NODE_BIN}"
  if [[ ! -x "$node_path" ]]; then
    return 1
  fi
  
  local version
  version="$("$node_path" --version 2>/dev/null | sed 's/^v//')"
  local major
  major="$(echo "$version" | cut -d. -f1)"
  
  if [[ "$major" -lt 20 ]]; then
    return 1
  fi
  
  return 0
}

# Ensure XMTP identity exists for this agent
check_identity() {
  if [[ ! -f "$XMTP_DIR/.secrets.json" ]]; then
    return 1
  fi
  if [[ ! -f "$XMTP_DIR/identity.json" ]]; then
    return 1
  fi
  return 0
}

# Set secure permissions on XMTP directory
secure_permissions() {
  mkdir -p "$XMTP_DIR"
  chmod 700 "$XMTP_DIR"
  
  if [[ -f "$XMTP_DIR/.secrets.json" ]]; then
    chmod 600 "$XMTP_DIR/.secrets.json"
  fi
  
  # Also secure the log directory
  mkdir -p "$LOG_DIR"
  chmod 700 "$LOG_DIR"
}

# ─── List all daemons ────────────────────────────────────────────────────

list_daemons() {
  log "Installed agent-chat daemons:"
  echo ""
  
  # On macOS, check LaunchAgents
  if [[ "$(uname)" == "Darwin" ]]; then
    local found=0
    for plist in "$HOME/Library/LaunchAgents"/com.everclaw.agent-chat*.plist; do
      if [[ -f "$plist" ]]; then
        local name
        name="$(basename "$plist" .plist)"
        # Extract agent ID from service name (com.everclaw.agent-chat.alice → alice)
        local agent_id
        if [[ "$name" == "com.everclaw.agent-chat" ]]; then
          agent_id="(default host)"
        else
          agent_id="${name#com.everclaw.agent-chat.}"
        fi
        
        local status="stopped"
        if launchctl list "$name" &>/dev/null; then
          status="running"
        fi
        
        # Find the XMTP directory for this daemon
        local xmtp_dir
        if [[ "$agent_id" == "(default host)" ]]; then
          xmtp_dir="$EVERCLAW_HOME/xmtp"
        else
          xmtp_dir="$EVERCLAW_HOME/xmtp-${agent_id}"
        fi
        
        local address="unknown"
        if [[ -f "$xmtp_dir/identity.json" ]]; then
          address="$(jq -r '.address // "unknown"' "$xmtp_dir/identity.json" 2>/dev/null || echo "unknown")"
        fi
        
        printf "  %-8s %-25s %s\n" "$status" "$agent_id" "$address"
        found=$((found + 1))
      fi
    done
    
    if [[ $found -eq 0 ]]; then
      echo "  (no daemons installed)"
    fi
  else
    # Linux — check systemd user units
    local found=0
    for service in "$HOME/.config/systemd/user"/everclaw-agent-chat*.service; do
      if [[ -f "$service" ]]; then
        local name
        name="$(basename "$service" .service)"
        local agent_id
        if [[ "$name" == "everclaw-agent-chat" ]]; then
          agent_id="(default host)"
        else
          agent_id="${name#everclaw-agent-chat-}"
        fi
        
        local is_active
        is_active="$(systemctl --user is-active "$name" 2>/dev/null || echo "inactive")"
        
        local xmtp_dir
        if [[ "$agent_id" == "(default host)" ]]; then
          xmtp_dir="$EVERCLAW_HOME/xmtp"
        else
          xmtp_dir="$EVERCLAW_HOME/xmtp-${agent_id}"
        fi
        
        local address="unknown"
        if [[ -f "$xmtp_dir/identity.json" ]]; then
          address="$(jq -r '.address // "unknown"' "$xmtp_dir/identity.json" 2>/dev/null || echo "unknown")"
        fi
        
        printf "  %-8s %-25s %s\n" "$is_active" "$agent_id" "$address"
        found=$((found + 1))
      fi
    done
    
    if [[ $found -eq 0 ]]; then
      echo "  (no daemons installed)"
    fi
  fi
}

# ─── macOS launchd ───────────────────────────────────────────────────────────

install_launchd() {
  log "Installing launchd service for ${AGENT_LABEL}..."
  
  local plist_dir="$HOME/Library/LaunchAgents"
  local plist_path="$plist_dir/${SERVICE_NAME}.plist"
  
  mkdir -p "$plist_dir"
  mkdir -p "$LOG_DIR"
  
  # Unload existing if present (modern API)
  if [[ -f "$plist_path" ]]; then
    launchctl bootout "gui/$(id -u)/${SERVICE_NAME}" 2>/dev/null || true
  fi
  
  # Resolve node path
  local node_path
  node_path="$(find_node)" || die "Node.js not found. Please install Node.js >= 20.0.0"
  
  if ! check_node_version "$node_path"; then
    die "Node.js version too old. Need >= 20.0.0, found: $($node_path --version)"
  fi
  
  log "Using Node.js at: $node_path"
  
  # Build plist with EnvironmentVariables for multi-identity
  # The daemon reads AGENT_CHAT_AGENT_ID from env to determine its identity
  local agent_id_env=""
  if [[ -n "$AGENT_ID" ]]; then
    agent_id_env="
    <key>EnvironmentVariables</key>
    <dict>
        <key>NODE_ENV</key>
        <string>production</string>
        <key>AGENT_CHAT_AGENT_ID</key>
        <string>${AGENT_ID}</string>
    </dict>"
  else
    agent_id_env="
    <key>EnvironmentVariables</key>
    <dict>
        <key>NODE_ENV</key>
        <string>production</string>
    </dict>"
  fi
  
  # Write plist file
  # We generate it inline to support dynamic agent IDs without maintaining separate template files
  cat > "$plist_path" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${SERVICE_NAME}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${node_path}</string>
        <string>${AGENT_CHAT_DIR}/daemon.mjs</string>
$(if [[ -n "$AGENT_ID" ]]; then
    echo "        <string>--agent-id</string>"
    echo "        <string>${AGENT_ID}</string>"
fi)
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>10</integer>
    <key>StandardOutPath</key>
    <string>${LOG_FILE}</string>
    <key>StandardErrorPath</key>
    <string>${ERR_FILE}</string>
    <key>WorkingDirectory</key>
    <string>${AGENT_CHAT_DIR}</string>${agent_id_env}
</dict>
</plist>
PLIST

  log "Created $plist_path"
  
  # Secure permissions
  secure_permissions
  
  # Load service (modern API)
  launchctl bootstrap "gui/$(id -u)" "$plist_path" 2>/dev/null || {
    warn "Failed to bootstrap launchd service"
    return 1
  }
  
  log "Service loaded: $SERVICE_NAME"
  return 0
}

uninstall_launchd() {
  log "Uninstalling launchd service for ${AGENT_LABEL}..."
  
  local plist_dir="$HOME/Library/LaunchAgents"
  local plist_path="$plist_dir/${SERVICE_NAME}.plist"
  
  # Unload (modern API)
  launchctl bootout "gui/$(id -u)/${SERVICE_NAME}" 2>/dev/null || true
  
  # Remove plist
  if [[ -f "$plist_path" ]]; then
    rm -f "$plist_path"
    log "Removed $plist_path"
  fi
  
  log "Service uninstalled"
}

status_launchd() {
  local plist_dir="$HOME/Library/LaunchAgents"
  local plist_path="$plist_dir/${SERVICE_NAME}.plist"
  
  if [[ ! -f "$plist_path" ]]; then
    echo "Status: not installed (${AGENT_LABEL})"
    return 1
  fi
  
  # Check if running
  if launchctl list "${SERVICE_NAME}" &>/dev/null; then
    local pid
    pid="$(launchctl list "${SERVICE_NAME}" 2>/dev/null | awk '/PID/ {print $2}')"
    echo "Status: running (PID: $pid) — ${AGENT_LABEL}"
    
    # Show recent health
    if [[ -f "$XMTP_DIR/health.json" ]]; then
      local health_status
      health_status="$(jq -r '.status // "unknown"' "$XMTP_DIR/health.json" 2>/dev/null || echo "unknown")"
      local messages
      messages="$(jq -r '.messagesProcessed // 0' "$XMTP_DIR/health.json" 2>/dev/null || echo "0")"
      echo "Health: $health_status"
      echo "Messages processed: $messages"
    fi
    return 0
  else
    echo "Status: stopped — ${AGENT_LABEL}"
    return 1
  fi
}

restart_launchd() {
  local plist_dir="$HOME/Library/LaunchAgents"
  local plist_path="$plist_dir/${SERVICE_NAME}.plist"
  
  if [[ ! -f "$plist_path" ]]; then
    err "Service not installed for ${AGENT_LABEL}. Run without arguments to install."
    return 1
  fi
  
  log "Restarting ${AGENT_LABEL}..."
  launchctl bootout "gui/$(id -u)/${SERVICE_NAME}" 2>/dev/null || true
  sleep 1
  launchctl bootstrap "gui/$(id -u)" "$plist_path" 2>/dev/null || {
    err "Failed to restart service"
    return 1
  }
  log "Service restarted for ${AGENT_LABEL}"
  return 0
}

# ─── Linux systemd (user-level) ──────────────────────────────────────────────

install_systemd() {
  log "Installing systemd user service for ${AGENT_LABEL}..."
  
  local systemd_dir="$HOME/.config/systemd/user"
  local service_path="$systemd_dir/${SERVICE_NAME_SYSTEMD}.service"
  
  mkdir -p "$systemd_dir"
  mkdir -p "$LOG_DIR"
  
  # Stop existing if running
  systemctl --user stop "${SERVICE_NAME_SYSTEMD}" 2>/dev/null || true
  
  # Resolve node path
  local node_path
  node_path="$(find_node)" || die "Node.js not found. Please install Node.js >= 20.0.0"
  
  if ! check_node_version "$node_path"; then
    die "Node.js version too old. Need >= 20.0.0, found: $($node_path --version)"
  fi
  
  log "Using Node.js at: $node_path"
  
  # Build agent-id argument for ExecStart
  local daemon_args="${AGENT_CHAT_DIR}/daemon.mjs"
  local env_agent_id=""
  if [[ -n "$AGENT_ID" ]]; then
    daemon_args="${daemon_args} --agent-id ${AGENT_ID}"
    env_agent_id="Environment=AGENT_CHAT_AGENT_ID=${AGENT_ID}"
  fi
  
  # Write service file inline for dynamic agent ID support
  cat > "$service_path" << SERVICE
[Unit]
Description=XMTP Agent-Chat Daemon${AGENT_ID:+ (}${AGENT_ID:+${AGENT_ID}}${AGENT_ID:+)}
After=network.target

[Service]
Type=simple
ExecStart=${node_path} ${daemon_args}
WorkingDirectory=${AGENT_CHAT_DIR}
Restart=on-failure
RestartSec=10
StandardOutput=append:${LOG_FILE}
StandardError=append:${ERR_FILE}
${env_agent_id}

[Install]
WantedBy=default.target
SERVICE

  log "Created $service_path"
  
  # Secure permissions
  secure_permissions
  
  # Ensure lingering is enabled (allows services to run after logout)
  if command -v loginctl &>/dev/null; then
    loginctl enable-linger "$USER" 2>/dev/null || {
      warn "Could not enable lingering. Service may stop after logout."
      info "Run: loginctl enable-linger $USER"
    }
  fi
  
  # Reload systemd
  systemctl --user daemon-reload
  
  # Enable and start
  systemctl --user enable "${SERVICE_NAME_SYSTEMD}" 2>/dev/null
  systemctl --user start "${SERVICE_NAME_SYSTEMD}" 2>/dev/null || {
    warn "Failed to start service"
    return 1
  }
  
  log "Service enabled and started: ${SERVICE_NAME_SYSTEMD}"
  return 0
}

uninstall_systemd() {
  log "Uninstalling systemd user service for ${AGENT_LABEL}..."
  
  # Stop and disable
  systemctl --user stop "${SERVICE_NAME_SYSTEMD}" 2>/dev/null || true
  systemctl --user disable "${SERVICE_NAME_SYSTEMD}" 2>/dev/null || true
  
  # Remove service file
  local systemd_dir="$HOME/.config/systemd/user"
  local service_path="$systemd_dir/${SERVICE_NAME_SYSTEMD}.service"
  
  if [[ -f "$service_path" ]]; then
    rm -f "$service_path"
    systemctl --user daemon-reload
    log "Removed $service_path"
  fi
  
  log "Service uninstalled"
}

status_systemd() {
  local systemd_dir="$HOME/.config/systemd/user"
  local service_path="$systemd_dir/${SERVICE_NAME_SYSTEMD}.service"
  
  if [[ ! -f "$service_path" ]]; then
    echo "Status: not installed (${AGENT_LABEL})"
    return 1
  fi
  
  # Check if running
  local is_active
  is_active="$(systemctl --user is-active "${SERVICE_NAME_SYSTEMD}" 2>/dev/null || echo "inactive")"
  
  if [[ "$is_active" == "active" ]]; then
    echo "Status: running — ${AGENT_LABEL}"
    
    # Show recent health
    if [[ -f "$XMTP_DIR/health.json" ]]; then
      local health_status
      health_status="$(jq -r '.status // "unknown"' "$XMTP_DIR/health.json" 2>/dev/null || echo "unknown")"
      local messages
      messages="$(jq -r '.messagesProcessed // 0' "$XMTP_DIR/health.json" 2>/dev/null || echo "0")"
      echo "Health: $health_status"
      echo "Messages processed: $messages"
    fi
    return 0
  else
    echo "Status: $is_active — ${AGENT_LABEL}"
    return 1
  fi
}

restart_systemd() {
  local systemd_dir="$HOME/.config/systemd/user"
  local service_path="$systemd_dir/${SERVICE_NAME_SYSTEMD}.service"
  
  if [[ ! -f "$service_path" ]]; then
    err "Service not installed for ${AGENT_LABEL}. Run without arguments to install."
    return 1
  fi
  
  log "Restarting ${AGENT_LABEL}..."
  systemctl --user restart "${SERVICE_NAME_SYSTEMD}" 2>/dev/null || {
    err "Failed to restart service"
    return 1
  }
  log "Service restarted for ${AGENT_LABEL}"
  return 0
}

# ─── Logs ───────────────────────────────────────────────────────────────────

show_logs() {
  # Check for log files (macOS launchd) or use journalctl (Linux systemd)
  if [[ "$(uname)" == "Darwin" ]]; then
    if [[ -f "$LOG_FILE" ]]; then
      log "Recent logs from $LOG_FILE:"
      tail -n 50 "$LOG_FILE"
    else
      warn "No log file found at $LOG_FILE"
      info "Check: /tmp/${SERVICE_NAME}.log (launchd default)"
    fi
  else
    # Linux - use journalctl
    if command -v journalctl &>/dev/null; then
      log "Recent journal logs:"
      journalctl --user -u "${SERVICE_NAME_SYSTEMD}" -n 50 --no-pager
    else
      warn "journalctl not available"
    fi
  fi
}

# ─── Health Check ────────────────────────────────────────────────────────────

verify_daemon() {
  log "Verifying daemon health for ${AGENT_LABEL}..."
  
  sleep 3  # Give daemon time to start
  
  # Check health file
  if [[ -f "$XMTP_DIR/health.json" ]]; then
    local health_status
    health_status="$(jq -r '.status // "unknown"' "$XMTP_DIR/health.json" 2>/dev/null || echo "unknown")"
    
    if [[ "$health_status" == "running" ]]; then
      local address
      address="$(jq -r '.address // "unknown"' "$XMTP_DIR/health.json" 2>/dev/null || echo "unknown")"
      log "✓ Daemon is healthy (${AGENT_LABEL})"
      log "  Address: $address"
      return 0
    else
      warn "Daemon status: $health_status (${AGENT_LABEL})"
      info "Check logs: bash $0 --logs"
      return 1
    fi
  else
    warn "Health file not found at $XMTP_DIR/health.json"
    info "Wait a few seconds and run: bash $0 --status"
    return 1
  fi
}

# ─── Main ───────────────────────────────────────────────────────────────────

show_usage() {
  cat << 'EOF'
Usage: bash setup-agent-chat.sh [COMMAND] [--agent-id <id>]

Commands:
  (none)      Install and start the XMTP agent-chat daemon
  --status    Check daemon status
  --uninstall Remove the daemon service
  --restart   Restart the daemon
  --logs      Show recent daemon logs
  --skip-start Install service but don't start it
  --list      List all installed agent-chat daemons
  --help      Show this help message

Multi-identity:
  --agent-id <id>  Operate on a specific agent (e.g. 'alice', 'bob')
                   Creates separate service, identity, and data dirs
                   Default data: ~/.everclaw/xmtp/
                   Agent data:   ~/.everclaw/xmtp-<id>/

Environment variables:
  NODE_BIN              Path to Node.js binary (auto-detected if not set)
  EVERCLAW_HOME          Path to ~/.everclaw (default: ~/.everclaw)
  AGENT_CHAT_AGENT_ID    Agent ID (alternative to --agent-id flag)

Requirements:
  - Node.js >= 20.0.0
  - XMTP identity (run: node skills/agent-chat/setup-identity.mjs [--agent-id <id>])

Supported platforms:
  - macOS (launchd)
  - Linux (systemd user service, no sudo required)

Examples:
  # Install default host daemon
  bash setup-agent-chat.sh

  # Install a buddy bot daemon for Alice
  bash setup-agent-chat.sh --agent-id alice

  # Check status of Alice's daemon
  bash setup-agent-chat.sh --status --agent-id alice

  # List all installed daemons
  bash setup-agent-chat.sh --list

Log files:
  - macOS: ~/Library/Logs/everclaw-agent-chat.log (default)
  - macOS: ~/Library/Logs/everclaw-agent-chat-<id>.log (per-agent)
  - Linux: journalctl --user -u everclaw-agent-chat (default)
  - Linux: journalctl --user -u everclaw-agent-chat-<id> (per-agent)

EOF
}

main() {
  parse_args "$@"
  derive_paths
  
  case "$COMMAND" in
    help)
      show_usage
      exit 0
      ;;
    list)
      list_daemons
      ;;
    status)
      if [[ "$(uname)" == "Darwin" ]]; then
        status_launchd
      else
        status_systemd
      fi
      ;;
    uninstall)
      if [[ "$(uname)" == "Darwin" ]]; then
        uninstall_launchd
      else
        uninstall_systemd
      fi
      ;;
    restart)
      if [[ "$(uname)" == "Darwin" ]]; then
        restart_launchd
      else
        restart_systemd
      fi
      ;;
    logs)
      show_logs
      ;;
    skip-start)
      do_install --skip-start
      ;;
    install)
      do_install
      ;;
    *)
      err "Unknown command: $COMMAND"
      show_usage
      exit 1
      ;;
  esac
}

do_install() {
  local skip_start="${1:-}"
  
  # Check prerequisites
  if [[ -z "$NODE_BIN" ]]; then
    NODE_BIN="$(find_node)" || die "Node.js not found. Please install Node.js >= 20.0.0"
  fi
  
  if ! check_node_version "$NODE_BIN"; then
    die "Node.js version too old. Need >= 20.0.0, found: $($NODE_BIN --version)"
  fi
  
  if ! check_identity; then
    warn "XMTP identity not found at $XMTP_DIR"
    if [[ -n "$AGENT_ID" ]]; then
      info "Generate one first: node $AGENT_CHAT_DIR/setup-identity.mjs --agent-id $AGENT_ID"
    else
      info "Generate one first: node $AGENT_CHAT_DIR/setup-identity.mjs"
    fi
    die "Run setup-identity.mjs before installing the daemon"
  fi
  
  log "Node.js: $($NODE_BIN --version)"
  log "Agent:   $AGENT_LABEL"
  log "EverClaw: $SKILL_DIR"
  log "XMTP dir: $XMTP_DIR"
  echo ""
  
  # Install based on OS
  if [[ "$(uname)" == "Darwin" ]]; then
    install_launchd
  elif [[ "$(uname)" == "Linux" ]] && command -v systemctl &>/dev/null; then
    install_systemd
  else
    die "Unsupported platform. Only macOS (launchd) and Linux (systemd) are supported."
  fi
  
  # Verify unless --skip-start
  if [[ -z "$skip_start" ]]; then
    verify_daemon
  else
    log "Service installed but not started (--skip-start)"
    log "To start: bash $0 --restart$( [[ -n "$AGENT_ID" ]] && echo " --agent-id $AGENT_ID" )"
  fi
  
  echo ""
  log "═════════════════════════════════════════"
  log "  XMTP agent-chat daemon installed!"
  log "  Agent: ${AGENT_LABEL}"
  log "═════════════════════════════════════════"
  echo ""
  info "Check status: bash $0 --status$( [[ -n "$AGENT_ID" ]] && echo " --agent-id $AGENT_ID" )"
  info "View logs:    bash $0 --logs$( [[ -n "$AGENT_ID" ]] && echo " --agent-id $AGENT_ID" )"
  info "Send message: node $AGENT_CHAT_DIR/cli.mjs send <address> <message>"
}

main "$@"