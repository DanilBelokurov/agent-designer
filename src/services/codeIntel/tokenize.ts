// Comment stripping + brace tracking + indent tracking. Universal across
// brace-based languages. The brace tracker is comment- and string-literal-
// aware so it doesn't get fooled by braces that appear inside comments or
// JS/TS string templates.

const SNIPPET_LINES = 24;
const SNIPPET_CHARS = 2400;

export function trimSnippet(s: string): string {
  const lines = s.split('\n');
  let trimmed = lines.slice(0, SNIPPET_LINES).join('\n');
  if (lines.length > SNIPPET_LINES) trimmed += '\n…';
  if (trimmed.length > SNIPPET_CHARS) {
    trimmed = trimmed.slice(0, SNIPPET_CHARS - 1) + '\n…';
  }
  return trimmed;
}

export function docCommentLines(lines: string[], beforeIdx: number): string | undefined {
  const buf: string[] = [];
  for (let i = beforeIdx - 1; i >= 0 && i >= beforeIdx - 12; i--) {
    const t = lines[i].trim();
    if (!t) continue;
    if (t.startsWith('//') || t.startsWith('#') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('*/') || t.startsWith('///') || t.startsWith('<!--')) {
      buf.unshift(t);
      continue;
    }
    if (t.startsWith('[') || t.startsWith('@')) {
      // Annotation / attribute — treat as separator
      continue;
    }
    if (t.length < 200 && /^\/\*\*?/.test(t)) {
      buf.unshift(t);
      continue;
    }
    break;
  }
  return buf.length ? buf.join('\n') : undefined;
}

/**
 * Strip comments from source according to language class.
 *
 * Brace languages typically use `//` and block comments. We keep string
 * literals intact but recognise that braces inside them shouldn't shift
 * brace depth.
 *
 * Indent languages (Python) use `#` line comments and triple-quoted strings
 * that we mostly preserve verbatim.
 *
 * Markup languages use HTML-style comments or `#`-style, but we don't
 * extract entities from them anyway, so the function only does brace +
 * indent.
 */
export function stripCommentsForLangClass(source: string, langClass: 'brace' | 'indent'): string {
  if (langClass === 'indent') {
    // Python: strip `# …` line comments only. Preserve triple-quoted
    // docstrings verbatim.
    const SQUOTE3 = String.fromCharCode(39, 39, 39);
    const DQUOTE3 = String.fromCharCode(34, 34, 34);
    const sq = new RegExp(SQUOTE3 + '[\\s\\S]*?' + SQUOTE3, 'g');
    const dq = new RegExp(DQUOTE3 + '[\\s\\S]*?' + DQUOTE3, 'g');
    return source
      .replace(/^[ \t]*#.*$/gm, (line) => ' '.repeat(line.length))
      .replace(sq, (m) => m) // preserve single-quoted docstrings
      .replace(dq, (m) => m); // preserve double-quoted docstrings
  }
  // Brace: strip line comments `// …` and block comments `/* … */`.
  // Use a tiny state machine so we don't rewrite braces inside strings.
  const out: string[] = [];
  let i = 0;
  let start = 0;
  let inLineComment = false;
  let inBlockComment = false;
  let inString: '"' | "'" | '`' | null = null;
  let escape = false;

  for (; i < source.length; i++) {
    if (inLineComment) {
      if (source[i] === '\n') {
        inLineComment = false;
        out.push(source.slice(start, i));
        start = i;
      }
      continue;
    }
    if (inBlockComment) {
      if (source[i] === '*' && source[i + 1] === '/') {
        // replace block-comment with blanks to keep line numbers
        out.push(' '.repeat(2));
        i++; // skip '/'
        inBlockComment = false;
        start = i + 1;
      }
      continue;
    }
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (source[i] === '\\') {
        escape = true;
        continue;
      }
      if (source[i] === inString) {
        inString = null;
      }
      continue;
    }
    // normal mode
    if (source[i] === '"' || source[i] === "'" || source[i] === '`') {
      inString = source[i] as '"' | "'" | '`';
      continue;
    }
    if (source[i] === '/' && source[i + 1] === '/') {
      // close out current line and start a line-comment
      out.push(source.slice(start, i));
      i++; // skip second slash
      inLineComment = true;
      start = i + 1;
      continue;
    }
    if (source[i] === '/' && source[i + 1] === '*') {
      out.push(source.slice(start, i));
      i++;
      inBlockComment = true;
      start = i + 1;
      continue;
    }
    if (source[i] === '\n') {
      out.push(source.slice(start, i));
      start = i;
    }
  }
  if (start < source.length) out.push(source.slice(start));
  return out.join('');
}

/**
 * Walk the (comment-stripped) source tracking brace depth, with awareness of
 * strings and template literals so braces inside them don't change depth.
 *
 * Yields for every `{ ... }` block at any depth: `{ startOffset, endOffset, depth }`.
 */
export function* iterateBraceBlocks(source: string): Generator<{ startOffset: number; endOffset: number; depth: number }> {
  let i = 0;
  let depth = 0;
  let openStack: number[] = [];
  let inString: '"' | "'" | '`' | null = null;
  let escape = false;

  while (i < source.length) {
    const ch = source[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === inString) {
        inString = null;
      }
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch as '"' | "'" | '`';
      i++;
      continue;
    }
    if (ch === '{') {
      openStack.push(i);
      depth++;
      i++;
      continue;
    }
    if (ch === '}') {
      if (openStack.length) {
        const startOff = openStack.pop()!;
        depth--;
        yield { startOffset: startOff, endOffset: i, depth: depth + 1 };
      }
      i++;
      continue;
    }
    i++;
  }
}

/**
 * Convert offset → line number (0-based) by counting `\n` until offset.
 */
export function lineAt(source: string, offset: number): number {
  let n = 0;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === '\n') n++;
  }
  return n;
}

/**
 * Convert line → offset (start of that line).
 */
export function start(source: string, line: number): number {
  if (line < 0) return 0;
  let l = 0;
  let i = 0;
  while (i < source.length && l < line) {
    if (source[i] === '\n') l++;
    i++;
  }
  return i;
}

/**
 * Split source into lines (lossless, line counts preserved).
 */
export function splitLines(source: string): string[] {
  return source.split(/\r?\n/);
}
