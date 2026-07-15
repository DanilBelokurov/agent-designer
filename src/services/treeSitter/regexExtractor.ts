// Lightweight regex-based extractor used as a fallback when the tree-sitter
// WASM grammar for a file is unavailable. Captures enough metadata to drive
// the instruction-generator prompt builder, even if it lacks full AST fidelity.

import type { CodeEntity, CodeParser, CodeRelation, ParseResult } from './codeGraph';
import { languageForExtension } from './loader';

const SNIPPET_MAX = 24;

function makeId(filePath: string, name: string, line: number, kind: string): string {
  return `${filePath}::${kind}::${name}::${line}`;
}

function trimSnippet(s: string): string {
  const lines = s.split('\n');
  if (lines.length <= SNIPPET_MAX) return s;
  return lines.slice(0, SNIPPET_MAX).join('\n') + '\n…';
}

function captureLines(
  source: string,
  startLine: number,
  endLine: number,
): { signature: string; body: string } {
  const lines = source.split('\n');
  const sig = (lines[startLine] ?? '').trim();
  const body = lines.slice(startLine, endLine + 1).join('\n');
  return { signature: sig || '?', body };
}

function extractOneBraceBlock(lines: string[], startLine: number): { endLine: number } {
  let depth = 0;
  let started = false;
  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i];
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      if (ch === '{') {
        depth++;
        started = true;
      } else if (ch === '}') {
        depth--;
        if (started && depth === 0) return { endLine: i };
      }
    }
  }
  return { endLine: Math.min(lines.length - 1, startLine) };
}

function extractOneIndentBlock(lines: string[], startLine: number): { endLine: number } {
  const baseIndent = (lines[startLine]?.match(/^(\s*)/)?.[1] ?? '').length;
  for (let i = startLine + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const indent = (line.match(/^(\s*)/)?.[1] ?? '').length;
    if (indent <= baseIndent) return { endLine: i - 1 };
  }
  return { endLine: lines.length - 1 };
}

// ----- TS / JS / TSX regex extractor -----

interface RegexMatch {
  pattern: RegExp;
  kind: 'class' | 'interface' | 'function' | 'method' | 'variable' | 'enum' | 'import';
  /** Capture group indices for (name, bodyStart). */
  groups: { name?: number; depthEnd?: 'brace' | 'indent' | 'line' };
}

const TS_PATTERNS: RegexMatch[] = [
  { pattern: /^(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: 'class', groups: { name: 1, depthEnd: 'brace' } },
  { pattern: /^(?:export\s+)?(?:abstract\s+)?interface\s+([A-Za-z_$][\w$]*)/, kind: 'interface', groups: { name: 1, depthEnd: 'brace' } },
  { pattern: /^(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/, kind: 'function', groups: { name: 1, depthEnd: 'brace' } },
  { pattern: /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=]+)?=\s*(?:async\s+)?\(/, kind: 'function', groups: { name: 1, depthEnd: 'brace' } },
  { pattern: /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)/, kind: 'variable', groups: { name: 1 } },
  { pattern: /^(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)/, kind: 'enum', groups: { name: 1, depthEnd: 'brace' } },
  { pattern: /^(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/, kind: 'interface', groups: { name: 1, depthEnd: 'brace' } },
  { pattern: /^import\s+.*?from\s+['"]([^'"]+)['"]/, kind: 'import', groups: { name: 1 } },
];

function extractTS(source: string, filePath: string): ParseResult {
  const lines = source.split('\n');
  const entities: CodeEntity[] = [];
  const relations: CodeRelation[] = [];

  const fileEntity: CodeEntity = {
    id: makeId(filePath, filePath.split('/').pop() ?? filePath, 0, 'file'),
    kind: 'file',
    name: filePath.split('/').pop() ?? filePath,
    filePath,
    startLine: 0,
    endLine: lines.length - 1,
    language: 'typescript',
  };
  entities.push(fileEntity);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const def of TS_PATTERNS) {
      const m = def.pattern.exec(line);
      if (!m) continue;
      const name = def.groups.name !== undefined ? m[def.groups.name] : `<${def.kind}>`;

      if (def.kind === 'import') {
        const ent: CodeEntity = {
          id: makeId(filePath, name, i, 'module'),
          kind: 'module',
          name,
          filePath,
          startLine: i,
          endLine: i,
          language: 'typescript',
        };
        entities.push(ent);
        relations.push({ from: fileEntity.id, to: ent.id, kind: 'imports' });
        continue;
      }

      let endLine = i;
      if (def.groups.depthEnd === 'brace') {
        endLine = extractOneBraceBlock(lines, i).endLine;
      }
      const { signature, body } = captureLines(source, i, endLine);
      const kind: CodeEntity['kind'] =
        def.kind === 'method' ? 'method' : def.kind;
      const ent: CodeEntity = {
        id: makeId(filePath, name, i, kind),
        kind,
        name,
        filePath,
        startLine: i,
        endLine,
        signature,
        bodySnippet: trimSnippet(body),
        language: 'typescript',
      };
      entities.push(ent);
      relations.push({ from: fileEntity.id, to: ent.id, kind: 'contains' });
      break;
    }
  }

  return { filePath, language: 'typescript', entities, relations };
}

