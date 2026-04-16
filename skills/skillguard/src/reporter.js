/**
 * SkillGuard Reporter — Formats audit reports
 */

const SEVERITY_ICONS = {
  critical: '🔴',
  high: '🟠',
  medium: '🟡',
  low: '🔵',
  info: 'ℹ️',
};

const RISK_ICONS = {
  LOW: '✅',
  MEDIUM: '⚠️',
  HIGH: '🟠',
  CRITICAL: '🔴',
};

/**
 * Generate human-readable text report
 */
export function formatTextReport(report) {
  const lines = [];

  lines.push('═══════════════════════════════════════════');
  lines.push(`  SkillGuard Security Audit Report`);
  lines.push('═══════════════════════════════════════════');
  lines.push('');
  lines.push(`  Path:     ${report.path}`);
  lines.push(`  Scanned:  ${report.scannedAt}`);
  lines.push(`  Files:    ${report.files.length}`);
  if (report.trust) {
    const trustIcon = report.trust.trusted ? '🏠' : '🌐';
    const trustLabel = report.trust.trusted ? 'INTERNAL (trusted)' : 'EXTERNAL';
    lines.push(`  Trust:    ${trustIcon} ${trustLabel}`);
    if (report.trust.trusted && report.trustSuppressedCount > 0) {
      lines.push(`  Note:     ${report.trustSuppressedCount} expected-behavior findings suppressed (internal skill)`);
    }
  }
  lines.push(`  Score:    ${report.score}/100 ${RISK_ICONS[report.risk]} ${report.risk} RISK`);
  lines.push('');

  // Summary bar
  const parts = [];
  if (report.summary.critical > 0) parts.push(`${SEVERITY_ICONS.critical} ${report.summary.critical} critical`);
  if (report.summary.high > 0) parts.push(`${SEVERITY_ICONS.high} ${report.summary.high} high`);
  if (report.summary.medium > 0) parts.push(`${SEVERITY_ICONS.medium} ${report.summary.medium} medium`);
  if (report.summary.low > 0) parts.push(`${SEVERITY_ICONS.low} ${report.summary.low} low`);
  if (parts.length === 0) parts.push('✅ No issues found');
  lines.push(`  Findings: ${parts.join(' | ')}`);
  lines.push('');

  // Flags
  if (report.flags.length > 0) {
    lines.push('  Flags:');
    for (const flag of report.flags) {
      lines.push(`    ⚑ ${flag}`);
    }
    lines.push('');
  }

  // Metadata
  if (report.metadata) {
    lines.push('  Skill Metadata:');
    for (const [key, val] of Object.entries(report.metadata)) {
      const display = typeof val === 'object' ? JSON.stringify(val) : val;
      lines.push(`    ${key}: ${display}`);
    }
    lines.push('');
  }

  // Findings grouped by severity
  if (report.findings.length > 0) {
    lines.push('───────────────────────────────────────────');
    lines.push('  FINDINGS');
    lines.push('───────────────────────────────────────────');
    lines.push('');

    const bySeverity = groupBy(report.findings, 'severity');
    for (const severity of ['critical', 'high', 'medium', 'low', 'info']) {
      const group = bySeverity[severity];
      if (!group || group.length === 0) continue;

      lines.push(`  ${SEVERITY_ICONS[severity]} ${severity.toUpperCase()} (${group.length})`);
      lines.push('');

      // Group findings by rule within severity
      const byRule = groupBy(group, 'ruleId');
      for (const [ruleId, findings] of Object.entries(byRule)) {
        lines.push(`    [${ruleId}] ${findings[0].title}`);

        // Show up to 5 locations per rule
        const shown = findings.slice(0, 5);
        for (const f of shown) {
          lines.push(`      → ${f.file}:${f.line}  ${f.context.slice(0, 100)}`);
        }
        if (findings.length > 5) {
          lines.push(`      ... and ${findings.length - 5} more`);
        }
        lines.push('');
      }
    }
  }

  // Verdict
  lines.push('───────────────────────────────────────────');
  lines.push(`  VERDICT: ${getVerdict(report)}`);
  lines.push('───────────────────────────────────────────');
  lines.push('');

  return lines.join('\n');
}

/**
 * Generate compact Telegram/chat-friendly report
 */
export function formatCompactReport(report, skillName = null) {
  const name = skillName || report.metadata?.name || report.path.split('/').pop();
  const lines = [];

  lines.push(`🛡️ **SkillGuard Audit: ${name}**`);
  if (report.trust?.trusted) {
    lines.push(`🏠 Internal skill (trusted) | Score: **${report.score}/100** ${RISK_ICONS[report.risk]}`);
  } else {
    lines.push(`Score: **${report.score}/100** ${RISK_ICONS[report.risk]}`);
  }
  lines.push('');

  if (report.findings.length === 0) {
    lines.push('✅ Clean — no issues detected.');
    return lines.join('\n');
  }

  // Compact findings by category
  const byCategory = groupBy(report.findings, 'category');
  for (const [category, findings] of Object.entries(byCategory)) {
    const worst = findings.reduce((a, b) =>
      severityRank(a.severity) > severityRank(b.severity) ? a : b
    );
    lines.push(`${SEVERITY_ICONS[worst.severity]} **${category}**: ${findings.length} finding(s)`);

    // Show top 3 unique matches
    const unique = [...new Set(findings.map(f => f.match))].slice(0, 3);
    for (const m of unique) {
      lines.push(`  \`${m}\``);
    }
  }

  lines.push('');
  lines.push(`Verdict: ${getVerdict(report)}`);

  return lines.join('\n');
}

/**
 * Generate Moltbook post format
 */
export function formatMoltbookPost(report, skillName) {
  const name = skillName || report.metadata?.name || 'Unknown Skill';
  const lines = [];

  lines.push(`🛡️ SkillGuard Audit: ${name}`);
  lines.push(`Score: ${report.score}/100 | Risk: ${report.risk}`);
  lines.push('');

  if (report.summary.critical > 0) {
    lines.push(`⚠️ CRITICAL ISSUES FOUND (${report.summary.critical})`);
    const criticals = report.findings.filter(f => f.severity === 'critical');
    for (const f of criticals.slice(0, 5)) {
      lines.push(`- [${f.ruleId}] ${f.title} @ ${f.file}:${f.line}`);
    }
    lines.push('');
  }

  if (report.summary.high > 0) {
    lines.push(`🟠 High severity: ${report.summary.high} finding(s)`);
  }
  if (report.summary.medium > 0) {
    lines.push(`🟡 Medium severity: ${report.summary.medium} finding(s)`);
  }

  lines.push('');
  lines.push(`Verdict: ${getVerdict(report)}`);
  lines.push('');
  lines.push('---');
  lines.push('Scanned by SkillGuard v0.1.0 | @kai_claw');

  return lines.join('\n');
}

function getVerdict(report) {
  if (report.score >= 80) return '✅ PASS — Low risk, appears safe to install.';
  if (report.score >= 50) return '⚠️ CAUTION — Review findings before installing.';
  if (report.score >= 20) return '🟠 WARNING — Significant security concerns detected.';
  return '🔴 FAIL — Critical security issues. Do NOT install without thorough manual review.';
}

function severityRank(sev) {
  return { critical: 4, high: 3, medium: 2, low: 1, info: 0 }[sev] || 0;
}

function groupBy(arr, key) {
  return arr.reduce((acc, item) => {
    (acc[item[key]] = acc[item[key]] || []).push(item);
    return acc;
  }, {});
}
