// Code-intelligence types: shared by tokenize, extractors, conventions,
// learner, searchIndex, layer. The .agent-graph/state.json file is the
// canonical persistence form; in-memory it splits across CodeGraphSnapshot
// (entities + relations), ProjectArchetypeIndex, and ConventionReport.

export type EntityKind =
  | 'file'
  | 'module'
  | 'package'
  | 'class'
  | 'interface'
  | 'object'
  | 'enum'
  | 'companion'
  | 'function'
  | 'method'
  | 'field'
  | 'parameter'
  | 'variable'
  | 'constant'
  | 'annotation'
  | 'type'
  | 'unknown';

export type RelationKind =
  | 'contains'
  | 'inherits'
  | 'implements'
  | 'calls'
  | 'annotated_by'
  | 'imports'
  | 'returns'
  | 'has_parameter'
  | 'field_of'
  | 'extension_of'
  | 'references';

export interface CodeEntity {
  id: string;
  kind: EntityKind;
  name: string;
  qualifiedName?: string;
  filePath: string;
  startLine: number;
  endLine: number;
  signature?: string;
  bodySnippet?: string;
  docComment?: string;
  modifiers?: string[];
  annotations?: string[];
  archetype?: Archetype;
  archetypeConfidence?: 'high' | 'medium' | 'low';
  parentId?: string;
  language?: string;
  /** Qwen-derived role label, applied via `enrichEntity`. */
  semanticRole?: string;
  /** Qwen-derived short description. */
  semanticDescription?: string;
  /**
   * Brief Qwen-derived description of what this entity does and what it is
   * used for, generated from body content (NOT from docstrings). Populated
   * by `enrichDescriptions` during the scan pipeline; surfaces in the
   * search index so the user can find a class by what it does, not just
   * by name. Lives on the entity itself (rather than only in
   * `state.semantic`) so it's available offline / without a cache lookup.
   */
  description?: string;
  /** ISO timestamp of when `description` was generated. */
  descriptionGeneratedAt?: string;
}

export interface CodeRelation {
  from: string;
  to: string;
  kind: RelationKind;
}

export type Archetype =
  | 'controller'
  | 'service'
  | 'repository'
  | 'mapper'
  | 'dto'
  | 'filter'
  | 'middleware'
  | 'client'
  | 'gateway'
  | 'adapter'
  | 'producer'
  | 'consumer'
  | 'validator'
  | 'presenter'
  | 'view'
  | 'exception'
  | 'config'
  | 'test'
  | 'main'
  | 'util'
  | 'unknown';

export interface SemanticInfo {
  entityId: string;
  role: string;
  description: string;
  /** Why the entity exists in the project — Qwen-derived purpose. */
  purpose?: string;
  /** Other entities that reference this one (incoming edges, textual summary). */
  usedBy?: string;
  /** Other entities this one depends on (outgoing edges, textual summary). */
  dependsOn?: string;
  timestamp: number;
}

export interface ConventionReport {
  /** Per-file indented scripts → counts of 2sp / 4sp / tabs. */
  indent: { spaces2: number; spaces4: number; tabs: number; dominant: 'spaces2' | 'spaces4' | 'tabs' | 'mixed'; perFile?: Record<string, 'spaces2' | 'spaces4' | 'tabs'> };
  naming: {
    /** 'camelCase' / 'snake_case' / 'PascalCase' / 'UPPER_SNAKE' / 'mixed'. */
    functionStyle: string;
    classStyle: string;
    constantStyle: string;
  };
  imports: { top: Array<{ module: string; count: number }> };
  detectedFrameworks: string[];
  language: string;
  fileCount: number;
}

export interface PackageArchetypeRule {
  packageSig: string;
  archetype: Archetype;
  /** Glob-ish expression, learned from Qwen. */
  fileNamingPattern: string;
  /** Content markers (annotations, base classes, imports). */
  contentHints: string[];
  confidence: 'high' | 'medium' | 'low';
  learnedFrom: string[];
  timestamp: number;
  /** Source of the rule: 'qwen' (learned from content), 'static' (regex fallback). */
  source: 'qwen' | 'static';
}

