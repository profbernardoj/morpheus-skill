# Session: 2026-03-12 16:10:48 UTC

- **Session Key**: agent:main:main
- **Session ID**: 3d591e63-7cad-4bd1-a6ff-3d39f1f42308
- **Source**: webchat

## Conversation Summary

assistant: Here's the X thread covering everything since v2026.3.6:

---

**Post 1 (Lead)**

🧵 EverClaw update thread — 9 releases in 7 days (v2026.3.6 → v2026.3.15)

We've been shipping fast. Here's what changed in the open-source decentralized inference skill since the guided installer dropped.

Own your inference. ♾️

**Post 2 — Local Fallback (v2026.3.15)**

🏠 NEW: Hardware-aware local Ollama fallback

One command detects your hardware and installs the right model:

`bash scripts/setup-ollama.sh --apply`

• Auto-detects RAM, GPU (Metal/CUDA/ROCm)
• Picks optimal Qwen3.5 model (0.8B–35B)
• Configures as last fallback — your agent never goes offline
• Works on Mac, Linux, Raspberry Pi to workstation

**Post 3 — Bug Sweep (v2026.3.13–3.14)**

🐛 Full audit + 9 bug fixes

• balance.sh, bootstrap, session CLI, PII scanner, boot templates
• Version alignment across SKILL.md / package.json / git tags
• Removed stale duplicate directories
• install.sh hardened with better error handling
• SmartAgent gateway-guardian synced to v5

38 syntax checks, 36 tests, 0 PII. Clean.

**Post 4 — P2P Session Manager (v2026.3.12)**

🔗 Morpheus P2P session management CLI

7 new commands: status, balance, models, sessions, estimate, fund, logs

• EIP-712 Safe→Router MOR transfers via 1Password
• Daily MOR+ETH balance tracker with live prices
• P2P→Gateway automatic fallback
• All personal wallet addresses scrubbed — env vars only

**Post 5 — Wallet Safety (v2026.3.11)**

🔒 Wallet safety suite

• Receipt verification via waitAndVerify()
• Uniswap QuoterV2 slippage protection
• Configurable gas limits + confirmation tracking
• 36 automated tests (offline, balance, swap, slippage)

MOR is staked, not spent. All staked MOR returns after session close.

**Post 6 — Security Stack (v2026.3.8–3.9)**

🛡️ Security upgrades

PromptGuard → v3.3.0
• External content injection detection (GitHub issues, PRs, emails, Slack)
• Multi-language urgency patterns (EN/KO/JA/ZH)
• ~130 new patterns for external content attacks

Bagman → v2.0 Multi-Backend
• macOS Keychain (native, zero setup)
• Encrypted file backend via age
• Env vars backend for CI/CD
• Auto-detect best available — 1Password no longer required

**Post 7 — Proxy Router (v2026.3.10)**

⚡ Morpheus Proxy Router updated to v5.14.0

• Fixed approve overflow during session creation
• Fixed NaN provider scores blocking sessions
• Fixed BadgerDB boot corruption
• End-to-end request_id tracing for debugging

**Post 8 (Closing)**

📊 By the numbers since v2026.3.6:

• 9 releases in 7 days
• 36 automated tests
• 31 repos synced per release
• 0 PII leaks (PII Guard v2 on every commit)
• Zero cloud dependency fallback — fully offline capable

All open source. All Morpheus-first.

github.com/profbernardoj/everclaw
user: Conversation info (untrusted metadata):
```json
{
  "message_id": "1773329465716",
  "sender_id": "+14432859111",
  "sender": "David Johnston",
  "timestamp": "Thu 2026-03-12 10:31 CDT"
}
```

Sender (untrusted metadata):
```json
{
  "label": "David Johnston (+14432859111)",
  "id": "+14432859111",
  "name": "David Johnston"
}
```

Thanks I just realized we need to include Ollama in the one command install guide for EverClaw and our weekly dependencies list that we check for updates. Go ahead and plan that work out using your SOP–001 for coding development and deployment.
assistant: Now let me check what the existing dependency checking cron looks like:
assistant: Good — I found everything I need. Here's the plan:

