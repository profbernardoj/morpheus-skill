---
name: skillguard
description: Security scanner for AgentSkill packages. Scan skills for credential theft, code injection, prompt manipulation, data exfiltration, and evasion techniques before installing them. Use when evaluating skills from ClawHub or any untrusted source.
metadata: {"openclaw": {"requires": {"bins": ["node"]}}}
---

# SkillGuard — Agent Security Scanner

When asked to check, audit, or scan a skill for security, use SkillGuard.

## Trust Model (v0.3)

SkillGuard distinguishes between **internal** (trusted) and **external** (untrusted) skills:

- **Internal skills** — Skills under `~/.openclaw/workspace/skills/` or `~/.openclaw/workspace/claw-repos/`. These are skills we authored ourselves.
- **External skills** — Everything else (ClawHub downloads, third-party packages, etc.)

### Why it matters

Internal skills legitimately use patterns like `exec()`, `process.env.API_KEY`, `fetch()`, and `writeFile()` — that's infrastructure code doing its job. Flagging those as "suspicious" creates noise that buries real issues.

For **internal skills**, SkillGuard uses vulnerability-focused scanning:
- ✅ Still flags: hardcoded secrets, reverse shells, pickle deserialization, unsafe YAML, actual code obfuscation, prompt injection in operational code
- ❌ Suppresses: "uses exec", "reads env vars", "makes HTTP requests", "writes files", "references private keys" (in wallet tools), "uses sudo" (in setup scripts), behavioral compound signatures

For **external skills**, full paranoid threat-model scanning applies — every pattern is treated as potentially malicious.

### Overriding trust

Use `--untrusted` to force external mode on an internal skill:
```bash
node src/cli.js scan /path/to/skill --untrusted
```

## Commands

### Scan a local skill directory
```bash
node /home/claw/.openclaw/workspace/skillguard/src/cli.js scan <path>
```

### Scan with compact output (for chat)
```bash
node /home/claw/.openclaw/workspace/skillguard/src/cli.js scan <path> --compact
```

### Check text for prompt injection
```bash
node /home/claw/.openclaw/workspace/skillguard/src/cli.js check "<text>"
```

### Batch scan multiple skills
```bash
node /home/claw/.openclaw/workspace/skillguard/src/cli.js batch <directory>
```

### Scan a ClawHub skill by slug
```bash
node /home/claw/.openclaw/workspace/skillguard/src/cli.js scan-hub <slug>
```

## Score Interpretation
- 80-100 ✅ LOW risk — safe to install
- 50-79 ⚠️ MEDIUM — review findings before installing
- 20-49 🟠 HIGH — significant security concerns
- 0-19 🔴 CRITICAL — do NOT install without manual review

## Output Formats
- Default: full text report
- `--compact`: chat-friendly summary
- `--json`: machine-readable full report
- `--quiet`: score and verdict only
