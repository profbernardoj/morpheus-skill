#!/usr/bin/env python3
"""
mempalace_bridge.py — JSON bridge for Node.js <-> MemPalace SDK

Wraps the real MemPalace Python API and returns JSON to stdout.
Called by EverClaw's mempalace-backend.mjs via spawn() with safe args.

Commands:
    python3 mempalace_bridge.py search <query> [--wing X] [--room Y] [--results N]
    python3 mempalace_bridge.py mine <dir> [--mode projects|convos] [--wing X] [--dry-run]
    python3 mempalace_bridge.py wake-up [--wing X]
    python3 mempalace_bridge.py status
    python3 mempalace_bridge.py init <dir>
    python3 mempalace_bridge.py as-of <entity> [--date YYYY-MM-DD] [--direction outgoing|incoming|both]
    python3 mempalace_bridge.py export [--wing X] [--format json|markdown]

All output is JSON to stdout. Errors: {"success": false, "error": "..."}.

Compatibility: MemPalace SDK v3.0.0 (April 2026).
SDK stdout suppression: The SDK prints human-readable output to stdout during
init, mine, wake-up, and status. We redirect sys.stdout to io.StringIO during
these calls to preserve the JSON contract.
"""

import argparse
import json
import os
import sys


def cmd_search(args):
    """Search using the real search_memories() API."""
    from mempalace.searcher import search_memories
    from mempalace.config import MempalaceConfig

    palace_path = args.palace or MempalaceConfig().palace_path
    result = search_memories(
        query=args.query,
        palace_path=palace_path,
        wing=args.wing,
        room=args.room,
        n_results=args.results,
    )

    if "error" in result:
        return {"success": False, "error": result["error"], "hint": result.get("hint", "")}

    return {
        "success": True,
        "query": result.get("query", args.query),
        "filters": result.get("filters", {}),
        "results": [
            {
                "id": f"hit-{i}",
                "content": hit["text"],
                "score": hit.get("similarity", 0),
                "metadata": {
                    "wing": hit.get("wing", "unknown"),
                    "room": hit.get("room", "unknown"),
                    "source_file": hit.get("source_file", ""),
                },
            }
            for i, hit in enumerate(result.get("results", []))
        ],
    }


def cmd_mine(args):
    """Mine a directory using the real miner/convo_miner.
    
    Suppresses stdout from SDK (prints human-readable progress) so only JSON goes to stdout.
    """
    import io
    from mempalace.config import MempalaceConfig

    palace_path = args.palace or MempalaceConfig().palace_path
    old_stdout = sys.stdout
    capture = io.StringIO()

    try:
        sys.stdout = capture

        if args.mode == "convos":
            from mempalace.convo_miner import mine_convos

            mine_convos(
                convo_dir=args.dir,
                palace_path=palace_path,
                wing=args.wing,
                agent=args.agent or "everclaw",
                limit=args.limit or 0,
                dry_run=args.dry_run,
                extract_mode=args.extract or "exchange",
            )
        else:
            from mempalace.miner import mine
            import inspect

            # Build kwargs based on what the installed version accepts
            mine_sig = inspect.signature(mine)
            mine_kwargs = {
                "project_dir": args.dir,
                "palace_path": palace_path,
                "wing_override": args.wing,
                "agent": args.agent or "everclaw",
                "limit": args.limit or 0,
                "dry_run": args.dry_run,
            }
            # respect_gitignore added in later versions
            if "respect_gitignore" in mine_sig.parameters:
                mine_kwargs["respect_gitignore"] = True

            mine(**mine_kwargs)

        sys.stdout = old_stdout
        sdk_out = capture.getvalue()

        # Parse drawer count from SDK output if available
        drawer_count = 0
        for line in sdk_out.split("\n"):
            if "Drawers filed:" in line:
                try:
                    drawer_count = int(line.strip().split(":")[1].strip())
                except (ValueError, IndexError):
                    pass

        return {
            "success": True,
            "message": f"Mined {args.dir} (mode={args.mode})",
            "dry_run": args.dry_run,
            "drawers": drawer_count,
        }
    except Exception as e:
        sys.stdout = old_stdout
        return {"success": False, "error": str(e)}


def cmd_wakeup(args):
    """Wake-up context using the real MemoryStack (L0 + L1).
    
    MemoryStack.wake_up() returns a string but may also print warnings.
    """
    import io
    from mempalace.layers import MemoryStack
    from mempalace.config import MempalaceConfig

    palace_path = args.palace or MempalaceConfig().palace_path
    old_stdout = sys.stdout

    try:
        sys.stdout = io.StringIO()  # Suppress any SDK prints
        stack = MemoryStack(palace_path=palace_path)
        text = stack.wake_up(wing=args.wing)
        sys.stdout = old_stdout

        tokens = len(text) // 4
        return {"success": True, "context": text, "tokens": tokens}
    except Exception as e:
        sys.stdout = old_stdout
        return {"success": False, "error": str(e)}


