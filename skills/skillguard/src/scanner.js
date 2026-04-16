/**
 * SkillGuard Scanner v0.3 — Trust-Aware Engine
 * 
 * Three-layer analysis:
 * 1. Pattern matching (fast, catches obvious threats)
 * 2. AST/evasion analysis (catches obfuscation and tricks)
 * 3. Prompt injection analysis (catches social engineering)
 * 
 * Plus: context-aware scoring that reduces false positives
 * 
 * v0.3: Trust-aware scanning. Internal skills (authored by us) get
 * vulnerability-focused analysis — real bugs, hardcoded secrets,
 * reverse shells. External skills get full threat-model scanning
 * including intent analysis and behavioral signatures.
 * 
 * The distinction: "this code uses exec()" is a feature in our own
 * infrastructure tools, but a red flag in an untrusted download.
 */

import { readFile, readdir, stat } from 'fs/promises';
import { join, extname, basename, resolve } from 'path';
import { homedir } from 'os';
import { ASTAnalyzer } from './ast-analyzer.js';
import { PromptAnalyzer } from './prompt-analyzer.js';

const CODE_EXTENSIONS = new Set([
  '.js', '.ts', '.mjs', '.cjs', '.jsx', '.tsx',
  '.py', '.pyw',
  '.sh', '.bash', '.zsh',
  '.rb', '.pl',
]);

const TEXT_EXTENSIONS = new Set([
  '.json', '.yaml', '.yml', '.toml',
  '.md', '.txt', '.rst',
  '.env', '.env.example',
  '.cfg', '.ini', '.conf',
]);

const BINARY_EXTENSIONS = new Set([
  '.exe', '.dll', '.so', '.dylib', '.bin', '.dat',
  '.wasm', '.node', '.o', '.a',
]);

// Known-good network targets (reduce false positives)
const KNOWN_GOOD_APIS = [
  'wttr.in', 'api.github.com', 'registry.npmjs.org',
  'pypi.org', 'api.openai.com', 'api.anthropic.com',
  'api.weather.gov', 'googleapis.com', 'api.telegram.org',
];

// === TRUST MODEL ===
// These categories represent REAL vulnerabilities we always flag,
// even in our own code. Everything else (exec, fetch, env access)
// is expected infrastructure behavior for internal tools.
const ALWAYS_FLAG_RULE_IDS = new Set([
  // Reverse shells / backdoors — always flag, internal or not
  'SHELL_CRITICAL',       // netcat listeners, /dev/tcp, mkfifo+nc
  // Deserialization attacks — always flag (real vulnerability)
  'PYTHON_PICKLE',        // pickle.loads
  'PYTHON_MARSHALL',      // marshal.loads
  'PYTHON_YAML',          // unsafe yaml.load
  // Obfuscation — hiding intent is always suspicious, even internally
  'STRING_CONSTRUCTION',  // building strings to hide code
  'ENCODED_STRING',       // encoded payloads
  'FUNCTION_ALIAS',       // aliasing dangerous functions
  // NOTE: PROMPT_INJECTION, PROMPT_OVERRIDE, PROMPT_JAILBREAK are NOT here.
  // Prompt injection detection is context-dependent — a security doc describing
  // injection patterns isn't the same as actual injection. The prompt-injection
  // category handler in applyTrustSuppression decides what to keep vs suppress.
]);

// Categories that are fine in internal code but suspicious externally
const INTERNAL_EXPECTED_CATEGORIES = new Set([
  'code-execution',
  'credential-theft',
  'data-exfiltration',
  'filesystem',
  'behavioral',
  'suspicious-file',
  'financial',          // Wallet/key management tools naturally reference seed phrases, private keys
  'privilege-escalation', // Setup scripts legitimately use sudo
  'persistence',        // Tools that set up systemd/launchd services are expected
  'evasion',            // Temp files, PID-based names, etc. are standard patterns
  'reconnaissance',     // Test files and path discovery are standard
  'prototype-pollution', // Compiled TS __spreadArray helpers trigger false positives
]);

// Default trusted paths (expanded ~ at runtime)
const DEFAULT_TRUSTED_PATHS = [
  '~/.openclaw/workspace/skills/',
  '~/.openclaw/workspace/claw-repos/',
];

/**
 * Check if a file path is documentation, test, or non-operational code.
 * Findings in these files are almost always false positives for internal skills.
 * @param {string} file — Relative file path
 * @returns {boolean}
 */
function isDocumentationOrTest(file) {
  return /references\//.test(file) ||
    /examples?\//.test(file) ||
    /test|spec/i.test(file) ||
    /blog\//.test(file) ||
    /docs?\//.test(file) ||
    /pattern/i.test(file) ||
    /\.ya?ml$/i.test(file) ||
    /config/i.test(file) ||
    /^(README|ARCHITECTURE|CHANGELOG|RELEASE|CONTRIBUTING|DESIGN|SECURITY)/i.test(file) ||
    // Only detection/guard code that lives under known guard directories — tighten
    // to match files like detect.py, guard.mjs, scanner.js, engine.ts
    // Also matches files under directories named with guard/detect patterns (incl. underscore variants)
    /(?:^|\/)(detect|guard|engine|normalizer|decoder|scanner|analyzer)[^/]*\.(js|ts|py)$/i.test(file) ||
    /\/(detect|guard|engine|normalizer|decoder|scanner|analyzer)[^/]*\//i.test(file) ||
    /[_.](detect|guard|engine|normalizer|decoder|scanner|analyzer)/i.test(file) ||
    /\b(dist|build)\//.test(file);
}

