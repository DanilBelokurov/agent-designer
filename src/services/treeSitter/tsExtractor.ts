// Tree-sitter based entity extractor.
//
// Walks the parsed tree and pulls out functions, classes, methods, interfaces,
// and top-level declarations for TypeScript/JavaScript/Python. Designed to
// stay useful for downstream prompt assembly — captures signature, location,
// and a truncated body for every extracted entity.

import type { Node, Tree } from 'web-tree-sitter';
import {
  detectAvailableGrammars,
  getLanguage,
  languageForExtension,
} from './loader';
import type { LanguageResolution } from './loader';
import type {
  CodeEntity,
  CodeParser,
  CodeRelation,
  ParseResult,
} from './codeGraph';

const SNIPPET_MAX = 24; // lines
const SNIPPET_MAX_TOTAL_CHARS = 2400;

function trimSnippet(s: string): string {
  const lines = s.split('\n');
  let trimmed = lines.slice(0, SNIPPET_MAX).join('\n');
  if (lines.length > SNIPPET_MAX) trimmed += '\n…';
  if (trimmed.length > SNIPPET_MAX_TOTAL_CHARS) {
    trimmed = trimmed.slice(0, SNIPPET_MAX_TOTAL_CHARS) + '\n…';
  }
  return trimmed;
}

function nodeText(node: Node): string {
  return node.text ?? '';
}

function findChild(node: Node, type: string): Node | null {
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c && c.type === type) return c;
  }
  return null;
}

function fieldChild(node: Node, fieldName: string): Node | null {
  return node.childForFieldName(fieldName);
}

function textByField(node: Node, fieldName: string): string {
  const c = fieldChild(node, fieldName);
  return c ? nodeText(c) : '';
}

function firstLineOfSignature(node: Node, source: string): string | null {
  const lines = source.split(/\r?\n/);
  for (let i = node.startPosition.row; i <= node.endPosition.row && i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    return line;
  }
  return null;
}

function entityId(filePath: string, name: string, line: number, kind: string): string {
  return `${filePath}::${kind}::${name}::${line}`;
}

function pushEntity(entities: CodeEntity[], e: Omit<CodeEntity, 'id'>): CodeEntity {
  const ent: CodeEntity = { ...e, id: entityId(e.filePath, e.name, e.startLine, e.kind) };
  entities.push(ent);
  return ent;
}

// ---------- TypeScript / JavaScript extraction ----------

