"""
Prompt Guard - Data models (enums and dataclasses).
"""

from dataclasses import dataclass, field, asdict
from typing import Optional, Dict, List
from enum import Enum


class Severity(Enum):
    SAFE = 0
    LOW = 1
    MEDIUM = 2
    HIGH = 3
    CRITICAL = 4


class Action(Enum):
    ALLOW = "allow"
    LOG = "log"
    WARN = "warn"
    BLOCK = "block"
    BLOCK_NOTIFY = "block_notify"


@dataclass
class SanitizeResult:
    """Result of sanitize_output() -- enterprise DLP style."""
    sanitized_text: str           # Redacted response text (safe to show)
    was_modified: bool            # True if any redaction occurred
    redaction_count: int          # Number of patterns redacted
    redacted_types: List[str]     # Types of credentials redacted
    blocked: bool                 # True if response should be fully blocked
    detection: "DetectionResult"  # Underlying scan_output result

    def to_dict(self) -> Dict:
        return {
            "sanitized_text": self.sanitized_text,
            "was_modified": self.was_modified,
            "redaction_count": self.redaction_count,
            "redacted_types": self.redacted_types,
            "blocked": self.blocked,
            "detection": self.detection.to_dict(),
        }


@dataclass
class DetectionResult:
    severity: Severity
    action: Action
    reasons: List[str]
    patterns_matched: List[str]
    normalized_text: Optional[str]
    base64_findings: List[Dict]
    recommendations: List[str]
    fingerprint: str  # Hash for deduplication
    scan_type: str = "input"  # "input" or "output"
    decoded_findings: List[Dict] = field(default_factory=list)
    canary_matches: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict:
        d = asdict(self)
        d["severity"] = self.severity.name
        d["action"] = self.action.value
        return d
