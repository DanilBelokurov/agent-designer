// A unified `parseFile` that first tries tree-sitter (when its WASM grammar is
// available for the file's language) and falls back to the regex extractor.
// Centralised so callers don't have to know which parser ran.

import type { CodeParser, ParseResult } from './codeGraph';
import { languageForExtension } from './loader';
import { TreeSitterCodeParser } from './tsExtractor';
import { RegexCodeParser } from './regexExtractor';

const treeSitter = new TreeSitterCodeParser();
const regex = new RegexCodeParser();
const tsAvailability = new Map<string, Promise<boolean>>();

async function languageAvailableViaTs(ext: string): Promise<boolean> {
  const cached = tsAvailability.get(ext);
  if (cached) return cached;
  const p = (async () => {
    try {
      const result = await treeSitter.parseFile('probe' + ext, '');
      return result !== null;
    } catch {
      return false;
    }
  })();
  tsAvailability.set(ext, p);
  return p;
}

export interface ParserRunOptions {
  /** Force the regex parser regardless of tree-sitter availability (useful in tests). */
  force?: 'tree-sitter' | 'regex';
}

export async function runParserForFile(
  filePath: string,
  source: string,
  options: ParserRunOptions = {},
): Promise<{ result: ParseResult; parser: CodeParser['name'] } | null> {
  const resolution = languageForExtension('.' + (filePath.split('.').pop() ?? ''));
  if (!resolution) return null;

  if (options.force === 'regex') {
    const r = regex.parse(filePath, source, resolution.language);
    return { result: r, parser: 'regex-fallback' };
  }

  try {
    const tsAssetUrl = resolution.asset.url;
    if (tsAssetUrl) {
      await languageAvailableViaTs('.' + (filePath.split('.').pop() ?? ''));
    }
  } catch {
    /* ignore */
  }

  try {
    const r = await treeSitter.parseFile(filePath, source);
    if (r) return { result: r, parser: 'tree-sitter' };
  } catch {
    /* fall through */
  }

  const r = regex.parse(filePath, source, resolution.language);
  return { result: r, parser: 'regex-fallback' };
}
