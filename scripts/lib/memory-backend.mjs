/**
 * Memory Backend Abstraction Layer
 * 
 * Provides a unified interface for memory backends:
 * - MemPalaceBackend: ChromaDB + SQLite temporal KG (via Python bridge)
 * - FileBackend: Legacy memory/*.md files (fallback)
 * 
 * @module memory-backend
 */

/**
 * @typedef {Object} MemorySearchResult
 * @property {string} id - Unique identifier
 * @property {string} content - Memory content (verbatim text)
 * @property {number} score - Relevance score (0-1, from ChromaDB similarity)
 * @property {Object} metadata - wing, room, source_file, timestamps
 */

/**
 * @typedef {Object} MemoryStatus
 * @property {string} backend - Backend name
 * @property {boolean} healthy - Whether backend is healthy
 * @property {number} factCount - Total facts stored
 * @property {Object} wings - Wing statistics
 * @property {string} lastUpdated - ISO timestamp
 */

/**
 * Abstract base class for memory backends
 */
export class MemoryBackend {
  constructor(config = {}) {
    this.config = config;
    this.name = 'MemoryBackend';
  }

  /** Search for memories matching a query */
  async search(query, options = {}) {
    throw new Error('Not implemented: search()');
  }

  /** Ingest new memories from a source directory */
  async mine(sourceDir, options = {}) {
    throw new Error('Not implemented: mine()');
  }

  /** Get wake-up context for agent initialization (~600-900 tokens) */
  async wakeUp(options = {}) {
    throw new Error('Not implemented: wakeUp()');
  }

  /** Get backend status */
  async status() {
    throw new Error('Not implemented: status()');
  }

  /** Query temporal knowledge graph as of a specific date */
  async asOf(entityName, options = {}) {
    throw new Error('Not implemented: asOf()');
  }

  /** Export memories as JSON (for future UI/Obsidian support) */
  async exportJSON(options = {}) {
    throw new Error('Not implemented: exportJSON()');
  }

  /** Export memories as Markdown (for future Obsidian support) */
  async exportMarkdown(options = {}) {
    throw new Error('Not implemented: exportMarkdown()');
  }

  /** Health check */
  async isHealthy() {
    try {
      const s = await this.status();
      return s.healthy;
    } catch {
      return false;
    }
  }
}

/**
 * Factory for creating memory backends (async)
 */
export class MemoryBackendFactory {
  /**
   * Create a memory backend based on config
   * @param {Object} config
   * @param {string} config.backend - 'mempalace' | 'file'
   * @param {Object} [config.mempalace] - MemPalace-specific config
   * @param {Object} [config.file] - FileBackend-specific config
   * @returns {Promise<MemoryBackend>}
   */
  static async create(config) {
    const { backend, ...rest } = config;

    switch (backend) {
      case 'mempalace': {
        const { MemPalaceBackend } = await import('./mempalace-backend.mjs');
        return new MemPalaceBackend(rest.mempalace || {});
      }
      case 'file': {
        const { FileBackend } = await import('./file-backend.mjs');
        return new FileBackend(rest.file || {});
      }
      default:
        throw new Error(`Unknown memory backend: ${backend}`);
    }
  }

  /** Check if a backend is available on this system */
  static async isBackendAvailable(backend) {
    switch (backend) {
      case 'mempalace':
        try {
          const { execSync } = await import('child_process');
          execSync('python3 -c "import mempalace"', { stdio: 'ignore' });
          return true;
        } catch {
          return false;
        }
      case 'file':
        return true;
      default:
        return false;
    }
  }
}
