// Indent-language extractor for Python (and any other whitespace-sensitive
// language we add later). Block bodies are computed via leading-whitespace
// deltas, not via brace counting.
//
// What this pass produces:
//   - file entity + module entities for imports
//   - for every class: an entity with `parentId` set to the file, and a
//     `contains` relation to nested defs/fields
//   - for every nested def: an entity with `parentId` set to the class
//     (or the file for module-level functions)
//   - parameter entities + has_parameter relations
//   - return-type relations (parsed from `->` annotation)
//   - inheritance relations (parsed from `class Foo(Base, Mixin):`)
//   - field entities for annotated assignments at class scope

import type { CodeEntity, CodeRelation, EntityKind } from '../types';
import { splitLines, stripCommentsForLangClass, trimSnippet, docCommentLines } from '../tokenize';

const ANNOTATION_RE = /^[ \t]*@([A-Za-z_][\w.]*)/;
const MAX_LOOKBACK_FOR_ANNOTATIONS = 6;

function precedingDecorators(lines: string[], headerLine: number): { annotations: string[] } {
  const anns: string[] = [];
  for (let i = headerLine - 1; i >= 0 && i > headerLine - MAX_LOOKBACK_FOR_ANNOTATIONS; i--) {
    const t = lines[i].trim();
    if (!t) continue;
    if (t.startsWith('@')) {
      const m = t.match(ANNOTATION_RE);
      if (m) {
        anns.unshift(`@${m[1]}`);
        continue;
      }
    }
    break;
  }
  return { annotations: anns };
}

function parseParameters(signature: string): Array<{ name: string; type: string | null }> {
  const open = signature.indexOf('(');
  if (open < 0) return [];
  const close = signature.lastIndexOf(')');
  if (close <= open) return [];
  const inside = signature.slice(open + 1, close);
  const parts = inside
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const result: Array<{ name: string; type: string | null }> = [];
  for (const part of parts) {
    if (part === 'self' || part === 'cls') continue;
    const m = part.match(/^(\*{0,2})([A-Za-z_][\w]*)\s*(?::\s*([^=]+?))?\s*(?:=.*)?$/);
    if (m) {
      const prefix = m[1];
      const name = m[2];
      const type = m[3]?.trim() ?? null;
      if (prefix === '*' || prefix === '**') continue;
      result.push({ name, type });
      continue;
    }
  }
  return result;
}

function parseReturnType(signature: string): string | null {
  const close = signature.lastIndexOf(')');
  if (close < 0) return null;
  const after = signature.slice(close + 1).trim();
  const arrowIdx = after.indexOf('->');
  if (arrowIdx < 0) return null;
  let ret = after.slice(arrowIdx + 2).trim();
  ret = ret.replace(/[=:].*$/, '').trim();
  return ret || null;
}

