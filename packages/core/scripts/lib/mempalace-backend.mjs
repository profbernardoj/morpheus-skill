/**
 * MemPalaceBackend - Memory backend using MemPalace Python SDK
 * 
 * Calls scripts/python/mempalace_bridge.py via spawn() for safe,
 * structured JSON communication with the real MemPalace SDK.
 * 
 * @module mempalace-backend
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { MemoryBackend } from './memory-backend.mjs';
import { callPythonBridge } from './bridge-call.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BRIDGE_SCRIPT = join(__dirname, '..', 'python', 'mempalace_bridge.py');

// Default paths match MemPalace defaults (~/.mempalace/)
const DEFAULT_PALACE_PATH = join(
  process.env.HOME || '/tmp', '.mempalace', 'palace'
);
const DEFAULT_KG_PATH = join(
  process.env.HOME || '/tmp', '.mempalace', 'knowledge_graph.sqlite3'
);

export class MemPalaceBackend extends MemoryBackend {
  constructor(config = {}) {
    super(config);
    this.name = 'MemPalaceBackend';
    this.palacePath = config.palacePath || DEFAULT_PALACE_PATH;
    this.kgPath = config.kgPath || DEFAULT_KG_PATH;
    this.wing = config.wing || null; // null = all wings (MemPalace default)
    this.pythonPath = config.pythonPath || 'python3';
    this.timeout = config.timeout || 300_000; // 5 min default (mining can be slow)
  }

  /**
   * Search using search_memories() — returns structured results
   * with similarity scores from ChromaDB.
   *
   * Real SDK: search_memories(query, palace_path, wing, room, n_results)
   * Returns: {query, filters, results: [{text, wing, room, source_file, similarity}]}
   */
  async search(query, options = {}) {
    const args = ['search', query];
    if (options.wing || this.wing) {
      args.push('--wing', options.wing || this.wing);
    }
    if (options.room) args.push('--room', options.room);
    if (options.limit) args.push('--results', String(options.limit));

    const result = await this._callBridge(args);
    return result.results || [];
  }

  /**
   * Mine a directory — calls real miner or convo_miner.
   *
   * Real CLI flags:
   *   --mode {projects,convos}  --wing X  --dry-run
   *   --limit N  --agent NAME  --extract {exchange,general}
   */
  async mine(sourceDir, options = {}) {
    const args = ['mine', sourceDir];
    if (options.mode) args.push('--mode', options.mode);
    if (options.wing || this.wing) {
      args.push('--wing', options.wing || this.wing);
    }
    if (options.dryRun) args.push('--dry-run');
    if (options.limit) args.push('--limit', String(options.limit));
    if (options.agent) args.push('--agent', options.agent);
    if (options.extract) args.push('--extract', options.extract);

    return this._callBridge(args);
  }

  /**
   * Wake-up context — L0 identity + L1 essential story.
   * MemPalace controls token budget internally (~600-900 tokens).
   *
   * Real SDK: MemoryStack(palace_path).wake_up(wing=X)
   */
  async wakeUp(options = {}) {
    const args = ['wake-up'];
    if (options.wing || this.wing) {
      args.push('--wing', options.wing || this.wing);
    }

    const result = await this._callBridge(args);
    return result.context || '';
  }

  /**
   * Status — direct ChromaDB stats via bridge.
   * Returns wing counts, palace path, KG existence.
   */
  async status() {
    const result = await this._callBridge(['status']);

    return {
      backend: 'MemPalace',
      healthy: result.healthy || false,
      factCount: result.fact_count || 0,
      wings: result.wings || {},
      lastUpdated: result.last_updated || null,
      palacePath: result.palace_path || this.palacePath,
      kgExists: result.kg_exists || false
    };
  }

  /**
   * Initialize palace from a directory.
   * Runs entity detection + room detection + config init.
   */
  async init(sourceDir) {
    return this._callBridge(['init', sourceDir]);
  }

  /**
   * Temporal KG query — uses KnowledgeGraph.query_entity().
   *
   * Real SDK: KnowledgeGraph(db_path).query_entity(name, as_of=date, direction=dir)
   * Returns: [{direction, subject, predicate, object, valid_from, valid_to, confidence, current}]
   *
   * NOTE: This is Python SDK only — no CLI equivalent exists yet.
   */
  async asOf(entityName, options = {}) {
    const args = ['as-of', entityName];
    if (options.date) args.push('--date', options.date);
    if (options.direction) args.push('--direction', options.direction);
    if (this.kgPath !== DEFAULT_KG_PATH) {
      args.push('--kg-path', this.kgPath);
    }

    const result = await this._callBridge(args);
    return result.results || [];
  }

  /**
   * Export as JSON — direct ChromaDB batch read via bridge.
   */
  async exportJSON(options = {}) {
    const args = ['export', '--format', 'json'];
    if (options.wing || this.wing) {
      args.push('--wing', options.wing || this.wing);
    }

    return this._callBridge(args);
  }

  /**
   * Export as Markdown — Obsidian-compatible wing/room structure.
   * Groups drawers by wing → room with headers.
   */
  async exportMarkdown(options = {}) {
    const args = ['export', '--format', 'markdown'];
    if (options.wing || this.wing) {
      args.push('--wing', options.wing || this.wing);
    }

    const result = await this._callBridge(args);
    return result.markdown || '';
  }

  // --- Private ---

  /**
   * Call the Python bridge script with safe argument passing.
   * No shell interpolation — args passed directly to spawn().
   *
   * @param {string[]} args - Arguments for mempalace_bridge.py
   * @returns {Promise<Object>} Parsed JSON result
   * @throws {Error} If bridge returns {success: false} or crashes
   */
  async _callBridge(args) {
    const fullArgs = [];
    if (this.palacePath !== DEFAULT_PALACE_PATH) {
      fullArgs.push('--palace', this.palacePath);
    }
    fullArgs.push(...args);

    return callPythonBridge(fullArgs, {
      timeout: this.timeout,
      bridgePath: BRIDGE_SCRIPT,
      pythonPath: this.pythonPath,
      rejectOnError: true,
    });
  }
}
