"""
Prompt Guard - CLI entry point.
"""

import sys
import json


def main():
    """CLI entry point."""
    import argparse

    parser = argparse.ArgumentParser(description="Prompt Guard - Injection Detection")
    parser.add_argument("message", nargs="?", help="Message to analyze")
    parser.add_argument("--json", action="store_true", help="Output as JSON")
    parser.add_argument("--context", type=str, help="Context as JSON string")
    parser.add_argument("--config", type=str, help="Path to config YAML")
    parser.add_argument(
        "--sensitivity",
        choices=["low", "medium", "high", "paranoid"],
        default="medium",
        help="Detection sensitivity",
    )

    args = parser.parse_args()

    if not args.message:
        # Read from stdin
        args.message = sys.stdin.read().strip()

    if not args.message:
        parser.print_help()
        sys.exit(1)

    config = {"sensitivity": args.sensitivity}
    if args.config:
        try:
            import yaml
        except ImportError:
            print(
                "Error: PyYAML required for config files. Install with: pip install pyyaml",
                file=sys.stderr,
            )
            sys.exit(1)
        with open(args.config) as f:
            file_config = yaml.safe_load(f) or {}
            file_config = file_config.get("prompt_guard", file_config)
            config.update(file_config)

    # Parse context
    context = {}
    if args.context:
        context = json.loads(args.context)

    # Analyze
    from prompt_guard.engine import PromptGuard

    guard = PromptGuard(config)
    result = guard.analyze(args.message, context)

    if args.json:
        print(json.dumps(result.to_dict(), indent=2, ensure_ascii=False))
    else:
        emoji = {
            "SAFE": "\u2705",
            "LOW": "\U0001f4dd",
            "MEDIUM": "\u26a0\ufe0f",
            "HIGH": "\U0001f534",
            "CRITICAL": "\U0001f6a8",
        }
        print(f"{emoji.get(result.severity.name, '\u2753')} {result.severity.name}")
        print(f"Action: {result.action.value}")
        if result.reasons:
            print(f"Reasons: {', '.join(result.reasons)}")
        if result.patterns_matched:
            print(f"Patterns: {len(result.patterns_matched)} matched")
        if result.normalized_text:
            print(f"\u26a0\ufe0f Homoglyphs detected, normalized text differs")
        if result.base64_findings:
            print(f"\u26a0\ufe0f Suspicious base64: {len(result.base64_findings)} found")
        if result.recommendations:
            print(f"\U0001f4a1 {'; '.join(result.recommendations)}")


if __name__ == "__main__":
    main()