function extractEntities_TS(
  tree: Tree,
  filePath: string,
  source: string,
  language: string,
): { entities: CodeEntity[]; relations: CodeRelation[] } {
  const entities: CodeEntity[] = [];
  const relations: CodeRelation[] = [];
  let fileEntity: CodeEntity | undefined;

  const visit = (n: Node, parent: CodeEntity | undefined): void => {
    if (!n) return;
    switch (n.type) {
      case 'function_declaration': {
        const name = textByField(n, 'name') || '<anonymous>';
        const sig = firstLineOfSignature(n, source) ?? `function ${name}`;
        const entity = pushEntity(entities, {
          kind: 'function',
          name,
          signature: sig,
          filePath,
          startLine: n.startPosition.row,
          endLine: n.endPosition.row,
          bodySnippet: trimSnippet(nodeText(n)),
          language,
        });
        if (parent) relations.push({ from: parent.id, to: entity.id, kind: 'contains' });
        else if (fileEntity) relations.push({ from: fileEntity.id, to: entity.id, kind: 'contains' });
        return;
      }
      case 'generator_function_declaration': {
        const name = textByField(n, 'name') || '<anonymous>';
        const entity = pushEntity(entities, {
          kind: 'function',
          name,
          signature: `function* ${name}`,
          filePath,
          startLine: n.startPosition.row,
          endLine: n.endPosition.row,
          bodySnippet: trimSnippet(nodeText(n)),
          language,
        });
        if (fileEntity) relations.push({ from: fileEntity.id, to: entity.id, kind: 'contains' });
        return;
      }
      case 'class_declaration':
      case 'class': {
        const name = textByField(n, 'name') || '<anonymous>';
        const entity = pushEntity(entities, {
          kind: 'class',
          name,
          signature: `class ${name}`,
          filePath,
          startLine: n.startPosition.row,
          endLine: n.endPosition.row,
          bodySnippet: trimSnippet(nodeText(n)),
          language,
        });
        if (parent) relations.push({ from: parent.id, to: entity.id, kind: 'contains' });
        else if (fileEntity) relations.push({ from: fileEntity.id, to: entity.id, kind: 'contains' });
        const classBody = findChild(n, 'class_body') ?? n;
        walkChildren(classBody, entity);
        return;
      }
      case 'interface_declaration': {
        const name = textByField(n, 'name') || '<anonymous>';
        const entity = pushEntity(entities, {
          kind: 'interface',
          name,
          signature: `interface ${name}`,
          filePath,
          startLine: n.startPosition.row,
          endLine: n.endPosition.row,
          bodySnippet: trimSnippet(nodeText(n)),
          language,
        });
        if (fileEntity) relations.push({ from: fileEntity.id, to: entity.id, kind: 'contains' });
        return;
      }
      case 'method_definition': {
        const name = textByField(n, 'name') || '<method>';
        const entity: CodeEntity = {
          id: entityId(filePath, name, n.startPosition.row, 'method'),
          kind: 'method',
          name,
          signature: firstLineOfSignature(n, source) ?? name,
          filePath,
          startLine: n.startPosition.row,
          endLine: n.endPosition.row,
          bodySnippet: trimSnippet(nodeText(n)),
          language,
        };
        entities.push(entity);
        if (parent) relations.push({ from: parent.id, to: entity.id, kind: 'contains' });
        return;
      }
      case 'import_statement': {
        const source_name = textByField(n, 'source').replace(/^['"]|['"]$/g, '');
        if (!fileEntity) return;
        const importedEntity = pushEntity(entities, {
          kind: 'module',
          name: source_name,
          filePath,
          startLine: n.startPosition.row,
          endLine: n.endPosition.row,
          language,
        });
        relations.push({ from: fileEntity.id, to: importedEntity.id, kind: 'imports' });
        return;
      }
      case 'export_statement': {
        walkChildren(n, parent);
        return;
      }
      case 'variable_declarator': {
        const name = textByField(n, 'name') || '<var>';
        const valueNode = findChild(n, 'arrow_function');
        if (valueNode && valueNode.type === 'arrow_function') {
          const entity = pushEntity(entities, {
            kind: 'function',
            name,
            signature: firstLineOfSignature(n, source) ?? `const ${name} = (…) => …`,
            filePath,
            startLine: n.startPosition.row,
            endLine: n.endPosition.row,
            bodySnippet: trimSnippet(nodeText(n)),
            language,
          });
          if (fileEntity) relations.push({ from: fileEntity.id, to: entity.id, kind: 'contains' });
          return;
        }
        const entity = pushEntity(entities, {
          kind: 'variable',
          name,
          filePath,
          startLine: n.startPosition.row,
          endLine: n.endPosition.row,
          signature: firstLineOfSignature(n, source) ?? `const ${name}`,
          bodySnippet: trimSnippet(nodeText(n)),
          language,
        });
        if (fileEntity) relations.push({ from: fileEntity.id, to: entity.id, kind: 'contains' });
        return;
      }
      case 'enum_declaration': {
        const name = textByField(n, 'name') || '<enum>';
        const entity = pushEntity(entities, {
          kind: 'enum',
          name,
          filePath,
          startLine: n.startPosition.row,
          endLine: n.endPosition.row,
          signature: `enum ${name}`,
          bodySnippet: trimSnippet(nodeText(n)),
          language,
        });
        if (fileEntity) relations.push({ from: fileEntity.id, to: entity.id, kind: 'contains' });
        return;
      }
      case 'lexical_declaration': {
        walkChildren(n, parent);
        return;
      }
      default:
        break;
    }
  };

  const walkChildren = (root: Node, parent: CodeEntity | undefined): void => {
    for (let i = 0; i < root.childCount; i++) {
      const c = root.child(i);
      if (!c) continue;
      visit(c, parent);
    }
  };

  fileEntity = pushEntity(entities, {
    kind: 'file',
    name: filePath.split('/').pop() ?? filePath,
    filePath,
    startLine: 0,
    endLine: source ? source.split(/\r?\n/).length - 1 : 0,
    language,
  });

  walkChildren(tree.rootNode, undefined);

  return { entities, relations };
}

// ---------- Python extraction ----------

function extractEntities_Python(
  tree: Tree,
  filePath: string,
  source: string,
): { entities: CodeEntity[]; relations: CodeRelation[] } {
  const entities: CodeEntity[] = [];
  const relations: CodeRelation[] = [];
  let fileEntity: CodeEntity | undefined;

  const visit = (n: Node, parent: CodeEntity | undefined): void => {
    if (n.type === 'function_definition') {
      const name = textByField(n, 'name') || '<fn>';
      const argsNode = findChild(n, 'parameters');
      const sig = `def ${name}${argsNode ? nodeText(argsNode) : '()'}`;
      const entity = pushEntity(entities, {
        kind: 'function',
        name,
        signature: sig,
        filePath,
        startLine: n.startPosition.row,
        endLine: n.endPosition.row,
        bodySnippet: trimSnippet(nodeText(n)),
        language: 'python',
      });
      if (parent) relations.push({ from: parent.id, to: entity.id, kind: 'contains' });
      else if (fileEntity) relations.push({ from: fileEntity.id, to: entity.id, kind: 'contains' });
      return;
    }
    if (n.type === 'class_definition') {
      const name = textByField(n, 'name') || '<cls>';
      const entity = pushEntity(entities, {
        kind: 'class',
        name,
        signature: `class ${name}`,
        filePath,
        startLine: n.startPosition.row,
        endLine: n.endPosition.row,
        bodySnippet: trimSnippet(nodeText(n)),
        language: 'python',
      });
      if (parent) relations.push({ from: parent.id, to: entity.id, kind: 'contains' });
      else if (fileEntity) relations.push({ from: fileEntity.id, to: entity.id, kind: 'contains' });
      const block = findChild(n, 'block');
      if (block) walkChildren(block, entity);
      return;
    }
    if (n.type === 'import_statement' || n.type === 'import_from_statement') {
      const module = n.type === 'import_from_statement' ? textByField(n, 'module_name') : n.text;
      if (!module || !fileEntity) return;
      const modEntity = pushEntity(entities, {
        kind: 'module',
        name: module,
        filePath,
        startLine: n.startPosition.row,
        endLine: n.endPosition.row,
        language: 'python',
      });
      relations.push({ from: fileEntity.id, to: modEntity.id, kind: 'imports' });
      return;
    }
    if (n.type === 'decorated_definition') {
      walkChildren(n, parent);
      return;
    }
  };

  const walkChildren = (root: Node, parent: CodeEntity | undefined): void => {
    for (let i = 0; i < root.childCount; i++) {
      const c = root.child(i);
      if (!c) continue;
      visit(c, parent);
    }
  };

  fileEntity = pushEntity(entities, {
    kind: 'file',
    name: filePath.split('/').pop() ?? filePath,
    filePath,
    startLine: 0,
    endLine: source ? source.split(/\r?\n/).length - 1 : 0,
    language: 'python',
  });

  walkChildren(tree.rootNode, undefined);
  return { entities, relations };
}

// ---------- Parser adapter ----------

export class TreeSitterCodeParser implements CodeParser {
  readonly name = 'tree-sitter' as const;
  readonly languages: string[] = [];

  async detectLanguages(): Promise<string[]> {
    return detectAvailableGrammars();
  }

  /**
   * Synchronous parse — not supported by the tree-sitter adapter (loaders are async).
   * Use `parseFile` instead.
   */
  parse(_filePath: string, _source: string, _language: string): ParseResult {
    throw new Error('TreeSitterCodeParser.parseFile is async — use parseFile instead');
  }

  async parseFile(filePath: string, source: string): Promise<ParseResult | null> {
    const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
    const resolution = languageForExtension(ext);
    if (!resolution) return null;
    const langObj = await getLanguage(resolution.language);
    const mod = await import('web-tree-sitter');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wtsMod = mod as any;
    const ParserCtor = (wtsMod.default?.Parser ?? wtsMod.Parser) as typeof import('web-tree-sitter').Parser;
    const p = new ParserCtor();
    p.setLanguage(langObj);
    const tree = p.parse(source);
    if (!tree) return null;
    return extractForResolution(tree, filePath, source, resolution);
  }
}

function extractForResolution(
  tree: Tree,
  filePath: string,
  source: string,
  resolution: LanguageResolution,
): ParseResult {
  if (resolution.language === 'python') {
    const r = extractEntities_Python(tree, filePath, source);
    return { filePath, language: 'python', ...r };
  }
  const r = extractEntities_TS(tree, filePath, source, resolution.language);
  return { filePath, language: resolution.language, ...r };
}

export function isTreeSitterLanguage(lang: string): boolean {
  return ['typescript', 'tsx', 'javascript', 'python'].includes(lang);
}
