// Universal brace-based extractor for Java/Kotlin/Scala/Groovy/TS/JS/JSX/TSX/
// C/C++/Go/Rust/Swift/Ruby/C#. One parser for all of them; per-language
// specifics live in `LANG_PATTERNS`.
//
// What this pass produces:
//   - file entity + module entities for imports
//   - for every container (class/interface/enum/object/companion): an entity
//     with `parentId` set to the owning file, and a `contains` relation
//   - for every nested function/method/field/parameter/constant inside a
//     container: an entity with `parentId` set to that container
//   - inheritance relations (`inherits` / `implements`) parsed from the
//     class header (Kotlin `: Base, Iface`, Java/TS `extends ... implements ...`)
//   - Kotlin extension-function relations (`extension_of`)
//   - return-type relations (`returns`) and parameter entities (`has_parameter`)
//   - field relations (`field_of`) for class/instance fields
//
// Type references (parameter types, return types, supertypes) that have not
// been seen elsewhere are emitted as `type` entities so relations resolve to
// a node rather than a dangling id.
//
// Walk strategy:
//   1. Strip comments via tokenize.ts.
//   2. Recursive `walkScope(...)`: for every line in the range, try to match
//      a header pattern. When a container is matched, emit it, find the
//      matching `}`, then recurse into the body with the container as parent.
//      Non-container headers (function/method/field/variable) are emitted
//      once and their bodies are skipped.

import type { CodeEntity, CodeRelation, EntityKind } from '../types';
import {
  splitLines,
  iterateBraceBlocks,
  lineAt,
  stripCommentsForLangClass,
  trimSnippet,
  docCommentLines,
} from '../tokenize';

interface HeaderPattern {
  kind: EntityKind;
  regex: RegExp;
  nameGroup: number;
}

const JAVA_LIKE: HeaderPattern[] = [
  { kind: 'class', regex: /^(?:public|protected|private|abstract|final|sealed|open|\s)*\b(?:(?:static\s+)?(?:@?[\w<>,\[\]\s]+?\s+)?(?:class|interface|enum|record|@interface))\s+([A-Za-z_$][\w$]*)/, nameGroup: 1 },
  { kind: 'object', regex: /^(?:public|protected|private|abstract|final|\s)*\b(?:object)\s+([A-Za-z_$][\w$]*)/, nameGroup: 1 },
  { kind: 'function', regex: /^(?:public|protected|private|static|final|abstract|synchronized|default|inline|\s)*\b(?:<[^>]+>\s+)?(?:[A-Za-z_$][\w$<>,\[\]\?]*\s+)?([A-Za-z_$][\w$]*)\s*\(/, nameGroup: 1 },
];

const KOTLIN_LIKE: HeaderPattern[] = [
  { kind: 'class', regex: /^(?:public|protected|private|internal|abstract|final|sealed|open|data|value|\s)*\b(?:class|interface|object|enum\s+class|data\s+object)\s+([A-Za-z_$][\w$]*)/, nameGroup: 1 },
  { kind: 'function', regex: /^(?:public|protected|private|internal|abstract|final|open|suspend|inline|operator|infix|tail|external|override|\s)*\b(?:fun|fun\s*\([^)]*\))\s+([A-Za-z_$][\w$]*)/, nameGroup: 1 },
  { kind: 'field', regex: /^(?:public|protected|private|internal|const|val|var|@Volatile|lateinit|\s)*\b(val|var)\s+([A-Za-z_$][\w$]*)\s*[:=]/, nameGroup: 2 },
];

