// Multi-projection search index for the agent-graph. Built in memory from a
// serialized `AgentState`, queried by name / path / archetype / signature.
//
// Indices:
//   - byName:      lower-cased token → entity ids (inverted)
//   - pathTrie:    path segment prefix → entity ids (segment-by-segment)
//   - byArchetype: archetype → file paths
//   - bySignature: linear map entityId → signature (lower-cased, for substring)

import type { AgentState, Archetype, CodeEntity } from './types';

interface IndexEntry {
  entity: CodeEntity;
  filePathParts: string[];
  signatureLower: string;
}

export interface SearchQuery {
  name?: string;
  path?: string;
  archetype?: Archetype;
  text?: string;
  language?: string;
  limit?: number;
}

export interface SearchHit {
  entity: CodeEntity;
  score: number;
  reasons: string[];
}

class TrieNode {
  children = new Map<string, TrieNode>();
  ids = new Set<string>();
}

export class SearchIndex {
  private entries = new Map<string, IndexEntry>();
  private byName = new Map<string, Set<string>>(); // token → ids
  private pathTrie = new TrieNode();
  private byArchetype = new Map<Archetype, Set<string>>(); // file path → ids
  private byFile = new Map<string, Set<string>>(); // file path → ids

  build(state: AgentState): void {
    this.entries.clear();
    this.byName.clear();
    this.pathTrie = new TrieNode();
    this.byArchetype.clear();
    this.byFile.clear();

    for (const e of state.entities) {
      if (!e.filePath) continue; // skip module-level import entities
      const parts = e.filePath.split('/').filter(Boolean);
      const entry: IndexEntry = {
        entity: e,
        filePathParts: parts,
        signatureLower: (e.signature ?? '').toLowerCase(),
      };
      this.entries.set(e.id, entry);
      this.byFile.set(e.filePath, (this.byFile.get(e.filePath) ?? new Set()).add(e.id));

      // name tokens
      const tokens = tokenize(e.name);
      for (const t of tokens) {
        const set = this.byName.get(t) ?? new Set<string>();
        set.add(e.id);
        this.byName.set(t, set);
      }
      // path tokens (segment-level)
      for (const seg of parts) {
        const lower = seg.toLowerCase();
        const set = this.byName.get(lower) ?? new Set<string>();
        set.add(e.id);
        this.byName.set(lower, set);
      }
      // path trie
      let node = this.pathTrie;
      for (const seg of parts) {
        node = node.children.get(seg) ?? (() => { const n = new TrieNode(); node.children.set(seg, n); return n; })();
        node.ids.add(e.id);
      }
      // archetype
      const arch = e.archetype ?? state.archetypes.fileAssignment[e.filePath]?.archetype;
      if (arch) {
        const set = this.byArchetype.get(arch) ?? new Set<string>();
        set.add(e.filePath);
        this.byArchetype.set(arch, set);
      }
    }
  }

  search(q: SearchQuery): SearchHit[] {
    const candidateIds = new Set<string>();
    const reasonsById = new Map<string, Set<string>>();
    const limit = q.limit ?? 30;

    const bumpReasons = (id: string, r: string) => {
      const set = reasonsById.get(id) ?? new Set<string>();
      set.add(r);
      reasonsById.set(id, set);
    };

    if (q.name && q.name.trim()) {
      for (const [token, ids] of this.byName) {
        if (token.includes(q.name.toLowerCase())) {
          for (const id of ids) {
            candidateIds.add(id);
            bumpReasons(id, `name~${token}`);
          }
        }
      }
    }

    if (q.path && q.path.trim()) {
      const want = q.path.toLowerCase();
      const walk = (node: TrieNode, parts: string[]): void => {
        if (node.ids.size && parts.join('/').toLowerCase().includes(want)) {
          for (const id of node.ids) {
            candidateIds.add(id);
            bumpReasons(id, `path~${parts.join('/')}`);
          }
        }
        for (const [seg, child] of node.children) {
          walk(child, [...parts, seg]);
        }
      };
      walk(this.pathTrie, []);
    }

    if (q.archetype) {
      const set = this.byArchetype.get(q.archetype);
      if (set) {
        for (const filePath of set) {
          const ids = this.byFile.get(filePath);
          if (!ids) continue;
          for (const id of ids) {
            candidateIds.add(id);
            bumpReasons(id, `archetype=${q.archetype}`);
          }
        }
      }
    }

    if (q.text && q.text.trim()) {
      const needle = q.text.toLowerCase();
      for (const [id, entry] of this.entries) {
        if (entry.signatureLower.includes(needle) || entry.entity.name.toLowerCase().includes(needle)) {
          candidateIds.add(id);
          bumpReasons(id, `text~${needle}`);
        }
      }
    }

    if (q.language) {
      for (const id of [...candidateIds]) {
        const entry = this.entries.get(id);
        if (!entry?.entity.language) {
          candidateIds.delete(id);
          continue;
        }
        if (entry.entity.language !== q.language) candidateIds.delete(id);
      }
    }

    // rank: by number of matching reasons, then by file path length (more specific wins)
    const hits: SearchHit[] = [];
    for (const id of candidateIds) {
      const entry = this.entries.get(id);
      if (!entry) continue;
      const reasons = [...(reasonsById.get(id) ?? new Set<string>())];
      hits.push({ entity: entry.entity, score: reasons.length, reasons });
    }
    hits.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const ap = a.entity.filePath.split('/').length;
      const bp = b.entity.filePath.split('/').length;
      if (ap !== bp) return bp - ap;
      return a.entity.name.localeCompare(b.entity.name);
    });
    return hits.slice(0, limit);
  }

  /** How many distinct entity ids are in the index. */
  size(): number {
    return this.entries.size;
  }
}

function tokenize(name: string): string[] {
  // split camelCase / snake_case / kebab-case
  const out = new Set<string>();
  const lc = name.toLowerCase();
  out.add(lc);
  for (let i = 0; i < lc.length; i++) {
    // strip one char
    for (let len = 3; len <= Math.min(8, lc.length - i); len++) {
      out.add(lc.slice(i, i + len));
    }
  }
  // camel splits
  const camel = name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/\s+/);
  for (const t of camel) if (t) out.add(t);
  // snake splits
  const snake = name.split(/[_\-.]+/);
  for (const t of snake) if (t) out.add(t.toLowerCase());
  return [...out];
}

export const searchIndex = new SearchIndex();