/**
 * Resolve ~ in paths and normalize
 */
function expandPath(p) {
  if (p.startsWith('~/')) {
    return resolve(homedir(), p.slice(2));
  }
  return resolve(p);
}

/**
 * Determine if a skill path is "trusted" (internal/authored by us)
 * @param {string} skillPath — Absolute path to skill
 * @param {Object} [trustConfig] — Optional trust config override
 * @returns {{ trusted: boolean, reason: string }}
 */
function resolveTrust(skillPath, trustConfig) {
  const absPath = resolve(skillPath);

  // Check explicit trusted paths
  const trustedPaths = trustConfig?.trustedPaths || DEFAULT_TRUSTED_PATHS;
  for (const tp of trustedPaths) {
    const expanded = expandPath(tp);
    if (absPath.startsWith(expanded)) {
      return { trusted: true, reason: `Path under trusted directory: ${tp}` };
    }
  }

  return { trusted: false, reason: 'Path not in trusted directories' };
}

export class SkillScanner {
  /**
   * @param {Object[]} rules — Pattern rules
   * @param {Object} [options]
   * @param {boolean} [options.trusted] — Force trust mode (overrides path detection)
   * @param {Object} [options.trustConfig] — Trust config from rules/trust-config.json
   */
  constructor(rules, options = {}) {
    this.rules = rules;
    this.compiledRules = rules.map(rule => ({
      ...rule,
      compiled: rule.patterns.map(p => new RegExp(p, 'gi')),
    }));
    this.astAnalyzer = new ASTAnalyzer();
    this.promptAnalyzer = new PromptAnalyzer();
    this._forceTrust = options.trusted;
    this._trustConfig = options.trustConfig || null;
  }

  /**
   * Full skill directory scan — three-layer analysis
   */
  async scanDirectory(skillPath) {
    // Resolve trust status
    let trustStatus;
    if (this._forceTrust === true) {
      trustStatus = { trusted: true, reason: 'Forced via options.trusted=true' };
    } else if (this._forceTrust === false) {
      trustStatus = { trusted: false, reason: 'Forced via options.trusted=false' };
    } else {
      trustStatus = resolveTrust(skillPath, this._trustConfig);
    }

    const report = {
      path: skillPath,
      scannedAt: new Date().toISOString(),
      version: '0.3.0',
      trust: trustStatus,
      files: [],
      findings: [],
      score: 100,
      summary: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      metadata: null,
      flags: [],
      declaredCapabilities: {},
      behavioralSignatures: [],
    };

    // Parse SKILL.md
    const skillMd = await this.readFileSafe(join(skillPath, 'SKILL.md'));
    if (!skillMd) {
      report.flags.push('NO_SKILL_MD');
    } else {
      report.metadata = this.parseSkillMetadata(skillMd);
      report.declaredCapabilities = this.extractDeclaredCapabilities(report.metadata);

      // Run prompt analysis on SKILL.md (common injection target)
      const promptFindings = this.promptAnalyzer.analyze(skillMd, 'SKILL.md');
      report.findings.push(...promptFindings);
    }

    // Enumerate files
    const files = await this.walkDirectory(skillPath);
    report.files = files.map(f => ({
      path: f.relativePath,
      size: f.size,
      type: f.type,
    }));

    // Check file structure
    this.checkFileStructure(files, report);

    // Scan each file
    for (const file of files) {
      if (file.type === 'binary') {
        report.findings.push({
          ruleId: 'BINARY_FILE',
          severity: 'high',
          category: 'suspicious-file',
          title: 'Binary file included in skill package',
          file: file.relativePath,
          line: 0,
          context: `Binary file: ${file.relativePath} (${file.size} bytes)`,
          weight: 15,
        });
        continue;
      }

      if (file.type === 'directory-skipped') continue;

      const content = await this.readFileSafe(file.absolutePath);
      if (!content) continue;

      // Layer 1: Pattern matching
      this.patternScan(content, file.relativePath, report);

      // Layer 2: AST/evasion analysis (JS/TS files)
      const ext = extname(file.relativePath).toLowerCase();
      if (CODE_EXTENSIONS.has(ext) && (ext.startsWith('.j') || ext.startsWith('.t') || ext.startsWith('.m') || ext.startsWith('.c'))) {
        const astFindings = this.astAnalyzer.analyze(content, file.relativePath);
        report.findings.push(...astFindings);
      }

      // Layer 3: Prompt injection analysis (text/markdown files)
      if (TEXT_EXTENSIONS.has(ext) || ext === '.md') {
        if (file.relativePath !== 'SKILL.md') { // Already scanned SKILL.md above
          const promptFindings = this.promptAnalyzer.analyze(content, file.relativePath);
          report.findings.push(...promptFindings);
        }
      }

      // Python-specific evasion detection
      if (ext === '.py' || ext === '.pyw') {
        this.pythonAnalysis(content, file.relativePath, report);
      }

      // Shell script analysis
      if (ext === '.sh' || ext === '.bash' || ext === '.zsh') {
        this.shellAnalysis(content, file.relativePath, report);
      }
    }

    // Deduplicate
    report.findings = this.deduplicateFindings(report.findings);

    // Detect behavioral signatures first (needs raw findings)
    this.detectBehavioralSignatures(report);

    // Context-aware scoring adjustments (may suppress behavioral findings too)
    await this.applyContextScoring(report);

    // Trust-aware suppression: internal skills only flag real vulnerabilities
    if (report.trust.trusted) {
      this.applyTrustSuppression(report);
    }

    // Aggregate repeated findings — same rule in same file counts once
    this.aggregateFindings(report);

    // Re-check behavioral suppression after aggregation (may have changed severities)
    this.recheckBehavioralSuppression(report);

    // Calculate final score
    this.calculateScore(report);

    return report;
  }