const TS_LIKE: HeaderPattern[] = [
  { kind: 'class', regex: /^(?:export\s+default\s+|export\s+)?(?:abstract\s+|declare\s+|export\s+)?(?:class|interface)\s+([A-Za-z_$][\w$]*)/, nameGroup: 1 },
  { kind: 'enum', regex: /^(?:export\s+default\s+|export\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/, nameGroup: 1 },
  { kind: 'function', regex: /^(?:export\s+default\s+|export\s+)?(?:async\s+)?function\s*\*?\s+([A-Za-z_$][\w$]*)/, nameGroup: 1 },
  { kind: 'function', regex: /^(?:export\s+default\s+|export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?\(/, nameGroup: 1 },
  { kind: 'field', regex: /^(?:export\s+default\s+|export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=,;]+)?\s*[=;]/, nameGroup: 1 },
  { kind: 'method', regex: /^[\s]*(?:public|protected|private|static|abstract|readonly|async|\s)*\b([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(/, nameGroup: 1 },
];

const C_LIKE: HeaderPattern[] = [
  { kind: 'class', regex: /^(?:public|protected|private|abstract|final|virtual|\s)*\b(?:class|struct|union|enum)\s+([A-Za-z_][\w]*)/, nameGroup: 1 },
  { kind: 'function', regex: /^(?:public|protected|private|static|inline|virtual|explicit|constexpr|final|override|static|\s)*\b(?:[A-Za-z_][\w]*\s+[*&]*\s+)?([A-Za-z_][\w]*)\s*\(/, nameGroup: 1 },
];

const GO_LIKE: HeaderPattern[] = [
  { kind: 'function', regex: /^(?:func)\s+([A-Za-z_][\w]*)\s*\(/, nameGroup: 1 },
  { kind: 'method', regex: /^(?:func\s*)\(\s*[a-zA-Z_][\w]*\s*\*?\s*\)?\s*([A-Za-z_][\w]*)\s*\(/, nameGroup: 1 },
  { kind: 'class', regex: /^(?:type)\s+([A-Za-z_][\w]*)\s+(struct|interface)/, nameGroup: 1 },
];

const RUST_LIKE: HeaderPattern[] = [
  { kind: 'function', regex: /^(?:pub\s+|pub\(\w+\)\s+|async\s+|unsafe\s+|const\s+|extern\s+|default\s+)*fn\s+([A-Za-z_][\w]*)/, nameGroup: 1 },
  { kind: 'class', regex: /^(?:pub\s+)?(?:struct|enum|trait|union|type)\s+([A-Za-z_][\w]*)/, nameGroup: 1 },
];

const SWIFT_LIKE: HeaderPattern[] = [
  { kind: 'class', regex: /^(?:public\s+|open\s+|fileprivate\s+|internal\s+|private\s+|final\s+)*?(?:class|struct|enum|protocol|extension)\s+([A-Za-z_][\w]*)/, nameGroup: 1 },
  { kind: 'function', regex: /^(?:public\s+|open\s+|fileprivate\s+|internal\s+|private\s+|static\s+|class\s+|final\s+)*?func\s+([A-Za-z_][\w]*)\s*[<(]/, nameGroup: 1 },
];

const CSHARP_LIKE: HeaderPattern[] = [
  { kind: 'class', regex: /^(?:public\s+|internal\s+|protected\s+|private\s+|abstract\s+|sealed\s+|static\s+|partial\s+)*(?:class|interface|struct|enum|record)\s+([A-Za-z_][\w]*)/, nameGroup: 1 },
  { kind: 'function', regex: /^(?:public\s+|internal\s+|protected\s+|private\s+|static\s+|virtual\s+|override\s+|abstract\s+|async\s+|extern\s+|unsafe\s+|readonly\s+|partial\s+)*?[A-Za-z_][\w<>,\[\]\?]*\s+([A-Za-z_][\w]*)\s*\(/, nameGroup: 1 },
];

const RUBY_LIKE: HeaderPattern[] = [
  { kind: 'class', regex: /^(?:public\s+|abstract\s+|final\s+|singleton\s+)*?(?:class|module)\s+([A-Z][\w:]*)/, nameGroup: 1 },
  { kind: 'function', regex: /^(?:def)\s+([A-Za-z_][\w]*[?!=]?)/, nameGroup: 1 },
];

export const LANG_PATTERNS: Record<string, HeaderPattern[]> = {
  kotlin: KOTLIN_LIKE,
  java: JAVA_LIKE,
  scala: JAVA_LIKE,
  groovy: JAVA_LIKE,
  csharp: CSHARP_LIKE,
  typescript: TS_LIKE,
  tsx: TS_LIKE,
  javascript: TS_LIKE,
  c: C_LIKE,
  cpp: C_LIKE,
  swift: SWIFT_LIKE,
  go: GO_LIKE,
  rust: RUST_LIKE,
  ruby: RUBY_LIKE,
};

const ANNOTATION_RE = /^[ \t]*@([A-Za-z_][\w.]*)/;
const ATTR_RE = /^[ \t]*\[([A-Za-z_][\w.]*)/;
const MAX_LOOKBACK_FOR_MODIFIERS = 5;
const MAX_LOOKBACK_FOR_ANNOTATIONS = 8;

const CONTAINER_KINDS: ReadonlySet<EntityKind> = new Set([
  'class', 'interface', 'enum', 'object', 'companion',
]);

interface RawCandidate {
  kind: EntityKind;
  name: string;
  startLine: number;
  signature: string;
  bodyStartOffset: number;
  bodyEndOffset: number;
  endLine: number;
}

interface ScopeOut {
  entities: CodeEntity[];
  relations: CodeRelation[];
  typeRefs: Array<{ id: string; language: string }>;
}

function extractModifiers(lines: string[], headerLine: number): string[] {
  const mods = new Set<string>();
  for (let i = headerLine - 1; i >= 0 && i > headerLine - MAX_LOOKBACK_FOR_MODIFIERS; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    if (ANNOTATION_RE.test(line) || ATTR_RE.test(line)) break;
    const m = line.match(/^(public|protected|private|internal|static|final|abstract|sealed|open|async|const|val|var|virtual|override|inline|extern|default|suspend|tail|operator|infix|fixed|fileprivate|mutable|partial|explicit|readonly|unsafe)/);
    if (m) mods.add(m[1]);
    else break;
  }
  return [...mods];
}

function extractAnnotations(lines: string[], headerLine: number): string[] {
  const anns: string[] = [];
  for (let i = headerLine - 1; i >= 0 && i > headerLine - MAX_LOOKBACK_FOR_ANNOTATIONS; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    const m = line.match(ANNOTATION_RE);
    if (m) {
      anns.unshift(`@${m[1]}`);
      continue;
    }
    const a = line.match(ATTR_RE);
    if (a) {
      anns.unshift(`[${a[1]}]`);
      continue;
    }
    break;
  }
  return anns;
}

function isCompanionObjectHeader(header: string, language: string): boolean {
  return language === 'kotlin' && /^\s*(?:public|private|internal|protected)?\s*companion\s+object\b/.test(header);
}

function isKotlinExtensionHeader(header: string): boolean {
  return /\bfun\s+\([^)]+\)\s*[A-Za-z_]/.test(header);
}

function parseKotlinExtensionReceiver(header: string): string | null {
  const m = header.match(/\bfun\s+\(\s*([A-Za-z_][\w.]*(?:\.\w+)?)\s+[A-Za-z_][\w]*\s*\)/);
  if (!m) return null;
  return m[1].split('.').slice(-1)[0] ?? null;
}

function typeRefId(language: string, typeName: string): string {
  return `type:${language}:${typeName}`;
}

function splitTopLevelCommas(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(' || c === '<' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === '>' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  if (start < s.length) out.push(s.slice(start));
  return out;
}

interface ParsedParam {
  name: string;
  type: string | null;
}

function parseParameters(signature: string): ParsedParam[] {
  const open = signature.indexOf('(');
  if (open < 0) return [];
  const close = signature.lastIndexOf(')');
  if (close <= open) return [];
  const inside = signature.slice(open + 1, close);
  const parts = splitTopLevelCommas(inside).map((p) => p.trim()).filter(Boolean);
  const result: ParsedParam[] = [];
  for (const part of parts) {
    const m = part.match(/^([A-Za-z_][\w]*)\s*(?::\s*(.+?))?\s*$/);
    if (m) {
      result.push({ name: m[1], type: m[2]?.trim() ?? null });
      continue;
    }
    // Type-first: `Type name` (Java/TS).
    const m2 = part.match(/^([A-Za-z_$][\w$<>,\[\]\?\.]*)\s+([A-Za-z_][\w]*)\s*$/);
    if (m2) {
      result.push({ name: m2[2], type: m2[1].trim() });
      continue;
    }
    result.push({ name: part, type: null });
  }
  return result;
}

function parseReturnType(signature: string): string | null {
  const close = signature.lastIndexOf(')');
  if (close < 0) return null;
  let after = signature.slice(close + 1).trim();
  const colonIdx = after.indexOf(':');
  if (colonIdx < 0) return null;
  after = after.slice(colonIdx + 1).trim();
  after = after.replace(/[={].*$/, '').replace(/\bthrows\s+\S+.*$/, '').trim();
  if (!after) return null;
  if (['Unit', 'void', 'Nothing', 'undefined', 'null', 'None'].includes(after)) return null;
  return after;
}

function parseClassInheritance(
  header: string,
  language: string,
): { inherit: string[]; implement: string[] } {
  const inherit: string[] = [];
  const implement: string[] = [];

  if (language === 'kotlin') {
    const colonIdx = header.indexOf(':');
    if (colonIdx < 0) return { inherit, implement };
    const brace = header.indexOf('{', colonIdx);
    let bases = (brace >= 0 ? header.slice(colonIdx + 1, brace) : header.slice(colonIdx + 1)).trim();
    bases = bases.replace(/\s+by\s+.*$/, '').trim();
    if (!bases) return { inherit, implement };
    for (const part of splitTopLevelCommas(bases)) {
      const name = part.replace(/<[^>]*>$/, '').replace(/\(.*$/, '').trim();
      if (name) inherit.push(name);
    }
    return { inherit, implement };
  }

  const extendsRe = /\bextends\s+([A-Za-z_][\w$.<>,\s]*?)(?=\s+implements|\s*\{|$)/;
  const em = header.match(extendsRe);
  if (em) {
    for (const part of splitTopLevelCommas(em[1])) {
      const name = part.replace(/<[^>]*>$/, '').trim();
      if (name) inherit.push(name);
    }
  }
  const implementsRe = /\bimplements\s+([A-Za-z_][\w$.<>,\s]*?)(?=\s*\{|$)/;
  const im = header.match(implementsRe);
  if (im) {
    for (const part of splitTopLevelCommas(im[1])) {
      const name = part.replace(/<[^>]*>$/, '').trim();
      if (name) implement.push(name);
    }
  }
  return { inherit, implement };
}

function isConstant(mods: string[], kind: EntityKind): boolean {
  if (kind === 'constant') return true;
  if (mods.includes('const')) return true;
  if (mods.includes('static') && mods.includes('final')) return true;
  return false;
}

function extractImports(source: string, language: string): CodeEntity[] {
  const entities: CodeEntity[] = [];
  if (language === 'go') {
    const re = /^\s*(?:[a-z_][\w]*\s+)?\"([\w./-]+)\"/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source))) {
      entities.push({
        id: `mod:${language}:${m[1]}`,
        kind: 'module',
        name: m[1],
        filePath: '',
        startLine: lineAt(source, m.index),
        endLine: lineAt(source, m.index),
        language,
      });
    }
  } else {
    const re = /^\s*import\s+(?:static\s+)?[^;]+;/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source))) {
      const range = m[0].replace(/^\s*import\s+/, '').replace(/;?\s*$/, '').slice(0, 100);
      entities.push({
        id: `mod:${language}:${m.index}`,
        kind: 'module',
        name: range,
        filePath: '',
        startLine: lineAt(source, m.index),
        endLine: lineAt(source, m.index),
        language,
      });
    }
  }
  return entities;
}

function findMatchingBraceEnd(source: string, startOffset: number): number {
  for (const blk of iterateBraceBlocks(source.slice(startOffset))) {
    return Math.min(source.length, startOffset + blk.endOffset + 1);
  }
  return source.length;
}

function buildEntity(
  filePath: string,
  c: RawCandidate,
  source: string,
  lines: string[],
  parentId: string | null,
): { entity: CodeEntity; params: ParsedParam[]; returnType: string | null } {
  const id = `${filePath}::${c.kind}::${c.name}::${c.startLine}`;
  const body = source.slice(c.bodyStartOffset, Math.min(source.length, c.bodyEndOffset + 1));
  const snippet = trimSnippet(body);
  const doc = docCommentLines(lines, c.startLine);
  const annos = extractAnnotations(lines, c.startLine);
  const mods = extractModifiers(lines, c.startLine);

  const params = c.kind === 'function' || c.kind === 'method'
    ? parseParameters(c.signature)
    : [];
  const returnType = c.kind === 'function' || c.kind === 'method'
    ? parseReturnType(c.signature)
    : null;

  let kind = c.kind;
  if (c.kind === 'field' && isConstant(mods, c.kind)) {
    kind = 'constant';
  }

  const entity: CodeEntity = {
    id,
    kind,
    name: c.name,
    filePath,
    startLine: c.startLine,
    endLine: c.endLine,
    signature: c.signature,
    bodySnippet: snippet,
    docComment: doc,
    modifiers: mods.length ? mods : undefined,
    annotations: annos.length ? annos : undefined,
    parentId: parentId ?? undefined,
    language: c.signature ? undefined : undefined,
  };

  return { entity, params, returnType };
}

function walkScope(
  filePath: string,
  source: string,
  lines: string[],
  patterns: HeaderPattern[],
  rangeStart: number,
  rangeEnd: number,
  parentId: string,
  language: string,
  out: ScopeOut,
): void {
  for (let i = rangeStart; i <= rangeEnd && i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    let matched: HeaderPattern | null = null;
    let match: RegExpExecArray | null = null;
    for (const p of patterns) {
      // Skip field patterns at the top level (file scope) — they're noise.
      if (p.kind === 'field' && parentId.startsWith('file:')) continue;
      const m = p.regex.exec(line);
      if (m && m[p.nameGroup]) {
        matched = p;
        match = m;
        break;
      }
    }
    if (!matched || !match) continue;

    const name = match[matched.nameGroup];
    if (!name || !/^[A-Za-z_]/.test(name)) continue;

    let resolvedKind: EntityKind = matched.kind;
    if (matched.kind === 'object' && isCompanionObjectHeader(line, language)) {
      resolvedKind = 'companion';
    }

    let openLine = i;
    if (!lines[i].includes('{')) {
      let j = i + 1;
      while (j < lines.length && !lines[j].includes('{')) j++;
      if (j >= lines.length || j > rangeEnd) {
        // bodyless declaration.
        const blockStartOffset = lineAt(source, i);
        const bodyEndOffset = Math.min(source.length, blockStartOffset + lines[i].length + 1);
        const candidate: RawCandidate = {
          kind: resolvedKind,
          name,
          startLine: i,
          signature: lines[i].trim(),
          bodyStartOffset: blockStartOffset,
          bodyEndOffset: bodyEndOffset + 1,
          endLine: i,
        };
        const { entity } = buildEntity(filePath, candidate, source, lines, parentId);
        out.entities.push(entity);
        out.relations.push({ from: parentId, to: entity.id, kind: 'contains' });
        continue;
      }
      openLine = j;
    }
    if (openLine > rangeEnd) continue;

    const blockStartOffset = lineAt(source, openLine);
    const bodyEndOffset = findMatchingBraceEnd(source, blockStartOffset);
    const bodyEndLine = Math.min(rangeEnd, lineAt(source, bodyEndOffset));

    const candidate: RawCandidate = {
      kind: resolvedKind,
      name,
      startLine: i,
      signature: lines[i].trim(),
      bodyStartOffset: blockStartOffset,
      bodyEndOffset,
      endLine: bodyEndLine,
    };

    const { entity, params, returnType } = buildEntity(filePath, candidate, source, lines, parentId);
    out.entities.push(entity);
    out.relations.push({ from: parentId, to: entity.id, kind: 'contains' });

    // Parameter entities + has_parameter relations.
    for (let pi = 0; pi < params.length; pi++) {
      const p = params[pi];
      const pId = `${entity.id}::param::${pi}`;
      const paramEntity: CodeEntity = {
        id: pId,
        kind: 'parameter',
        name: p.name,
        filePath,
        startLine: entity.startLine,
        endLine: entity.startLine,
        parentId: entity.id,
        signature: p.type ? `${p.name}: ${p.type}` : p.name,
        language,
      };
      out.entities.push(paramEntity);
      out.relations.push({ from: entity.id, to: pId, kind: 'has_parameter' });
      if (p.type) {
        const tid = typeRefId(language, p.type.replace(/<.*$/, '').replace(/[?&].*$/, '').trim());
        out.typeRefs.push({ id: tid, language });
      }
    }

    if (returnType) {
      const tid = typeRefId(language, returnType.replace(/<.*$/, '').replace(/[?&].*$/, '').trim());
      out.typeRefs.push({ id: tid, language });
      out.relations.push({ from: entity.id, to: tid, kind: 'returns' });
    }

    const { inherit, implement } = parseClassInheritance(entity.signature ?? '', language);
    for (const base of inherit) {
      const tid = typeRefId(language, base);
      out.typeRefs.push({ id: tid, language });
      out.relations.push({ from: entity.id, to: tid, kind: 'inherits' });
    }
    for (const iface of implement) {
      const tid = typeRefId(language, iface);
      out.typeRefs.push({ id: tid, language });
      out.relations.push({ from: entity.id, to: tid, kind: 'implements' });
    }

    if (language === 'kotlin' && isKotlinExtensionHeader(entity.signature ?? '')) {
      const recv = parseKotlinExtensionReceiver(entity.signature ?? '');
      if (recv) {
        const tid = typeRefId(language, recv);
        out.typeRefs.push({ id: tid, language });
        out.relations.push({ from: entity.id, to: tid, kind: 'extension_of' });
      }
    }

    if (CONTAINER_KINDS.has(resolvedKind) && bodyEndLine > openLine + 1) {
      walkScope(
        filePath,
        source,
        lines,
        patterns,
        openLine + 1,
        bodyEndLine - 1,
        entity.id,
        language,
        out,
      );
      i = bodyEndLine;
    } else if (bodyEndLine > openLine) {
      i = bodyEndLine;
    }
  }
}

export function extractBraceLanguage(
  filePath: string,
  source: string,
  language: string,
): { entities: CodeEntity[]; relations: CodeRelation[] } {
  const patterns = LANG_PATTERNS[language] ?? JAVA_LIKE;
  const cleaned = stripCommentsForLangClass(source, 'brace');
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

  walkScope(filePath, cleaned, lines, patterns, 0, lines.length - 1, fileEntity.id, language, out);

  // Type entities — one per (language, typeName).
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

  const imports = extractImports(cleaned, language);
  if (imports.length) {
    out.entities.push(...imports);
    for (const imp of imports) {
      out.relations.push({ from: fileEntity.id, to: imp.id, kind: 'imports' });
    }
  }

  return { entities: out.entities, relations: out.relations };
}