def cmd_status(args):
    """Status via direct ChromaDB access (structured JSON).
    
    Uses chromadb directly (not SDK) to avoid stdout pollution from SDK status().
    """
    import chromadb
    from mempalace.config import MempalaceConfig

    palace_path = args.palace or MempalaceConfig().palace_path

    try:
        client = chromadb.PersistentClient(path=palace_path)
        col = client.get_collection("mempalace_drawers")
        total = col.count()

        # Get wing statistics
        wings = {}
        batch_size = 500
        offset = 0
        while offset < total:
            batch = col.get(limit=batch_size, offset=offset, include=["metadatas"])
            for meta in batch.get("metadatas", []):
                wing = meta.get("wing", "unknown")
                wings[wing] = wings.get(wing, 0) + 1
            offset += batch_size
            if len(batch.get("metadatas", [])) < batch_size:
                break

        # Check for KG
        kg_path = os.path.expanduser("~/.mempalace/knowledge_graph.sqlite3")
        kg_exists = os.path.exists(kg_path)

        return {
            "success": True,
            "healthy": True,
            "fact_count": total,
            "wings": wings,
            "palace_path": palace_path,
            "kg_exists": kg_exists,
            "last_updated": None,
        }
    except Exception as e:
        return {
            "success": False,
            "healthy": False,
            "fact_count": 0,
            "wings": {},
            "error": str(e),
        }


def cmd_init(args):
    """Initialize a new palace from a directory.
    
    Suppresses stdout from MemPalace SDK (which prints human-readable output)
    so only our JSON goes to stdout.
    """
    import io
    old_stdout = sys.stdout
    old_stdin = sys.stdin
    capture = io.StringIO()
    
    try:
        from mempalace.entity_detector import (
            scan_for_detection,
            detect_entities,
            confirm_entities,
        )
        from mempalace.room_detector_local import detect_rooms_local
        from mempalace.config import MempalaceConfig

        # SDK v3.0.0 stdout suppression: SDK prints human-readable progress
        # to stdout which corrupts our JSON contract. Redirect to capture.
        # Generous stdin buffer for any interactive prompts (auto-accept).
        sys.stdout = capture
        sys.stdin = io.StringIO("y\n" * 500)

        files = scan_for_detection(args.dir)
        entities_found = 0
        if files:
            detected = detect_entities(files)
            entities_found = (
                len(detected.get("people", []))
                + len(detected.get("projects", []))
                + len(detected.get("uncertain", []))
            )
            if entities_found > 0:
                confirm_entities(detected, yes=True)

        # detect_rooms_local may prompt or fail on some SDK versions;
        # wrap separately so entity detection still succeeds if room
        # detection has issues.
        try:
            detect_rooms_local(project_dir=args.dir)
        except Exception as room_err:
            capture.write(f"\nRoom detection warning: {room_err}\n")

        try:
            MempalaceConfig().init()
        except Exception as config_err:
            capture.write(f"\nConfig init warning: {config_err}\n")

        # Restore stdout/stdin before returning JSON
        sys.stdout = old_stdout
        sys.stdin = old_stdin

        return {
            "success": True,
            "message": f"Initialized palace from {args.dir}",
            "entities_found": entities_found,
            "sdk_output": capture.getvalue()[:2000],  # Truncated SDK output for debug
        }
    except Exception as e:
        sys.stdout = old_stdout
        sys.stdin = old_stdin
        return {"success": False, "error": str(e), "sdk_output": capture.getvalue()[:2000]}