export interface ProjectArchetypeIndex {
  projectFingerprint: string;
  rulesByPackage: Record<string, PackageArchetypeRule[]>;
  /** Cache: which rules assigned which file (from this or previous scans). */
  fileAssignment: Record<string, { archetype: Archetype; rulePackageSig: string; confidence: 'high' | 'medium' | 'low'; source: 'qwen' | 'static' }>;
}

export interface AgentState {
  version: 1;
  projectFingerprint: string;
  rootPath: string;
  lastScannedAt: string;
  totalFilesScanned: number;
  entities: CodeEntity[];
  relations: CodeRelation[];
  archetypes: ProjectArchetypeIndex;
  conventions: Record<string, ConventionReport>;
  semantic: Record<string, SemanticInfo>;
  stats: {
    totalEntities: number;
    byKind: Record<EntityKind, number>;
    byLanguage: Record<string, number>;
    archetypeCounts: Record<string, number>;
  };
}

export interface CodeParser {
  readonly name: string;
  readonly languages: string[];
  parse(filePath: string, source: string): { entities: CodeEntity[]; relations: CodeRelation[] };
  canHandle(lang: string): boolean;
}

/** Language classes. */
export type LangClass = 'brace' | 'indent' | 'markup';

export interface LanguageDescriptor {
  /** File extensions including the dot. */
  extensions: string[];
  /** Brace-based, indent-based, or markup/markup-like. */
  langClass: LangClass;
  /** BCP-47-ish tag used in `entities[].language`. */
  tag: string;
  /** Common name. */
  name: string;
}

export const LANGUAGES: Record<string, LanguageDescriptor> = {
  kotlin: { extensions: ['.kt', '.kts'], langClass: 'brace', tag: 'kotlin', name: 'Kotlin' },
  java: { extensions: ['.java'], langClass: 'brace', tag: 'java', name: 'Java' },
  scala: { extensions: ['.scala'], langClass: 'brace', tag: 'scala', name: 'Scala' },
  groovy: { extensions: ['.groovy'], langClass: 'brace', tag: 'groovy', name: 'Groovy' },
  typescript: { extensions: ['.ts'], langClass: 'brace', tag: 'typescript', name: 'TypeScript' },
  tsx: { extensions: ['.tsx'], langClass: 'brace', tag: 'tsx', name: 'TSX' },
  javascript: { extensions: ['.js', '.jsx', '.mjs', '.cjs'], langClass: 'brace', tag: 'javascript', name: 'JavaScript' },
  csharp: { extensions: ['.cs'], langClass: 'brace', tag: 'csharp', name: 'C#' },
  go: { extensions: ['.go'], langClass: 'brace', tag: 'go', name: 'Go' },
  rust: { extensions: ['.rs'], langClass: 'brace', tag: 'rust', name: 'Rust' },
  cpp: { extensions: ['.cpp', '.cc', '.cxx', '.hpp', '.hh', '.hxx'], langClass: 'brace', tag: 'cpp', name: 'C++' },
  c: { extensions: ['.c', '.h'], langClass: 'brace', tag: 'c', name: 'C' },
  swift: { extensions: ['.swift'], langClass: 'brace', tag: 'swift', name: 'Swift' },
  ruby: { extensions: ['.rb'], langClass: 'brace', tag: 'ruby', name: 'Ruby' },
  python: { extensions: ['.py'], langClass: 'indent', tag: 'python', name: 'Python' },
  yaml: { extensions: ['.yaml', '.yml'], langClass: 'markup', tag: 'yaml', name: 'YAML' },
  json: { extensions: ['.json'], langClass: 'markup', tag: 'json', name: 'JSON' },
  toml: { extensions: ['.toml'], langClass: 'markup', tag: 'toml', name: 'TOML' },
  markdown: { extensions: ['.md'], langClass: 'markup', tag: 'markdown', name: 'Markdown' },
};

export function languageForExtension(ext: string): { key: string; desc: LanguageDescriptor } | null {
  const e = ext.toLowerCase();
  for (const [key, desc] of Object.entries(LANGUAGES)) {
    if (desc.extensions.includes(e)) return { key, desc };
  }
  return null;
}

export const AGENT_STATE_VERSION = 1;
export const STATE_DIR_NAME = '.agent-graph';
export const STATE_FILE_NAME = 'state.json';
export const STATE_GITIGNORE_NAME = '.gitignore';
