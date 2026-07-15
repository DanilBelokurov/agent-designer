// Domain types for the code graph and the parser interface.

export type EntityKind =
  | 'file'
  | 'module'
  | 'class'
  | 'interface'
  | 'function'
  | 'method'
  | 'variable'
  | 'annotation'
  | 'enum';

export type RelationKind =
  | 'contains'
  | 'inherits'
  | 'implements'
  | 'calls'
  | 'annotated_by'
  | 'imports';

export interface CodeEntity {
  id: string;
  kind: EntityKind;
  /** Symbol name as written in source (e.g. `MyClass`, `getUser`). */
  name: string;
  /** For nested symbols (e.g. `MyClass.getUser`). Optional — not all entities have one. */
  qualifiedName?: string;
  /** Path to the containing source file, relative to the scanned root. */
  filePath: string;
  /** 0-based line number where the symbol starts. */
  startLine: number;
  /** 0-based inclusive line where the symbol ends. */
  endLine: number;
  /** Best-effort signature/header (e.g. `function parse(input: string): number`). */
  signature?: string;
  /** Truncated source body. */
  bodySnippet?: string;
  /** JSDoc / doc comment immediately preceding the symbol, if any. */
  docComment?: string;
  /** For methods: id of the owning class/interface. */
  parentId?: string;
  /** Source language. */
  language?: string;
}

export interface CodeRelation {
  from: string;
  to: string;
  kind: RelationKind;
}

export interface ParseResult {
  /** Path the source belongs to (relative to scanned root). */
  filePath: string;
  /** Detected / configured language for the file. */
  language: string;
  entities: CodeEntity[];
  relations: CodeRelation[];
}

export interface CodeParser {
  /** Identifier suitable for telemetry / logging. */
  readonly name: 'tree-sitter' | 'regex-fallback';
  /** List of language identifiers this parser can handle. */
  readonly languages: string[];
  parse(filePath: string, source: string, language: string): ParseResult;
}