// ----- Python regex extractor -----

const PY_PATTERNS: RegexMatch[] = [
  { pattern: /^class\s+([A-Za-z_][\w]*)/, kind: 'class', groups: { name: 1, depthEnd: 'indent' } },
  { pattern: /^(?:async\s+)?def\s+([A-Za-z_][\w]*)/, kind: 'function', groups: { name: 1, depthEnd: 'indent' } },
  { pattern: /^(?:from\s+([\w.]+)\s+)?import\s+([\w.*]+)/, kind: 'import', groups: { name: 1 } },
];

function extractPython(source: string, filePath: string): ParseResult {
  const lines = source.split('\n');
  const entities: CodeEntity[] = [];
  const relations: CodeRelation[] = [];

  const fileEntity: CodeEntity = {
    id: makeId(filePath, filePath.split('/').pop() ?? filePath, 0, 'file'),
    kind: 'file',
    name: filePath.split('/').pop() ?? filePath,
    filePath,
    startLine: 0,
    endLine: lines.length - 1,
    language: 'python',
  };
  entities.push(fileEntity);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const def of PY_PATTERNS) {
      const m = def.pattern.exec(line);
      if (!m) continue;
      const name = def.groups.name !== undefined ? m[def.groups.name] : `<${def.kind}>`;
      if (def.kind === 'import') {
        const ent: CodeEntity = {
          id: makeId(filePath, name, i, 'module'),
          kind: 'module',
          name,
          filePath,
          startLine: i,
          endLine: i,
          language: 'python',
        };
        entities.push(ent);
        relations.push({ from: fileEntity.id, to: ent.id, kind: 'imports' });
        continue;
      }
      const endLine = extractOneIndentBlock(lines, i).endLine;
      const { signature, body } = captureLines(source, i, endLine);
      const kind: CodeEntity['kind'] =
        def.kind === 'class' ? 'class'
        : def.kind === 'function' ? 'function'
        : 'variable';
      const ent: CodeEntity = {
        id: makeId(filePath, name, i, kind),
        kind,
        name,
        filePath,
        startLine: i,
        endLine,
        signature: `def ${name}` && signature,
        bodySnippet: trimSnippet(body),
        language: 'python',
      };
      entities.push(ent);
      relations.push({ from: fileEntity.id, to: ent.id, kind: 'contains' });
      break;
    }
  }

  return { filePath, language: 'python', entities, relations };
}

// ----- Public parser -----

export class RegexCodeParser implements CodeParser {
  readonly name = 'regex-fallback' as const;
  readonly languages: string[] = ['typescript', 'tsx', 'javascript', 'python'];

  parse(filePath: string, source: string, language: string): ParseResult {
    const resolution = languageForExtension('.' + (filePath.split('.').pop() ?? ''));
    const resolvedLanguage = resolution?.language ?? language;
    if (resolvedLanguage === 'python') return extractPython(source, filePath);
    return extractTS(source, filePath);
  }

  canHandle(ext: string): boolean {
    return ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py'].includes(ext.toLowerCase());
  }
}