---

## SOP-001 Stage 1: Planning & Design

### Problem Statement

Two gaps after shipping the Ollama fallback (v2026.3.15):

1. **One-command installer (`install-with-deps.sh`)** doesn't mention Ollama. A new user running `curl -fsSL https://get.everclaw.xyz | bash` gets no option to set up local fallback.

2. **Weekly dependency check** (cron `EverClaw Skills & Deps Update Check`, Mondays 7 AM) tracks prompt-guard, bagman, Morpheus Proxy-Router, and npm packages — but not Ollama. We won't know when new Qwen3.5 models drop or Ollama has a new version.

### Task A: Add Ollama to install-with-deps.sh

**Changes to `scripts/install-with-deps.sh`:**

1. Add Ollama to the dependency check list (as optional — not required for basic operation)
2. After the Morpheus Proxy-Router optional step, add a new optional step:
   - "Set up local Ollama fallback? [y/N]"
   - If yes, call `bash scripts/setup-ollama.sh --apply`
   - If `--auto-install` flag is set, include Ollama automatically
3. Add `--with-ollama` flag for explicit opt-in
4. Add `--skip-ollama` flag to explicitly skip

**Why optional, not required:** Ollama is a 500MB+ install plus a multi-GB model pull. Users on minimal hardware or VMs may not want it. The installer should offer it, not force it.

### Task B: Add Ollama to weekly dependency check cron

**Update cron job `25a462c4` ("EverClaw Skills & Deps Update Check"):**

Add a new section to the cron payload:

```
## Part 3: Ollama Version & Model Check

1. Check installed Ollama version: ollama --version
2. Check latest Ollama version: curl -s https://api.github.com/repos/ollama/ollama/releases/latest | jq -r .tag_name
3. Check installed Qwen3.5 model: ollama list | grep qwen3.5
4. Check if newer Qwen3.5 variants are available on the registry
5. Report: Current vs latest, recommend update if behind
```

### Files to Change

| File | Change |
|------|--------|
| `scripts/install-with-deps.sh` | Add Ollama optional step + flags |
| `SKILL.md` | Update Prerequisites table to include Ollama (optional) |
| Cron job `25a462c4` | Add Ollama version/model check to payload |

### Risk Assessment

