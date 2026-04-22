# ♾️ EverClaw — Morpheus Skill Monorepo

*Open-source first AI inference — own your inference forever via the Morpheus decentralized network.*

**Canonical repository:** [profbernardoj/morpheus-skill](https://github.com/profbernardoj/morpheus-skill)

---

## What Is This?

EverClaw (Morpheus Skill) connects your [OpenClaw](https://github.com/openclaw/openclaw) agent to the [Morpheus](https://mor.org) decentralized inference network — putting open-source models like GLM-5 front and center as your default, with Claude as a fallback only when needed.

Your agent runs on inference you own: GLM-5, GLM-4.7 Flash, Kimi K2.5, and 30+ models powered by staked MOR tokens that recycle back to you.

## Repository Structure

This is a **monorepo** that produces 28+ flavor repos via composition:

```
packages/
  core/                # Common Morpheus infrastructure
    scripts/           # All shared scripts (proxy, session, wallet, security, setup)
    tests/             # All tests
    references/        # API docs, economics, models
    docs/              # Documentation site
    templates/         # Boot templates, system configs, flavor persona templates
    config/            # Default OpenClaw configs
    SKILL.md           # Core skill definition
    Dockerfile         # Container build
    docker-compose.yml # Docker compose
  everclaw-docker/     # Docker-specific build configs
  everclaw-key-api/    # Vercel key API service

flavors/
  morpheus-skill/      # The canonical/default flavor
  androidclaw.org/     # Android ecosystem flavor
  bitcoinclaw.ai/      # Bitcoin ecosystem flavor
  emailclaw.org/       # Email management flavor
  ethereumclaw.com/    # Ethereum ecosystem flavor
  ...                  # 28 total flavor directories (one per domain)

scripts/
  ecosystem-sync.sh    # Composes core + flavor → pushes to flavor remotes
  flavor-compose.sh    # Composes a single flavor into a deployable repo

skills/                # Bundled skills (security, chat, prompt-guard, etc.)
archive/               # Archived: alternative installers, marketing, one-time tools
```

### How It Works

1. **`packages/core/`** contains all shared infrastructure: scripts, tests, docs, templates
2. **`flavors/<name>/`** contains flavor-specific files: README.md, flavor.json, persona templates
3. **`scripts/ecosystem-sync.sh`** composes each flavor by merging core + flavor → pushes to that flavor's remote
4. **Canonical remotes** (`origin`, `everclaw-org`) receive the full monorepo
5. **Flavor remotes** receive only the composed output (core + their specific flavor)

## Install

### One-Line Install

```bash
curl -fsSL https://get.everclaw.xyz | bash
```

### Manual Install

```bash
git clone https://github.com/profbernardoj/morpheus-skill.git
cd morpheus-skill
npm install
node packages/core/scripts/setup.mjs
```

## Flavor Repos

Each flavor is a standalone repo with its own domain and persona:

| Flavor | Domain | Description |
|--------|--------|-------------|
| morpheus-skill | morpheusclaw.com | Canonical default |
| bitcoinclaw.ai | bitcoinclaw.ai | Bitcoin ecosystem |
| ethereumclaw.com | ethereumclaw.com | Ethereum ecosystem |
| glmclaw.com | glmclaw.com | GLM model focus |
| emailclaw.org | emailclaw.org | Email management |
| ... | ... | 28 total flavors |

See `flavors/` for the complete list with `flavor.json` configs.

## Development

### Sync to All Remotes

```bash
# Dry run — see what would happen
./scripts/ecosystem-sync.sh --dry-run

# Push to all remotes
./scripts/ecosystem-sync.sh

# Push only one flavor
./scripts/ecosystem-sync.sh --flavor bitcoinclaw.ai
```

### Compose a Single Flavor

```bash
./scripts/flavor-compose.sh flavors/bitcoinclaw.ai /tmp/composed/bitcoinclaw.ai
```

### Run Tests

```bash
npm test
```

### Adding a New Flavor

1. Create the flavor directory:
   ```bash
   mkdir -p flavors/my-new-flavor
   ```
2. Create `flavors/my-new-flavor/flavor.json`:
   ```json
   {
     "name": "My New Flavor",
     "slug": "my-new-flavor",
     "domain": "my-new-flavor.com",
     "description": "What this flavor does",
     "remote": "https://github.com/org/my-new-flavor.git",
     "defaultModel": "glm-5",
     "persona": "Short persona description"
   }
   ```
3. Create `flavors/my-new-flavor/README.md` with flavor-specific documentation.
4. (Optional) Add `flavors/my-new-flavor/templates/` with custom SOUL.md, IDENTITY.md, etc.
5. Add a git remote: `git remote add my-new-flavor https://github.com/org/my-new-flavor.git`
6. Sync: `./scripts/ecosystem-sync.sh --flavor my-new-flavor`

## Key Features

- **Morpheus Proxy** — OpenAI-compatible proxy with auto-session management
- **Model Router** — 3-tier routing (light/standard/heavy), open-source first
- **Wallet Management** — Zero-dependency via macOS Keychain
- **Gateway Guardian** — Health watchdog with billing-aware escalation
- **Security** — PII guard, gateway guardian, bundled security skills
- **x402 Payments** — Agent-to-agent USDC payments
- **ERC-8004 Registry** — Discover trustless agents on Base
- **Local Fallback** — Hardware-aware Ollama with auto model selection
- **Buddy Bots** — Multi-agent coordination and provisioning
- **Three-Shift Engine** — Cyclic task execution (6 AM / 2 PM / 10 PM)

## License

MIT