  /**
   * Scan content (for Moltbook posts, messages, etc.)
   */
  scanContent(content, source = 'unknown') {
    const findings = [];

    // Pattern matching
    const lines = content.split('\n');
    for (const rule of this.compiledRules) {
      for (const regex of rule.compiled) {
        regex.lastIndex = 0;
        let match;
        while ((match = regex.exec(content)) !== null) {
          const beforeMatch = content.slice(0, match.index);
          const lineNum = (beforeMatch.match(/\n/g) || []).length + 1;
          findings.push({
            ruleId: rule.id,
            severity: rule.severity,
            category: rule.category,
            title: rule.title,
            file: source,
            line: lineNum,
            match: match[0].slice(0, 80),
            context: (lines[lineNum - 1] || '').trim().slice(0, 200),
            weight: rule.weight,
          });
        }
      }
    }

    // Prompt injection analysis
    const promptFindings = this.promptAnalyzer.analyze(content, source);
    findings.push(...promptFindings);

    return this.deduplicateFindings(findings);
  }

  /**
   * Layer 1: Pattern matching scan
   */
  patternScan(content, filePath, report) {
    const lines = content.split('\n');
    const ext = extname(filePath).toLowerCase().slice(1);

    for (const rule of this.compiledRules) {
      if (!rule.languages.includes('*') && !rule.languages.includes(ext)) continue;

      for (const regex of rule.compiled) {
        regex.lastIndex = 0;
        let match;
        while ((match = regex.exec(content)) !== null) {
          const beforeMatch = content.slice(0, match.index);
          const lineNum = (beforeMatch.match(/\n/g) || []).length + 1;
          const lineContent = lines[lineNum - 1]?.trim() || '';

          report.findings.push({
            ruleId: rule.id,
            severity: rule.severity,
            category: rule.category,
            title: rule.title,
            file: filePath,
            line: lineNum,
            match: match[0].slice(0, 80),
            context: lineContent.slice(0, 200),
            weight: rule.weight,
          });
        }
      }
    }
  }