- **Low risk** — both changes are additive
- Installer change is optional (won't break existing `curl | bash` flows)
- Cron update only adds a check section, doesn't change existing checks

---

Ready to proceed to Stage 2 (Coding)?
user: Conversation info (untrusted metadata):
```json
{
  "message_id": "1773329893439",
  "sender_id": "+14432859111",
  "sender": "David Johnston",
  "timestamp": "Thu 2026-03-12 10:38 CDT"
}
```

Sender (untrusted metadata):
```json
{
  "label": "David Johnston (+14432859111)",
  "id": "+14432859111",
  "name": "David Johnston"
}
```

Rather than make a Ollama optional let’s think through how to intelligently install it for the user automatically. Given you’re already doing a bunch of detection around the users hardware availability. So if they don’t have enough hard drive space or ram then don’t install a Ollama. However if they do have the hardware required, I think it’s important to include Ollama by default given it adds such a critical fall back model if the bootstrap key is low on funds or the other API keys aren’t set up yet. It will make the whole on boarding process for most people dramatically easier.
assistant: Good call. That changes the architecture meaningfully — Ollama becomes part of the default install path, not an opt-out addon. The agent works out of the box even if the bootstrap key is depleted or the user never configures a paid API.

Let me revise the plan:

---

## SOP-001 Stage 1: Planning (Revised)

### Design Philosophy

**Every EverClaw install should result in a working agent.** The bootstrap key gives immediate cloud inference, and Ollama ensures inference survives when that key runs dry. Together they make onboarding zero-friction: install, restart, go.

### Smart Auto-Install Logic

The installer already detects OS and arch. We add hardware checks that gate Ollama:

**Install Ollama automatically if:**
- Disk: ≥5 GB free (0.5GB Ollama + ~1GB minimum model + headroom)
- RAM: ≥2 GB total (enough for at least qwen3.5:0.8b)

**Skip Ollama silently if:**
- Disk < 5 GB free — can't fit Ollama + any model
- RAM < 2 GB total — can't run even the smallest model
- Print a note: "Skipping local fallback (insufficient resources). You can add it later: `bash scripts/setup-ollama.sh --apply`"

**Skip flag:** `--skip-ollama` for users who explicitly don't want it (CI environments, Docker minimal builds, etc.)

No prompt, no question. If the hardware can handle it, it just happens.

### Install Flow (Revised)

```
1. Check deps (curl, git, node, brew, openclaw)
2. Clone/update EverClaw
3. Bootstrap API key (GLM-5 starter)
4. [Optional prompt] Install Morpheus Proxy-Router?
5. [NEW - Auto] Detect hardware → install Ollama + optimal model → configure fallback
6. ✅ Done — agent has cloud + local inference
```

Step 5 runs `setup-ollama.sh --apply` under the hood. No user interaction needed. The dry-run output shows what's happening so it's not a black box.

### Files to Change

| File | Change |
|------|--------|
| `scripts/install-with-deps.sh` | Add hardware detection + auto Ollama install after bootstrap key step |
| `SKILL.md` | Update Prerequisites table (Ollama as "auto-installed"), update install flow description |
| Cron job `25a462c4` | Add Ollama version/model tracking to weekly deps check |

### Task B unchanged — add Ollama to weekly deps cron.

---

Cleaner onboarding: `curl | bash` → working agent with cloud AND local inference. Want me to build it?
user: Conversation info (untrusted metadata):
```json
{
  "message_id": "1773330178945",
  "sender_id": "+14432859111",
  "sender": "David Johnston",
  "timestamp": "Thu 2026-03-12 10:42 CDT"
}
```

Sender (untrusted metadata):
```json
{
  "label": "David Johnston (+14432859111)",
  "id": "+14432859111",
  "name": "David Johnston"
}
```

We need to alter the plan. You’re still asking the user for guidance about if they want to Install the Morpheus proxy router. Yhe vast majority of people won’t know what this is and again if they have the hardware required, this is an important part of the tech stack for EverClaw. So let’s apply the same logic we are using with a Ollama and do this work automatically for the user. 

The goal here is the user runs a single command then all the dependencies and features are automatically installed, and the gateway dashboard is automatically launched at the end of the process so they can go right to chatting with their EverClaw.
assistant: You're right — I was still thinking in terms of optional components when the goal is a single-command, zero-interaction install. Let me rethink this completely.

---

## SOP-001 Stage 1: Planning (Final)

### Design Goal

**One command. Zero prompts. Working agent.**

```bash
curl -fsSL https://get.everclaw.xyz | bash
```

User walks away, comes back, dashboard is open, agent is ready to chat. Every component auto-installs based on hardware detection.

### Install Flow

```
1. Detect OS, arch, RAM, disk, GPU
2. Install missing core deps (Homebrew, Node.js, Git)
3. Install OpenClaw (if not present)
4. Clone/update EverClaw skill
5. Bootstrap API key (GLM-5 starter — auto, no prompt)
6. Install Morpheus Proxy-Router (auto if hardware qualifies)
7. Install Ollama + optimal model (auto if hardware qualifies)
8. Run setup.mjs to merge all providers into openclaw.json
9. Restart OpenClaw gateway
10. Launch dashboard in browser
```

**Zero prompts.** Every step either auto-installs or auto-skips with a log message explaining why.

### Hardware Gating

| Component | Minimum to Auto-Install | Skip Reason |
|-----------|------------------------|-------------|
| **Core deps** (curl, git, node) | Always | Never skipped |
| **OpenClaw** | Always | Never skipped |
| **EverClaw** | Always | Never skipped |
| **Bootstrap key** | Always | Never skipped |
| **Morpheus Proxy-Router** | 2 GB disk free (Go binary ~100MB) | "Skipping P2P router (low disk)" |
| **Ollama + model** | ≥5 GB disk AND ≥2 GB RAM | "Skipping local fallback (insufficient resources)" |

### Fallback Chain Result

After a successful install, the user's fallback chain is:

```
mor-gateway/glm-5 (bootstrap key)
  → morpheus/glm-5 (local P2P, if installed)
  → ollama/qwen3.5:Xb (local, if installed)
```

Three layers of inference. Cloud goes down? P2P. P2P goes down? Local. The agent always works.

### Skip Flags (for advanced users / CI)

- `--skip-ollama` — don't install Ollama
- `--skip-proxy` — don't install Morpheus Proxy-Router
- `--skip-openclaw` — for existing OpenClaw installs
- `--check-only` — just report what would happen (existing flag)
- `--auto-install` — already exists, now the default behavior

### Dashboard Launch

At the end:
- macOS: `open http://localhost:3000` (or whatever the gateway port is)
- Linux: `xdg-open http://localhost:3000` or print the URL if no display

### Files to Change

| File | Change | Size |
|------|--------|------|
| `scripts/install-with-deps.sh` | Major rewrite — remove all prompts, add hardware detection, auto Proxy-Router, auto Ollama, auto dashboard launch | Large |
| `SKILL.md` | Update Prerequisites (auto-installed), update install flow docs | Medium |
| Cron job `25a462c4` | Add Ollama + Proxy-Router version tracking | Small |

### Risk Assessment

- **Medium risk** — this is a major rewrite of the installer, not just adding a step
- Mitigated by: keeping `--check-only` for dry-run, keeping `--skip-*` flags as escape hatches
- The existing interactive flow still works via the skip flags if someone wants manual control
- All auto-install steps log clearly what they're doing

---

Ready to build. Want me to start Stage 2?
user: Conversation info (untrusted metadata):
```json
{
  "message_id": "1773330375855",
  "sender_id": "+14432859111",
  "sender": "David Johnston",
  "timestamp": "Thu 2026-03-12 10:46 CDT"
}
```

Sender (untrusted metadata):
```json
{
  "label": "David Johnston (+14432859111)",
  "id": "+14432859111",
  "name": "David Johnston"
}
```

Yes, given the size of the build let’s break this into multiple stages design five coding stages for this that can be accomplished without error.
assistant: Here are 5 coding stages, each self-contained and testable before moving to the next:

---

## Stage 2a: Hardware Detection + Core Deps (Non-Interactive)

**What:** Rewrite the top half of `install-with-deps.sh` — replace all interactive prompts with auto-detection and auto-install for core dependencies.

**Changes:**
- Add hardware detection functions (total RAM, available disk, GPU type) — reuse patterns from setup-ollama.sh
- Store results in variables for downstream stages to gate on
- Rewrite `check_dep` / `install_dependencies` to auto-install without prompts
- Core deps: curl, git, Node.js, npm, Homebrew (macOS) — always install if missing
- Remove all `read -p` prompts from dependency section
- Keep `--check-only` flag (shows what would happen, exits)
- Keep `--skip-openclaw` flag

**Test:** Run `bash install-with-deps.sh --check-only` — should show hardware stats + all dependency statuses with zero prompts.

---

## Stage 2b: EverClaw Clone + Bootstrap Key (Auto)

**What:** Rewrite the EverClaw installation and bootstrap key sections to be fully automatic.

**Changes:**
- Auto-clone or auto-update EverClaw (no "Update to latest? [y/N]" prompt)
- Auto-run bootstrap key setup (no prompt, no user interaction)
- If bootstrap key already exists, skip silently
- If key server is unreachable, log warning and continue (not fatal — Ollama will be the fallback)
- Add OpenClaw install if missing (auto, no prompt)

**Test:** Run on our system — should detect existing install, skip clone, verify bootstrap key, all without prompts.

---

## Stage 2c: Auto Morpheus Proxy-Router

**What:** Replace the interactive Proxy-Router prompt with hardware-gated auto-install.

**Changes:**
- Check disk space: ≥2 GB free → auto-install proxy-router
- If disk < 2 GB → skip with log message
- Add `--skip-proxy` flag for explicit opt-out
- Call existing `scripts/install.sh` for the actual installation
- If proxy-router binary already exists at `~/morpheus/`, skip with "already installed" message

**Test:** Run on our system — should detect existing `~/morpheus/` install and skip. Test `--skip-proxy` flag.

---

## Stage 2d: Auto Ollama Integration

**What:** Wire `setup-ollama.sh` into the installer flow, gated on hardware.

**Changes:**
- Check disk ≥5 GB AND RAM ≥2 GB → auto-run `setup-ollama.sh --apply`
- If either threshold fails → skip with log message explaining why
- Add `--skip-ollama` flag for explicit opt-out
- Capture setup-ollama.sh output and display it (user sees model selection happening)
- If Ollama already installed + configured → skip with "already configured" message

**Test:** Run on our system — should detect existing Ollama + qwen3.5:9b and skip. Test `--skip-ollama` flag. Test with `--check-only` to verify it shows what *would* happen.

---

## Stage 2e: Config Merge + Dashboard Launch + Docs

**What:** Final wiring — merge all providers into openclaw.json, restart gateway, open dashboard, update docs and cron.

**Changes to `install-with-deps.sh`:**
- Run `setup.mjs --apply --restart` to merge all providers and restart
- Detect gateway port from openclaw.json or default 3000
- macOS: `open http://localhost:$PORT`
- Linux: `xdg-open` or print URL if no display server
- Print final success banner with what was installed

**Changes to `SKILL.md`:**
- Update Prerequisites table — Ollama and Proxy-Router listed as "auto-installed"
- Update install flow description — document the zero-prompt experience
- Update the one-line install section

**Changes to cron job `25a462c4`:**
- Add Part 3: Ollama version check (`ollama --version` vs GitHub latest)
- Add Part 4: Morpheus Proxy-Router version check (binary version vs GitHub latest)

**Test:** Full end-to-end: `bash install-with-deps.sh --check-only` shows complete plan. Verify SKILL.md reads correctly. Verify cron job payload is valid.

---

Each stage produces a working script — if we stop after any stage, the installer still functions (just without the later automation). Want me to start Stage 2a?
user: Conversation info (untrusted metadata):
```json
{
  "message_id": "1773331549046",
  "sender_id": "+14432859111",
  "sender": "David Johnston",
  "timestamp": "Thu 2026-03-12 11:05 CDT"
}
```

Sender (untrusted metadata):
```json
{
  "label": "David Johnston (+14432859111)",
  "id": "+14432859111",
  "name": "David Johnston"
}
```

Great. Save all this context in a file specifically for this coding work we are about to do.
Because you are low on Venice credits on this key and I'll give you a new key to use after you save the files.
assistant: All context saved:

- **Full build plan:** `memory/projects/everclaw/installer-rewrite-2026-03-12.md` — all 5 stages, hardware gating thresholds, file list, patterns to reuse, current versions
- **Daily log:** updated with planning session summary

Ready to pick up Stage 2a whenever you've got the new key set up.
user: Conversation info (untrusted metadata):
```json
{
  "message_id": "1773331620155",
  "sender_id": "+14432859111",
  "sender": "David Johnston",
  "timestamp": "Thu 2026-03-12 11:07 CDT"
}
```

Sender (untrusted metadata):
```json
{
  "label": "David Johnston (+14432859111)",
  "id": "+14432859111",
  "name": "David Johnston"
}
```

Go ahead and switch to this Venice Key.
VENICE_INFERENCE_KEY_PLJ6Ic1QlGdV5pHpjVwGqAFktom-WcMVsVrHMA5CX1
assistant: I'll update the auth profile with the new key. The key name format suggests it's a Venice inference key.
assistant: Done. Venice key1 swapped to the new key and gateway restarted. Ready to start Stage 2a whenever you say go.
