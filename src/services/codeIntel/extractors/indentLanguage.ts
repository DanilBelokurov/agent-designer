// Indent-language extractor for Python (and any other whitespace-sensitive
// language we add later). Block bodies are computed via leading-whitespace
// deltas, not via brace counting.

import type { CodeEntity, CodeRelation } from '../types';
import { splitLines, stripCommentsForLangClass, trimSnippet, docCommentLines } from '../tokenize';

const ANNOTATION_RE = /^[ \t]*@([A-Za-z_][\w.]*)/;
const MAX_LOOKBACK_FOR_ANNOTATIONS = 6;

interface AnnotatedLine {
  annotations: string[];
  decorators: string[];
}

function precedingDecorators(lines: string[], headerLine: number): AnnotatedLine {
  const anns: string[] = [];
  const decs: string[] = [];
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
  return { annotations: anns, decorators: decs };
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

  const entities: CodeEntity[] = [fileEntity];
  const relations: CodeRelation[] = [];

  const blockHeaderRegex = /^[ \t]*(?:async\s+)?(?:def|class)\s+([A-Za-z_][\w]*)/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = blockHeaderRegex.exec(line);
    if (!m) continue;
    const name = m[1];
    const startLine = i;
    const kind = m[0].includes('class') ? 'class' : 'function';

    // Find base indent — indentation of the header line.
    const baseIndent = line.match(/^[ \t]*/)?.[0].length ?? 0;

    // Find end of block: first following line whose non-empty indentation is ≤ baseIndent.
    let j = i + 1;
    while (j < lines.length) {
      const l = lines[j];
      if (l.trim() === '') {
        j++;
        continue;
      }
      const ind = l.match(/^[ \t]*/)?.[0].length ?? 0;
      if (ind <= baseIndent) break;
      j++;
    }

    const endLine = Math.max(i, j - 1);
    const body = lines.slice(i, j).join('\n');
    const snippet = trimSnippet(body);
    const doc = docCommentLines(lines, startLine);
    const { annotations } = precedingDecorators(lines, startLine);

    const id = `${filePath}::${kind}::${name}::${startLine}`;
    entities.push({
      id,
      kind,
      name,
      filePath,
      startLine,
      endLine,
      signature: line.trim(),
      bodySnippet: snippet,
      docComment: doc,
      annotations: annotations.length ? annotations : undefined,
      language,
    });
    relations.push({ from: fileEntity.id, to: id, kind: 'contains' });

    i = endLine;
  }

  // Imports
  const importRe = /^[ \t]*(?:from\s+([\w.]+)\s+)?import\s+([\w.*,\s]+)(?:\s+as\s+[\w.]+)?/gm;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(cleaned))) {
    const range = `from ${m[1]} import ${m[2]}`.slice(0, 100);
    entities.push({
      id: `mod:${language}:${m.index}`,
      kind: 'module',
      name: range,
      filePath: '',
      startLine: sourceIndexToLine(cleaned, m.index),
      endLine: sourceIndexToLine(cleaned, m.index),
      language,
    });
    relations.push({ from: fileEntity.id, to: `mod:${language}:${m.index}`, kind: 'imports' });
  }

  return { entities, relations };
}

function sourceIndexToLine(source: string, offset: number): number {
  let n = 0;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === '\n') n++;
  }
  return n;
}