  /**
   * Python-specific evasion detection
   */
  pythonAnalysis(content, filePath, report) {
    const checks = [
      { regex: /\b__import__\s*\(/g, msg: 'Dynamic __import__() — bypasses static import analysis', severity: 'critical', weight: 25 },
      { regex: /\bgetattr\s*\([^,]+,\s*['"]/g, msg: 'getattr() — dynamic attribute access may evade analysis', severity: 'high', weight: 15 },
      { regex: /\bcompile\s*\([^)]+['"]exec['"]/g, msg: 'compile() with exec mode — dynamic code execution', severity: 'critical', weight: 25 },
      { regex: /\bpickle\s*\.\s*loads?\s*\(/g, msg: 'pickle deserialization — can execute arbitrary code', severity: 'critical', weight: 30 },
      { regex: /\bmarshall?\s*\.\s*loads?\s*\(/g, msg: 'marshal deserialization — can execute arbitrary code', severity: 'critical', weight: 30 },
      { regex: /\bsubprocess\s*\.\s*(?:call|run|Popen|check_output)/g, msg: 'subprocess execution', severity: 'high', weight: 15 },
      { regex: /\bctypes\s*\.\s*(?:cdll|windll|CDLL)/g, msg: 'ctypes foreign function interface — native code execution', severity: 'critical', weight: 25 },
      { regex: /\bos\s*\.\s*system\s*\(/g, msg: 'os.system() — shell command execution', severity: 'critical', weight: 25 },
      { regex: /\bos\s*\.\s*popen\s*\(/g, msg: 'os.popen() — shell command execution', severity: 'critical', weight: 25 },
      { regex: /\b(?:yaml\s*\.\s*(?:load|unsafe_load))\s*\(/g, msg: 'Unsafe YAML loading — can execute arbitrary code', severity: 'critical', weight: 25 },
    ];

    for (const { regex, msg, severity, weight } of checks) {
      let match;
      while ((match = regex.exec(content)) !== null) {
        const lineNum = (content.slice(0, match.index).match(/\n/g) || []).length + 1;
        report.findings.push({
          ruleId: 'PYTHON_' + msg.split(' ')[0].toUpperCase(),
          severity,
          category: 'code-execution',
          title: msg,
          file: filePath,
          line: lineNum,
          match: match[0],
          context: content.split('\n')[lineNum - 1]?.trim().slice(0, 200) || '',
          weight,
        });
      }
    }
  }

  /**
   * Shell script analysis
   */
  shellAnalysis(content, filePath, report) {
    const checks = [
      { regex: /\bcurl\s+[^|]*\|\s*(?:bash|sh|zsh)/g, msg: 'Pipe curl to shell — remote code execution', severity: 'critical', weight: 30 },
      { regex: /\bwget\s+[^|]*\|\s*(?:bash|sh|zsh)/g, msg: 'Pipe wget to shell — remote code execution', severity: 'critical', weight: 30 },
      { regex: /\beval\s+"\$\(/g, msg: 'eval with command substitution', severity: 'critical', weight: 25 },
      { regex: /\bbase64\s+(?:-d|--decode)/g, msg: 'Base64 decode in shell — may hide payload', severity: 'high', weight: 20 },
      { regex: /\bnc\s+(?:-[elp]|--listen)/g, msg: 'Netcat listener — reverse shell indicator', severity: 'critical', weight: 30 },
      { regex: /\/dev\/tcp\//g, msg: 'Bash /dev/tcp — network connection without external tools', severity: 'critical', weight: 30 },
      { regex: /\bmkfifo\b.*\bnc\b|\bnc\b.*\bmkfifo\b/g, msg: 'Named pipe + netcat — reverse shell pattern', severity: 'critical', weight: 30 },
    ];

    for (const { regex, msg, severity, weight } of checks) {
      let match;
      while ((match = regex.exec(content)) !== null) {
        const lineNum = (content.slice(0, match.index).match(/\n/g) || []).length + 1;
        report.findings.push({
          ruleId: 'SHELL_' + severity.toUpperCase(),
          severity,
          category: 'code-execution',
          title: msg,
          file: filePath,
          line: lineNum,
          match: match[0],
          context: content.split('\n')[lineNum - 1]?.trim().slice(0, 200) || '',
          weight,
        });
      }
    }
  }

  /**
   * Context-aware scoring adjustments
   * The core insight: a legit API skill MUST read tokens and make network calls.
   * What matters is WHERE the data goes and WHETHER capabilities are declared.
   */
  async applyContextScoring(report) {
    const declared = report.declaredCapabilities;
    const allContexts = report.findings.map(f => f.context + ' ' + f.match).join(' ');

    // Check if network calls target known-good APIs (search full file contents too)
    const targetsKnownAPI = KNOWN_GOOD_APIS.some(api => allContexts.includes(api));

    // Build a map of constant string values from all scanned files
    // This helps resolve variables like `const API_BASE = 'https://api.github.com'`
    const resolvedURLs = new Set();
    for (const file of report.files) {
      if (file.type === 'code' || file.type === 'text') {
        const content = await this.readFileSafe(join(report.path, file.path));
        if (content) {
          // Extract string constants that look like URLs
          const urlConsts = content.matchAll(/(?:const|let|var)\s+\w+\s*=\s*['"`](https?:\/\/[^'"`\s]+)['"`]/g);
          for (const match of urlConsts) {
            resolvedURLs.add(match[1]);
          }
        }
      }
    }

    // Check if any resolved URLs point to known-good APIs
    const fileTargetsKnownAPI = [...resolvedURLs].some(url =>
      KNOWN_GOOD_APIS.some(api => url.includes(api))
    );

    // Check if credential access matches declared env vars
    const declaredEnvVars = declared.env || [];

    for (const finding of report.findings) {
      // === CREDENTIAL ACCESS ===
      if (finding.ruleId === 'CRED_ACCESS' || finding.category === 'credential-theft') {
        // If the specific env var is declared in metadata, this is expected behavior
        const accessesDeclaredVar = declaredEnvVars.some(envVar =>
          finding.context.includes(envVar) || finding.match.includes(envVar)
        );

        if (accessesDeclaredVar) {
          finding.weight = Math.max(1, Math.floor(finding.weight * 0.1)); // 90% reduction
          finding.contextNote = 'Accesses declared env var — expected behavior';
          finding.severity = 'info';
          continue;
        }

        // process.env.SPECIFIC_VAR (not iterating all env) is less suspicious
        if (/process\.env\.\w+/.test(finding.context) && !finding.context.includes('Object.entries')) {
          finding.weight = Math.max(2, Math.floor(finding.weight * 0.4));
          finding.contextNote = 'Specific env var access (not harvesting)';
          if (finding.severity === 'critical') finding.severity = 'medium';
        }

        // api_key / api-key as variable name, function param, or dict key in code = standard pattern
        // Distinguished from reading credential FILES by checking context
        if (/api[_-]?key/i.test(finding.match) && finding.file.match(/\.(py|js|ts|rb)$/)) {
          const ctx = finding.context.toLowerCase();
          const isVariableUsage = /(?:def |self\.|=|,|\(|:)\s*api[_-]?key/i.test(ctx) ||
            /api[_-]?key\s*[=:]/i.test(ctx) ||
            /headers|params|config|settings|options/i.test(ctx);
          if (isVariableUsage) {
            finding.weight = Math.max(2, Math.floor(finding.weight * 0.3));
            finding.contextNote = 'API key as variable/parameter — standard code pattern';
            finding.severity = 'medium';
          }
        }
      }

      // === OBFUSCATION — context-aware ===
      if (finding.ruleId === 'OBFUSCATION' && /base64/i.test(finding.match)) {
        // base64 in image/media scripts is standard (images come as base64 from APIs)
        const isMediaScript = /image|photo|media|picture|visual|gen|generate|draw|paint/i.test(
          finding.file + ' ' + (report.metadata?.description || '')
        );
        if (isMediaScript) {
          finding.weight = Math.max(2, Math.floor(finding.weight * 0.2));
          finding.contextNote = 'base64 in image/media context — standard encoding, not obfuscation';
          finding.severity = 'low';
        }
      }

      // === NETWORK ACTIVITY ===
      if (finding.category === 'data-exfiltration' || finding.ruleId === 'NETWORK_EXFIL') {
        const matchedGood = KNOWN_GOOD_APIS.some(api =>
          finding.context.includes(api) || finding.match.includes(api)
        ) || fileTargetsKnownAPI;

        // Skill describes itself as API-related + code uses standard HTTP libs = expected
        const descMentionsAPI = /\bapi\b|fetch|http|endpoint|service|query|search/i.test(
          report.metadata?.description || ''
        );
        const isStandardHTTPLib = /\b(httpx|requests|axios|fetch|urllib|http\.client)\b/.test(
          finding.context + ' ' + finding.match
        );

        if (matchedGood && declared.network) {
          finding.weight = Math.max(1, Math.floor(finding.weight * 0.1)); // 90% reduction
          finding.contextNote = 'Known-good API + declared network capability';
          finding.severity = 'info';
        } else if (matchedGood) {
          finding.weight = Math.max(1, Math.floor(finding.weight * 0.2)); // 80% reduction
          finding.contextNote = 'Known-good API';
          finding.severity = 'low';
        } else if (declared.network) {
          finding.weight = Math.max(2, Math.floor(finding.weight * 0.5));
          finding.contextNote = 'Declared network capability';
        } else if (descMentionsAPI && isStandardHTTPLib) {
          // Skill says it's an API tool and uses standard HTTP libraries
          finding.weight = Math.max(2, Math.floor(finding.weight * 0.3));
          finding.contextNote = 'API skill using standard HTTP library';
          finding.severity = finding.severity === 'critical' ? 'medium' : 'low';
        }
      }

      // === FILESYSTEM ===
      if (declared.filesystem && finding.category === 'filesystem') {
        finding.weight = Math.max(2, Math.floor(finding.weight * 0.5));
        finding.contextNote = 'Declared filesystem capability';
      }

      // === COMMENTS/DOCUMENTATION ===
      if (finding.context.startsWith('//') || finding.context.startsWith('#') ||
          finding.context.startsWith('*') || finding.context.startsWith('/*')) {
        if (finding.category !== 'prompt-injection') {
          finding.weight = Math.max(1, Math.floor(finding.weight * 0.3));
          finding.contextNote = (finding.contextNote || '') + ' (in comment)';
          if (finding.severity === 'critical') finding.severity = 'medium';
          else if (finding.severity === 'high') finding.severity = 'low';
        }
      }

      // === DOCUMENTATION FILES ===
      // SKILL.md, READMEs, and other docs are instructions, not executable code.
      // Mentions of API keys, curl commands, config paths = setup docs, not threats.
      const isDocFile = /^(SKILL\.md|README|CHANGELOG|LICENSE|.*README.*\.md|SERVER_README)/i.test(finding.file);
      if (isDocFile && finding.category !== 'prompt-injection') {
        finding.weight = Math.max(1, Math.floor(finding.weight * 0.1));
        finding.contextNote = (finding.contextNote || '') + ' (in documentation)';
        finding.severity = 'info';
      }

      // SKILL.md frontmatter (---) is metadata, never dangerous
      if (finding.file === 'SKILL.md' && finding.context.startsWith('---')) {
        finding.weight = 0;
        finding.contextNote = 'YAML frontmatter — metadata only';
        finding.severity = 'info';
      }

      // Prompt injection in SKILL.md frontmatter specifically is also not real injection
      if (finding.file === 'SKILL.md' && finding.category === 'prompt-injection') {
        const lineNum = finding.line;
        // Check if this finding is within the frontmatter block (first --- to second ---)
        if (report.metadata && lineNum <= 10) {
          // Likely in frontmatter — heavily downweight
          finding.weight = Math.max(0, Math.floor(finding.weight * 0.05));
          finding.contextNote = 'In SKILL.md frontmatter — not injection';
          finding.severity = 'info';
        }
      }
    }

    // === BEHAVIORAL COMPOUND ADJUSTMENTS ===
    // If ALL credential access is to declared vars AND all network goes to known APIs,
    // suppress compound behavioral findings
    const allCredDeclared = report.findings
      .filter(f => (f.category === 'credential-theft' || f.ruleId === 'CRED_ACCESS') && f.weight > 0)
      .every(f => f.severity === 'info' || (f.contextNote || '').includes('declared') || (f.contextNote || '').includes('standard code'));

    const allNetworkKnown = report.findings
      .filter(f => (f.category === 'data-exfiltration' || f.ruleId === 'NETWORK_EXFIL') && f.weight > 0)
      .every(f => f.severity === 'info' || f.severity === 'low' ||
        (f.contextNote || '').includes('Declared') || (f.contextNote || '').includes('Known-good') ||
        (f.contextNote || '').includes('API skill'));

    if (allCredDeclared && allNetworkKnown) {
      for (const finding of report.findings) {
        if (finding.category === 'behavioral') {
          finding.weight = Math.max(1, Math.floor(finding.weight * 0.1));
          finding.contextNote = 'Suppressed — all access is declared/known-good';
          finding.severity = 'info';
        }
      }
      // Also suppress behavioral signatures
      for (const sig of report.behavioralSignatures) {
        sig.suppressed = true;
        sig.note = 'All underlying access is declared/known-good';
      }
    }
  }

  /**
   * Trust-aware suppression for internal skills.
   * 
   * Philosophy: Internal skills are code WE wrote. We don't need to be told
   * "this code uses exec()" or "this code reads env vars" — of course it does,
   * we wrote it that way on purpose.
   * 
   * What we DO still want:
   * - Hardcoded secrets (real vulnerability — we might have left one in)
   * - Reverse shells (would indicate compromise)
   * - Pickle/marshal deserialization (real vulnerability)
   * - Unsafe YAML loading (real vulnerability)
   * - Obfuscation patterns (our code shouldn't be obfuscated)
   * - Prompt injection in text files (could indicate tampering)
   * 
   * What we suppress:
   * - "Uses exec/spawn" — yes, it's a CLI tool
   * - "Reads API keys from env" — yes, it needs credentials
   * - "Makes HTTP requests" — yes, it calls APIs
   * - "Writes files" — yes, it manages config
   * - Behavioral compound signatures — "credential read + network = exfil" is
   *   nonsensical for a tool that needs an API key to call an API
   */
  applyTrustSuppression(report) {
    let suppressedCount = 0;

    for (const finding of report.findings) {
      // Always keep real vulnerability findings regardless of trust
      if (ALWAYS_FLAG_RULE_IDS.has(finding.ruleId)) {
        continue;
      }

      // Always keep prompt injection findings (could indicate tampering)
      // BUT for internal skills, heavily suppress PI findings that are clearly
      // documentation/examples/tests — a security tool describing injection
      // patterns isn't the same as actual injection.
      if (finding.category === 'prompt-injection') {
        if (report.trust?.trusted) {
          const file = finding.file || '';
          const ctx = finding.context || '';
          const isDocOrTest = isDocumentationOrTest(file);
          // SKILL.md is never executable code; it's always instructions/docs
          const isSkillMd = /SKILL\.md$/i.test(file);
          // A security document is any file that is documentation, test, or SKILL.md
          const isSecurityDocument = isDocOrTest || isSkillMd;

          // Content in a markdown table with "Block" = security rules, not actual injection
          const isInTableWithAction = /\|.*\|.*\|/i.test(ctx) &&
            /block|warn|deny|reject/i.test(ctx);
          // Table with security category descriptions (role_override, jailbreak, etc.)
          const isInSecurityTable = /\|.*\|\s*(?:role|override|jailbreak|exfil|privilege|social|fake|system|injection)\b/i.test(ctx);
          // Security sections, rules tables, bullet lists, headings in SKILL.md
          const isSkillSecuritySection = isSkillMd &&
            (/CRITICAL|block|defend|prevent|protect|guard|filter|attack|payload|evasion|trick|disguised|homoglyph|bypass|exfil/i.test(ctx) ||
             /^\s*-\s/.test(ctx) ||  // bullet list items
             /^\s*#/.test(ctx));     // headings
          // isDescribingThreat is ONLY allowed to suppress when we are inside documentation.
          // This prevents a real prompt-injection payload that happens to contain the word
          // "jailbreak" or "payload" from being auto-suppressed in executable code.
          const isDescribingThreatInDoc = isSecurityDocument &&
            (/injection|bypass|jailbreak|attack|payload|threat/i.test(ctx) ||
             /ThreatLevel\./i.test(ctx) ||
             /escalation|privilege/i.test(ctx) ||
             /detect|analyze|guard|scan|check/i.test(ctx));

          if (isSecurityDocument &&
              (isDocOrTest || isSkillMd || isInTableWithAction || isInSecurityTable || isSkillSecuritySection || isDescribingThreatInDoc)) {
            finding.weight = 0;
            finding.severity = 'info';
            finding.contextNote = (finding.contextNote || '') +
              ' [TRUSTED: prompt injection pattern in security documentation/reference/tests]';
            finding.suppressed = true;
            suppressedCount++;
          }
          // NOTE: For executable code inside trusted skills we still emit the PI finding.
          // A compromised internal skill that contains a real injection vector must not be silenced.
        }
        continue;
      }

      // Obfuscation: downgrade but don't fully suppress for internal skills.
      // Hex/base64 patterns in crypto/wallet tools are expected, but
      // actual code obfuscation (hiding intent) would still be concerning.
      if (finding.category === 'obfuscation') {
        if (report.trust?.trusted) {
          const isDocOrTest = isDocumentationOrTest(finding.file);
          // Crypto operations — randomBytes().toString('base64'/'hex') is standard, not obfuscation
          const isCryptoOperation = /randomBytes|crypto\.|createHash|createCipher|sign\(|verify\(/i.test(finding.context) ||
            /toString\s*\(\s*['"](?:base64|hex)['"]\s*\)/i.test(finding.context);
          if (isDocOrTest || isCryptoOperation) {
            finding.weight = 0;
            finding.severity = 'info';
            finding.contextNote = (finding.contextNote || '') +
              ' [TRUSTED: pattern in documentation/reference/detection-code]';
            finding.suppressed = true;
            suppressedCount++;
            continue;
          }
          // Downgrade only for trusted code that wasn't fully suppressed
          if (finding.severity === 'critical') {
            finding.severity = 'medium';
            finding.weight = Math.max(2, Math.floor(finding.weight * 0.25));
            finding.contextNote = (finding.contextNote || '') +
              ' [TRUSTED: downgraded — hex/base64 patterns expected in internal tools]';
            continue;
          }
        }
        // External skills: obfuscation stays at original severity
      }

      // Suppress expected-behavior findings for internal code
      if (INTERNAL_EXPECTED_CATEGORIES.has(finding.category)) {
        finding.weight = 0;
        finding.severity = 'info';
        finding.contextNote = (finding.contextNote || '') +
          ' [TRUSTED: expected behavior in internal skill]';
        finding.suppressed = true;
        suppressedCount++;
      }
    }

    // Suppress ALL behavioral signatures for trusted skills.
    // "Credential read + network send = exfiltration" is meaningless when
    // the skill legitimately needs API keys to call APIs.
    for (const sig of report.behavioralSignatures) {
      sig.suppressed = true;
      sig.note = 'Suppressed — internal/trusted skill (expected infrastructure behavior)';
    }

    // Also zero out behavioral compound findings
    for (const finding of report.findings) {
      if (finding.category === 'behavioral') {
        finding.weight = 0;
        finding.severity = 'info';
        finding.contextNote = (finding.contextNote || '') +
          ' [TRUSTED: behavioral signatures not applicable to internal skills]';
        finding.suppressed = true;
        suppressedCount++;
      }
    }

    report.trustSuppressedCount = suppressedCount;
  }

  /**
   * Detect compound behavioral signatures
   * These are patterns of activity that together indicate malicious intent
   */
  detectBehavioralSignatures(report) {
    const categories = new Set(report.findings.map(f => f.category));
    const ruleIds = new Set(report.findings.map(f => f.ruleId));

    // Signature: Data Exfiltration
    if ((categories.has('credential-theft') || ruleIds.has('CRED_ACCESS')) &&
        (categories.has('data-exfiltration') || ruleIds.has('NETWORK_EXFIL'))) {
      report.behavioralSignatures.push({
        name: 'DATA_EXFILTRATION',
        description: 'Credential access combined with network activity — classic exfiltration pattern',
        severity: 'critical',
        confidence: 'high',
      });
      // Add a compound finding with extra weight
      report.findings.push({
        ruleId: 'BEHAVIORAL_EXFIL',
        severity: 'critical',
        category: 'behavioral',
        title: '⚠️ BEHAVIORAL: Credential read + network send = data exfiltration signature',
        file: '(compound)',
        line: 0,
        match: '',
        context: 'Multiple files/patterns combine to form exfiltration behavior',
        weight: 30,
      });
    }

    // Signature: Trojan Skill
    if (ruleIds.has('PROMPT_INJECTION') && (categories.has('code-execution') || ruleIds.has('EXEC_CALL'))) {
      report.behavioralSignatures.push({
        name: 'TROJAN_SKILL',
        description: 'Prompt injection + code execution — skill injects instructions and executes code',
        severity: 'critical',
        confidence: 'high',
      });
    }

    // Signature: Evasive Malware
    if ((ruleIds.has('STRING_CONSTRUCTION') || ruleIds.has('ENCODED_STRING') ||
         ruleIds.has('FUNCTION_ALIAS') || ruleIds.has('DYNAMIC_IMPORT')) &&
        (categories.has('code-execution') || categories.has('credential-theft'))) {
      report.behavioralSignatures.push({
        name: 'EVASIVE_MALWARE',
        description: 'Code obfuscation/evasion + dangerous behavior — actively trying to hide malicious intent',
        severity: 'critical',
        confidence: 'high',
      });
      report.findings.push({
        ruleId: 'BEHAVIORAL_EVASIVE',
        severity: 'critical',
        category: 'behavioral',
        title: '⚠️ BEHAVIORAL: Evasion techniques + dangerous operations = evasive malware signature',
        file: '(compound)',
        line: 0,
        match: '',
        context: 'Skill uses obfuscation to hide dangerous behavior',
        weight: 35,
      });
    }

    // Signature: Persistent Backdoor
    if (categories.has('persistence') && (categories.has('code-execution') || categories.has('data-exfiltration'))) {
      report.behavioralSignatures.push({
        name: 'PERSISTENT_BACKDOOR',
        description: 'Persistence mechanism + code execution/exfiltration — establishes ongoing unauthorized access',
        severity: 'critical',
        confidence: 'high',
      });
    }
  }

  /**
   * Extract declared capabilities from metadata
   */
  extractDeclaredCapabilities(metadata) {
    const caps = { network: false, filesystem: false, exec: false, env: [] };
    if (!metadata) return caps;

    const ocMeta = metadata.metadata?.openclaw || metadata.openclaw;
    if (!ocMeta) return caps;

    const requires = ocMeta.requires || {};
    const bins = requires.bins || [];
    const env = requires.env || [];

    if (bins.includes('curl') || bins.includes('wget') || bins.includes('httpie')) {
      caps.network = true;
    }
    if (env.length > 0) caps.env = env;

    // Check description for network/filesystem hints
    const desc = (metadata.description || '').toLowerCase();
    if (desc.includes('api') || desc.includes('fetch') || desc.includes('http') || desc.includes('web')) {
      caps.network = true;
    }
    if (desc.includes('file') || desc.includes('read') || desc.includes('write') || desc.includes('save')) {
      caps.filesystem = true;
    }

    return caps;
  }

  // === Existing methods (kept from v0.1) ===

  parseSkillMetadata(content) {
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) return null;
    const meta = {};
    const lines = fmMatch[1].split('\n');
    for (const line of lines) {
      const kv = line.match(/^(\w+):\s*(.+)/);
      if (kv) {
        try { meta[kv[1]] = JSON.parse(kv[2]); }
        catch { meta[kv[1]] = kv[2].trim(); }
      }
    }
    return meta;
  }

  checkFileStructure(files, report) {
    for (const f of files) {
      const name = basename(f.relativePath);
      if (name.startsWith('.') && !['gitignore', '.env.example', '.eslintrc', '.prettierrc'].some(n => name === n || name === '.' + n)) {
        report.findings.push({
          ruleId: 'HIDDEN_FILE', severity: 'medium', category: 'suspicious-file',
          title: 'Hidden file detected', file: f.relativePath, line: 0,
          context: `Hidden file: ${f.relativePath}`, weight: 10,
        });
      }
    }

    for (const f of files) {
      if (f.size > 512000) {
        report.findings.push({
          ruleId: 'LARGE_FILE', severity: 'medium', category: 'suspicious-file',
          title: 'Unusually large file for a skill package', file: f.relativePath, line: 0,
          context: `${f.relativePath}: ${(f.size / 1024).toFixed(0)}KB`, weight: 5,
        });
      }
    }

    const hasBundledDeps = files.some(f =>
      f.relativePath.includes('node_modules/') || f.relativePath.includes('__pycache__/')
    );
    if (hasBundledDeps) {
      report.flags.push('BUNDLED_DEPS');
      report.findings.push({
        ruleId: 'BUNDLED_DEPS', severity: 'high', category: 'suspicious-file',
        title: 'Bundled dependency directory — could hide malicious packages',
        file: '(directory)', line: 0,
        context: 'Skill bundles node_modules or __pycache__', weight: 15,
      });
    }
  }

  async walkDirectory(dirPath, base = dirPath) {
    const results = [];
    let entries;
    try { entries = await readdir(dirPath, { withFileTypes: true }); }
    catch { return results; }

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      const relativePath = fullPath.slice(base.length + 1);

      if (entry.isDirectory()) {
        if (['node_modules', '.git', '__pycache__', 'venv', '.venv'].includes(entry.name)) {
          results.push({ relativePath, absolutePath: fullPath, size: 0, type: 'directory-skipped' });
          continue;
        }
        results.push(...await this.walkDirectory(fullPath, base));
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        const stats = await stat(fullPath);
        let type = 'other';
        if (CODE_EXTENSIONS.has(ext)) type = 'code';
        else if (TEXT_EXTENSIONS.has(ext)) type = 'text';
        else if (BINARY_EXTENSIONS.has(ext)) type = 'binary';
        results.push({ relativePath, absolutePath: fullPath, size: stats.size, type });
      }
    }
    return results;
  }

  /**
   * Aggregate repeated findings — same rule in same file should count as one finding
   * with slightly increased weight, not N separate penalties
   */
  /**
   * Re-check behavioral suppression after aggregation
   */
  recheckBehavioralSuppression(report) {
    const credFindings = report.findings
      .filter(f => (f.category === 'credential-theft' || f.ruleId === 'CRED_ACCESS') && f.weight > 0);
    const netFindings = report.findings
      .filter(f => (f.category === 'data-exfiltration' || f.ruleId === 'NETWORK_EXFIL') && f.weight > 0);

    const allCredOk = credFindings.length === 0 || credFindings.every(f =>
      f.severity === 'info' || (f.contextNote || '').includes('declared') ||
      (f.contextNote || '').includes('standard code') || (f.contextNote || '').includes('expected'));
    const allNetOk = netFindings.length === 0 || netFindings.every(f =>
      f.severity === 'info' || f.severity === 'low' ||
      (f.contextNote || '').includes('Declared') || (f.contextNote || '').includes('Known-good') ||
      (f.contextNote || '').includes('API skill'));

    if (allCredOk && allNetOk) {
      for (const f of report.findings) {
        if (f.category === 'behavioral' && f.weight > 0) {
          f.weight = Math.max(1, Math.floor(f.weight * 0.1));
          f.contextNote = 'Suppressed — all access is declared/known-good';
          f.severity = 'info';
        }
      }
      for (const sig of report.behavioralSignatures) {
        sig.suppressed = true;
      }
    }
  }

  aggregateFindings(report) {
    const groups = new Map();
    for (const finding of report.findings) {
      const key = `${finding.ruleId}:${finding.file}`;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key).push(finding);
    }

    const aggregated = [];
    for (const [key, findings] of groups) {
      if (findings.length <= 2) {
        // 1-2 findings: keep as-is
        aggregated.push(...findings);
      } else {
        // 3+ findings of same rule in same file: keep first, mark rest as info weight 0
        // Add a small per-occurrence bonus to the first (cap at 2x)
        const primary = findings[0];
        const bonus = Math.min(primary.weight, Math.floor(findings.length * 1.5));
        primary.weight = primary.weight + bonus;
        primary.contextNote = (primary.contextNote || '') + ` (${findings.length} occurrences)`;
        aggregated.push(primary);
        
        // Keep others for the report but zero their weight
        for (let i = 1; i < findings.length; i++) {
          findings[i].weight = 0;
          findings[i].severity = 'info';
          findings[i].contextNote = '(aggregated — counted in primary finding)';
          aggregated.push(findings[i]);
        }
      }
    }
    report.findings = aggregated;
  }

  deduplicateFindings(findings) {
    const seen = new Set();
    return findings.filter(f => {
      const key = `${f.ruleId}:${f.file}:${f.line}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  calculateScore(report) {
    let deductions = 0;
    for (const finding of report.findings) {
      deductions += finding.weight;
      if (report.summary[finding.severity] !== undefined) {
        report.summary[finding.severity]++;
      }
    }
    if (report.flags.includes('NO_SKILL_MD')) deductions += 10;
    if (report.flags.includes('BUNDLED_DEPS')) deductions += 5;

    // Behavioral signatures add extra penalty (unless suppressed by context)
    for (const sig of report.behavioralSignatures) {
      if (sig.suppressed) continue;
      if (sig.severity === 'critical') deductions += 15;
      else if (sig.severity === 'high') deductions += 10;
    }

    report.score = Math.max(0, 100 - deductions);
    if (report.score >= 80) report.risk = 'LOW';
    else if (report.score >= 50) report.risk = 'MEDIUM';
    else if (report.score >= 20) report.risk = 'HIGH';
    else report.risk = 'CRITICAL';
  }

  async readFileSafe(filePath) {
    try { return await readFile(filePath, 'utf-8'); }
    catch { return null; }
  }
}