def cmd_as_of(args):
    """Temporal KG query using the real KnowledgeGraph.query_entity()."""
    from mempalace.knowledge_graph import KnowledgeGraph

    kg_path = args.kg_path or os.path.expanduser(
        "~/.mempalace/knowledge_graph.sqlite3"
    )

    if not os.path.exists(kg_path):
        return {
            "success": False,
            "error": f"Knowledge graph not found at {kg_path}",
            "hint": "Mine data first. KG is populated during mining.",
        }

    try:
        kg = KnowledgeGraph(db_path=kg_path)
        results = kg.query_entity(
            name=args.entity,
            as_of=args.date,
            direction=args.direction or "both",
        )

        return {
            "success": True,
            "entity": args.entity,
            "as_of": args.date,
            "direction": args.direction or "both",
            "results": results,
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


def cmd_export(args):
    """Export palace contents as JSON or Markdown."""
    import chromadb
    from mempalace.config import MempalaceConfig
    from pathlib import Path

    palace_path = args.palace or MempalaceConfig().palace_path
    fmt = args.format or "json"

    try:
        client = chromadb.PersistentClient(path=palace_path)
        col = client.get_collection("mempalace_drawers")

        # Fetch all drawers in batches
        docs, metas, ids = [], [], []
        batch_size = 500
        offset = 0
        while True:
            kwargs = {
                "include": ["documents", "metadatas"],
                "limit": batch_size,
                "offset": offset,
            }
            if args.wing:
                kwargs["where"] = {"wing": args.wing}
            batch = col.get(**kwargs)
            batch_docs = batch.get("documents", [])
            if not batch_docs:
                break
            docs.extend(batch_docs)
            metas.extend(batch.get("metadatas", []))
            ids.extend(batch.get("ids", []))
            offset += len(batch_docs)
            if len(batch_docs) < batch_size:
                break

        if fmt == "json":
            facts = []
            for doc_id, doc, meta in zip(ids, docs, metas):
                facts.append(
                    {
                        "id": doc_id,
                        "content": doc,
                        "wing": meta.get("wing", "unknown"),
                        "room": meta.get("room", "unknown"),
                        "source_file": Path(meta.get("source_file", "")).name,
                        "metadata": meta,
                    }
                )
            return {
                "success": True,
                "format": "json",
                "count": len(facts),
                "facts": facts,
            }

        elif fmt == "markdown":
            # Group by wing/room for Obsidian-compatible structure
            by_wing = {}
            for doc_id, doc, meta in zip(ids, docs, metas):
                wing = meta.get("wing", "unknown")
                room = meta.get("room", "unknown")
                if wing not in by_wing:
                    by_wing[wing] = {}
                if room not in by_wing[wing]:
                    by_wing[wing][room] = []
                by_wing[wing][room].append(
                    {
                        "id": doc_id,
                        "content": doc,
                        "source": Path(meta.get("source_file", "")).name,
                    }
                )

            lines = ["# MemPalace Export", ""]
            for wing, rooms in sorted(by_wing.items()):
                lines.append(f"## Wing: {wing}")
                lines.append("")
                for room, entries in sorted(rooms.items()):
                    lines.append(f"### Room: {room}")
                    lines.append("")
                    for entry in entries:
                        lines.append(f"#### {entry['id']}")
                        if entry["source"]:
                            lines.append(f"_Source: {entry['source']}_")
                        lines.append("")
                        lines.append(entry["content"])
                        lines.append("")
                        lines.append("---")
                        lines.append("")

            return {
                "success": True,
                "format": "markdown",
                "count": len(docs),
                "markdown": "\n".join(lines),
            }

        else:
            return {"success": False, "error": f"Unknown format: {fmt}"}

    except Exception as e:
        return {"success": False, "error": str(e)}


def main():
    parser = argparse.ArgumentParser(
        description="MemPalace JSON Bridge for EverClaw"
    )
    parser.add_argument("--palace", default=None, help="Palace path override")
    sub = parser.add_subparsers(dest="command")

    # search
    p = sub.add_parser("search")
    p.add_argument("query")
    p.add_argument("--wing", default=None)
    p.add_argument("--room", default=None)
    p.add_argument("--results", type=int, default=5)

    # mine
    p = sub.add_parser("mine")
    p.add_argument("dir")
    p.add_argument("--mode", choices=["projects", "convos"], default="projects")
    p.add_argument("--wing", default=None)
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--limit", type=int, default=0)
    p.add_argument("--agent", default="everclaw")
    p.add_argument("--extract", choices=["exchange", "general"], default="exchange")

    # wake-up
    p = sub.add_parser("wake-up")
    p.add_argument("--wing", default=None)

    # status
    sub.add_parser("status")

    # init
    p = sub.add_parser("init")
    p.add_argument("dir")

    # as-of (temporal KG)
    p = sub.add_parser("as-of")
    p.add_argument("entity")
    p.add_argument("--date", default=None)
    p.add_argument(
        "--direction",
        choices=["outgoing", "incoming", "both"],
        default="both",
    )
    p.add_argument("--kg-path", default=None)

    # export
    p = sub.add_parser("export")
    p.add_argument("--wing", default=None)
    p.add_argument("--format", choices=["json", "markdown"], default="json")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    dispatch = {
        "search": cmd_search,
        "mine": cmd_mine,
        "wake-up": cmd_wakeup,
        "status": cmd_status,
        "init": cmd_init,
        "as-of": cmd_as_of,
        "export": cmd_export,
    }

    try:
        result = dispatch[args.command](args)
    except ImportError as e:
        result = {
            "success": False,
            "error": f"MemPalace not installed: {e}",
            "hint": "pip install mempalace",
        }
    except Exception as e:
        result = {"success": False, "error": str(e)}

    print(json.dumps(result))


if __name__ == "__main__":
    main()
