/**
 * FileBackend - Legacy memory/*.md file backend
 * 
 * Backward-compatible access to existing memory files.
 * Fallback when MemPalace is not installed.
 * 
 * @module file-backend
 */

import { readFile, readdir, stat } from 'fs/promises';
import { join, basename } from 'path';
import { existsSync } from 'fs';
import { MemoryBackend } from './memory-backend.mjs';

const DEFAULT_MEMORY_DIR = join(
  process.env.HOME || '/tmp', '.openclaw', 'workspace', 'memory'
);

export class FileBackend extends MemoryBackend {
  constructor(config = {}) {
    super(config);
    this.name = 'FileBackend';
    this.memoryDir = config.memoryDir || DEFAULT_MEMORY_DIR;
    this._cache = null;
    this._cacheTime = 0;
    this._cacheTTL = 60_000; // 1 minute
  }

  async search(query, options = {}) {
    const facts = await this._loadFacts();
    const results = [];
    const queryLower = query.toLowerCase();
    const limit = options.limit || 10;
    const minScore = options.minScore || 0.1;

    for (const fact of facts) {
      const contentLower = fact.content.toLowerCase();
      let score = 0;

      if (contentLower.includes(queryLower)) {
        score = 0.8;
      } else {
        const queryWords = queryLower.split(/\s+/).filter(Boolean);
        const contentWords = new Set(contentLower.split(/\s+/));
        const overlap = queryWords.filter(w => contentWords.has(w)).length;
        score = queryWords.length > 0 ? (overlap / queryWords.length) * 0.5 : 0;
      }

      if (options.wing && fact.metadata?.wing !== options.wing) continue;
      if (options.room && fact.metadata?.room !== options.room) continue;

      if (score >= minScore) {
        results.push({
          id: fact.id,
          content: fact.content,
          score,
          metadata: fact.metadata || {}
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  async mine(source, options = {}) {
    console.warn('FileBackend.mine(): read-only. Use MemPalaceBackend for writes.');
    return { success: true, count: 0, facts: [], message: 'FileBackend is read-only.' };
  }

  async wakeUp(options = {}) {
    const maxTokens = options.maxTokens || 500;
    const memoryFile = join(this.memoryDir, 'MEMORY.md');

    if (!existsSync(memoryFile)) return '';

    const content = await readFile(memoryFile, 'utf-8');
    const lines = content.split('\n');
    const context = [];
    let tokenCount = 0;

    for (const line of lines) {
      if (context.length === 0 && line.trim() === '') continue;
      if (line.match(/^#+\s*$/)) continue;

      const lineTokens = line.split(/\s+/).length;
      if (tokenCount + lineTokens > maxTokens) break;

      context.push(line);
      tokenCount += lineTokens;
    }

    return context.join('\n');
  }

  async status() {
    try {
      const files = await this._getMemoryFiles();
      let lastUpdated = null;
      const memoryFile = join(this.memoryDir, 'MEMORY.md');

      if (existsSync(memoryFile)) {
        const stats = await stat(memoryFile);
        lastUpdated = stats.mtime.toISOString();
      }

      return {
        backend: 'FileBackend',
        healthy: existsSync(this.memoryDir),
        factCount: files.length,
        wings: { default: files.length },
        lastUpdated
      };
    } catch {
      return {
        backend: 'FileBackend', healthy: false,
        factCount: 0, wings: {}, lastUpdated: null
      };
    }
  }

  async asOf(entityName, options = {}) {
    const date = options.date;
    if (!date) return [];

    const dailyFile = join(this.memoryDir, 'daily', `${date}.md`);
    if (!existsSync(dailyFile)) return [];

    const content = await readFile(dailyFile, 'utf-8');
    const limit = options.limit || 10;

    if (entityName) {
      const lines = content.split('\n');
      const entityLower = entityName.toLowerCase();
      const results = [];
      for (const line of lines) {
        if (line.toLowerCase().includes(entityLower) && line.trim()) {
          results.push({
            id: `${date}-${results.length}`,
            content: line,
            score: 1.0,
            metadata: { date, source: 'daily' }
          });
        }
      }
      return results.slice(0, limit);
    }

    return [{ id: date, content, score: 1.0, metadata: { date, source: 'daily' } }];
  }

  async exportJSON(options = {}) {
    const facts = await this._loadFacts();
    return {
      backend: 'FileBackend',
      exported: new Date().toISOString(),
      facts: facts.map(f => ({ id: f.id, content: f.content, metadata: f.metadata || {} }))
    };
  }

  async exportMarkdown(options = {}) {
    const facts = await this._loadFacts();
    const lines = [];
    for (const fact of facts) {
      lines.push(`## ${fact.id}`, '', fact.content, '');
      if (fact.metadata?.date) lines.push(`_Date: ${fact.metadata.date}_`, '');
    }
    return lines.join('\n');
  }

  // --- Private ---

  async _loadFacts() {
    const now = Date.now();
    if (this._cache && now - this._cacheTime < this._cacheTTL) {
      return this._cache;
    }

    const facts = [];
    try {
      const memoryFile = join(this.memoryDir, 'MEMORY.md');
      if (existsSync(memoryFile)) {
        const content = await readFile(memoryFile, 'utf-8');
        facts.push({ id: 'MEMORY.md', content, metadata: { source: 'MEMORY.md' } });
      }

      const dailyDir = join(this.memoryDir, 'daily');
      if (existsSync(dailyDir)) {
        const files = await readdir(dailyDir);
        for (const file of files) {
          if (!file.endsWith('.md')) continue;
          const content = await readFile(join(dailyDir, file), 'utf-8');
          facts.push({
            id: file,
            content,
            metadata: { source: 'daily', date: basename(file, '.md') }
          });
        }
      }
    } catch (error) {
      console.error('FileBackend: Failed to load memory files:', error.message);
    }

    this._cache = facts;
    this._cacheTime = now;
    return facts;
  }

  async _getMemoryFiles() {
    const files = [];
    try {
      if (existsSync(join(this.memoryDir, 'MEMORY.md'))) files.push('MEMORY.md');
      const dailyDir = join(this.memoryDir, 'daily');
      if (existsSync(dailyDir)) {
        files.push(...(await readdir(dailyDir)).filter(f => f.endsWith('.md')));
      }
    } catch (error) {
      console.error('FileBackend: Failed to list files:', error.message);
    }
    return files;
  }
}
