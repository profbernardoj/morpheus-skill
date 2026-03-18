"""
DEPRECATED: Use 'prompt_guard' instead of 'scripts'.

This module exists for backward compatibility only and will be removed in v4.0.
"""

import warnings
warnings.warn(
    "Import from 'prompt_guard' instead of 'scripts'. "
    "The 'scripts' package is deprecated and will be removed in v4.0.",
    DeprecationWarning,
    stacklevel=2,
)

from prompt_guard import (
    PromptGuard,
    Severity,
    Action,
    DetectionResult,
    SanitizeResult,
    __version__,
)

__all__ = [
    "PromptGuard",
    "Severity",
    "Action",
    "DetectionResult",
    "SanitizeResult",
    "__version__",
]
