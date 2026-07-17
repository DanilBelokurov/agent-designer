// Universal brace-based extractor for Java/Kotlin/Scala/Groovy/TS/JS/JSX/TSX/
// C/C++/Go/Rust/Swift/Ruby/C#. One parser for all of them; per-language
// specifics live in `LANG_PATTERNS`.
//
// Strategy:
//   1. Strip comments via tokenize.ts while preserving line numbers.
//   2. Walk line by line, tracking brace depth via tokenize.iterateBraceBlocks().
//   3. At braceDepth=0 (top-level), match header patterns and run until matching
//      closing brace to capture the full body (with original lines).
//   4. Detect modifiers and annotations by looking at lines immediately before
//      the header (within 5 lines, ignoring blanks).
//   5. Fall back to header-only for one-liners (no body braces).

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
  /** Capture group index that resolves to the entity name. */
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
  { kind: 'variable', regex: /^(?:public|protected|private|internal|const|val|var|@Volatile|lateinit|\s)*\b(val|var)\s+([A-Za-z_$][\w$]*)\s*[:=]/, nameGroup: 2 },
];

const TS_LIKE: HeaderPattern[] = [
  { kind: 'class', regex: /^(?:export\s+default\s+|export\s+)?(?:abstract\s+|declare\s+|export\s+)?(?:class|interface)\s+([A-Za-z_$][\w$]*)/, nameGroup: 1 },
  { kind: 'enum', regex: /^(?:export\s+default\s+|export\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/, nameGroup: 1 },
  { kind: 'function', regex: /^(?:export\s+default\s+|export\s+)?(?:async\s+)?function\s*\*?\s+([A-Za-z_$][\w$]*)/, nameGroup: 1 },
  { kind: 'function', regex: /^(?:export\s+default\s+|export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?\(/, nameGroup: 1 },
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

interface RawCandidate {
  kind: EntityKind;
  name: string;
  startLine: number;
  signature: string;
  bodyStartOffset: number;
  bodyEndOffset: number;
  endLine: number;
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

function walkAndExtract(
  source: string,
  lines: string[],
  patterns: HeaderPattern[],
): RawCandidate[] {
  const candidates: RawCandidate[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    let matched: HeaderPattern | null = null;
    let match: RegExpExecArray | null = null;
    for (const p of patterns) {
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

    // Find opening brace on this or next non-blank line.
    let openLine = i;
    if (!lines[i].includes('{')) {
      let j = i + 1;
      while (j < lines.length && !lines[j].includes('{')) j++;
      if (j >= lines.length) {
        // bodyless declaration — record signature only
        const blockStartOffset = lineAt(source, i);
        const bodyEndOffset = Math.min(source.length, blockStartOffset + lines[i].length + 1);
        candidates.push({
          kind: matched.kind,
          name,
          startLine: i,
          signature: lines[i].trim(),
          bodyStartOffset: blockStartOffset,
          bodyEndOffset: bodyEndOffset + 1,
          endLine: i,
        });
        continue;
      }
      openLine = j;
    }

    const blockStartOffset = lineAt(source, openLine);
    let bodyEndOffset = source.length;
    let bodyEndLine = lines.length - 1;

    for (const blk of iterateBraceBlocks(source.slice(blockStartOffset))) {
      const absStart = blockStartOffset + blk.startOffset;
      const absEnd = blockStartOffset + blk.endOffset;
      if (absStart < blockStartOffset) continue;
      bodyEndOffset = absEnd;
      bodyEndLine = lineAt(source, absEnd);
      break;
    }

    candidates.push({
      kind: matched.kind,
      name,
      startLine: i,
      signature: lines[i].trim(),
      bodyStartOffset: blockStartOffset,
      bodyEndOffset,
      endLine: bodyEndLine,
    });

    i = bodyEndLine;
  }

  return candidates;
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

  const entities: CodeEntity[] = [fileEntity];
  const relations: CodeRelation[] = [];

  const candidates = walkAndExtract(cleaned, lines, patterns);
  for (const c of candidates) {
    const id = `${filePath}::${c.kind}::${c.name}::${c.startLine}`;
    const body = source.slice(c.bodyStartOffset, Math.min(source.length, c.bodyEndOffset + 1));
    const snippet = trimSnippet(body);
    const doc = docCommentLines(lines, c.startLine);
    const annos = extractAnnotations(lines, c.startLine);
    const mods = extractModifiers(lines, c.startLine);

    entities.push({
      id,
      kind: c.kind,
      name: c.name,
      filePath,
      startLine: c.startLine,
      endLine: c.endLine,
      signature: c.signature,
      bodySnippet: snippet,
      docComment: doc,
      modifiers: mods.length ? mods : undefined,
      annotations: annos.length ? annos : undefined,
      language,
    });
    relations.push({ from: fileEntity.id, to: id, kind: 'contains' });
  }

  const imports = extractImports(cleaned, language);
  if (imports.length) {
    entities.push(...imports);
    for (const imp of imports) {
      relations.push({ from: fileEntity.id, to: imp.id, kind: 'imports' });
    }
  }

  return { entities, relations };
}