function parsePythonInheritance(header: string): string[] {
  const colonIdx = header.indexOf(':');
  if (colonIdx < 0) return [];
  let bases = header.slice(colonIdx + 1).trim();
  if (!bases) return [];
  const out: string[] = [];
  for (const part of bases.split(',')) {
    let name = part.trim();
    name = name.replace(/<[^>]*>$/, '').replace(/\(.*$/, '').trim();
    if (!name || /^[a-z_]+=.*/.test(name)) continue;
    out.push(name);
  }
  return out;
}

function parseFieldHeader(line: string): { name: string; type: string | null } | null {
  const m = line.match(/^([A-Za-z_][\w]*)\s*(?::\s*([^=]+?))?\s*(?:[=\n]|$)/);
  if (!m) return null;
  return { name: m[1], type: m[2]?.trim() ?? null };
}

interface ScopeOut {
  entities: CodeEntity[];
  relations: CodeRelation[];
  typeRefs: Array<{ id: string; language: string }>;
}

function typeRefId(language: string, typeName: string): string {
  return `type:${language}:${typeName}`;
}

function walkScope(
  filePath: string,
  lines: string[],
  rangeStart: number,
  rangeEnd: number,
  baseIndent: number,
  parentId: string,
  language: string,
  out: ScopeOut,
): void {
  let i = rangeStart;
  while (i <= rangeEnd && i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (!t) {
      i += 1;
      continue;
    }

    const indent = line.match(/^[ \t]*/)?.[0].length ?? 0;
    if (indent < baseIndent) return;

    const classMatch = t.match(/^(?:async\s+)?(?:def|class)\s+([A-Za-z_][\w]*)/);
    if (classMatch) {
      const kind: EntityKind = t.includes('class') ? 'class' : 'function';
      const name = classMatch[1];
      const startLine = i;
      const { annotations } = precedingDecorators(lines, startLine);
      const headerId = `${filePath}::${kind}::${name}::${startLine}`;

      let j = i + 1;
      while (j < lines.length) {
        const l = lines[j];
        if (l.trim() === '') {
          j += 1;
          continue;
        }
        const ind = l.match(/^[ \t]*/)?.[0].length ?? 0;
        if (ind <= indent) break;
        j += 1;
      }
      const endLine = Math.max(i, j - 1);
      const body = lines.slice(i, j).join('\n');
      const snippet = trimSnippet(body);

      const entity: CodeEntity = {
        id: headerId,
        kind,
        name,
        filePath,
        startLine,
        endLine,
        signature: t,
        bodySnippet: snippet,
        docComment: docCommentLines(lines, startLine),
        annotations: annotations.length ? annotations : undefined,
        parentId,
        language,
      };
      out.entities.push(entity);
      out.relations.push({ from: parentId, to: headerId, kind: 'contains' });

      const params = parseParameters(t);
      for (let pi = 0; pi < params.length; pi++) {
        const p = params[pi];
        const pId = `${headerId}::param::${pi}`;
        out.entities.push({
          id: pId,
          kind: 'parameter',
          name: p.name,
          filePath,
          startLine,
          endLine: startLine,
          parentId: headerId,
          signature: p.type ? `${p.name}: ${p.type}` : p.name,
          language,
        });
        out.relations.push({ from: headerId, to: pId, kind: 'has_parameter' });
        if (p.type) {
          out.typeRefs.push({ id: typeRefId(language, p.type.replace(/<.*$/, '').trim()), language });
        }
      }
      const ret = parseReturnType(t);
      if (ret) {
        const tid = typeRefId(language, ret.replace(/<.*$/, '').trim());
        out.typeRefs.push({ id: tid, language });
        out.relations.push({ from: headerId, to: tid, kind: 'returns' });
      }

      if (kind === 'class') {
        for (const base of parsePythonInheritance(t)) {
          const tid = typeRefId(language, base);
          out.typeRefs.push({ id: tid, language });
          out.relations.push({ from: headerId, to: tid, kind: 'inherits' });
        }
      }

      if (kind === 'class' && endLine > startLine) {
        walkScope(filePath, lines, i + 1, endLine, indent + 1, headerId, language, out);
      }

      i = j;
      continue;
    }

    // Field inside a class: `name: Type = ...` or `name = ...` at indent == baseIndent.
    const isClassScope = parentId.includes('::class::');
    if (isClassScope) {
      const field = parseFieldHeader(t);
      const isStatement = t.startsWith('self.') || t.startsWith('return ') || t.startsWith('if ') ||
        t.startsWith('for ') || t.startsWith('while ') || t.startsWith('try:') ||
        t.startsWith('with ') || t.startsWith('@');
      if (field && !isStatement) {
        const startLine = i;
        const fieldId = `${filePath}::field::${field.name}::${startLine}`;
        out.entities.push({
          id: fieldId,
          kind: 'field',
          name: field.name,
          filePath,
          startLine,
          endLine: startLine,
          signature: t,
          parentId,
          language,
        });
        out.relations.push({ from: parentId, to: fieldId, kind: 'contains' });
        if (field.type) {
          const tid = typeRefId(language, field.type.replace(/<.*$/, '').trim());
          out.typeRefs.push({ id: tid, language });
        }
      }
    }

    i += 1;
  }
}

export function extractIndentLanguage(
  filePath: string,
  source: string,
  language: string,
): { entities: CodeEntity[]; relations: CodeRelation[] } {
  const cleaned = stripCommentsForLangClass(source, 'indent');
  const lines = splitLines(cleaned);

  const fileEntity: CodeEntity = {
    id: `file:${filePath}`,
    kind: 'file',
    name: filePath.split('/').pop() ?? filePath,
    filePath,
    startLine: 0,
    endLine: lines.length - 1,
    language,
  };

  const out: ScopeOut = {
    entities: [fileEntity],
    relations: [],
    typeRefs: [],
  };

  walkScope(filePath, lines, 0, lines.length - 1, 0, fileEntity.id, language, out);

  // Type entities — dedupe by id.
  const seenTypes = new Set<string>();
  for (const ref of out.typeRefs) {
    if (!ref.id) continue;
    const name = ref.id.split(':').slice(2).join(':');
    if (!name || name.length > 100) continue;
    if (seenTypes.has(ref.id)) continue;
    seenTypes.add(ref.id);
    if (out.entities.some((e) => e.id === ref.id)) continue;
    out.entities.push({
      id: ref.id,
      kind: 'type',
      name,
      filePath: '',
      startLine: 0,
      endLine: 0,
      language: ref.language,
    });
  }

  // Imports.
  const importRe = /^[ \t]*(?:from\s+([\w.]+)\s+)?import\s+([\w.*,\s]+)(?:\s+as\s+[\w.]+)?/gm;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(cleaned))) {
    const range = `from ${m[1]} import ${m[2]}`.slice(0, 100);
    out.entities.push({
      id: `mod:${language}:${m.index}`,
      kind: 'module',
      name: range,
      filePath: '',
      startLine: sourceIndexToLine(cleaned, m.index),
      endLine: sourceIndexToLine(cleaned, m.index),
      language,
    });
    out.relations.push({ from: fileEntity.id, to: `mod:${language}:${m.index}`, kind: 'imports' });
  }

  return { entities: out.entities, relations: out.relations };
}

function sourceIndexToLine(source: string, offset: number): number {
  let n = 0;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === '\n') n++;
  }
  return n;
}