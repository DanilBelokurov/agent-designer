// Per-package archetype learner.
//
// Given a project's file layout, group files into "packages" (by directory
// or by inferred package declaration) and ask Qwen to assign each file an
// archetype based on its filename + first ~200 lines of content. Apply the
// learned archetypes to the rest of the package via filename-pattern match.
//
// Caching: results are cached in `.agent-graph/state.json` under
// `archetypes.rulesByPackage[packageSig]`. Re-loading the project skips the
// Qwen round-trip entirely.

import type { Archetype, CodeEntity, PackageArchetypeRule, ProjectArchetypeIndex } from './types';
import { generateViaQwen } from '../qwenClient';
import { staticArchetypeFromAnnotations, staticArchetypeForFile } from './architecture';

const SAMPLES_PER_PACKAGE = 5;
const FILE_PREVIEW_LINES = 200;
const PACKAGE_SAMPLE_CHARS = 24000;
const REQUEST_TIMEOUT_MS = 60_000;

export interface PackageGroup {
  packageSig: string;
  files: Array<{ filePath: string; entities: CodeEntity[] }>;
}

interface QwenAssignment {
  fileName: string;
  archetype: string;
  confidence: string;
}

function dirPackageSig(filePath: string): string {
  const parts = filePath.split('/').filter(Boolean);
  if (parts.length <= 1) return '.';
  // use the deepest meaningful path component (last 2 segments)
  return parts.slice(0, -1).slice(-2).join('/');
}

function extractIdent(filePath: string): string {
  return filePath.split('/').pop() ?? filePath;
}

function joinSamples(samples: PackageGroup['files']): string {
  return samples
    .map((f) => {
      const fileName = extractIdent(f.filePath);
      const firstEntity = f.entities.find((e) => e.kind !== 'file' && e.kind !== 'module');
      const preview = firstEntity?.bodySnippet
        ? firstEntity.bodySnippet.split('\n').slice(0, FILE_PREVIEW_LINES).join('\n')
        : f.entities
            .filter((e) => e.signature)
            .map((e) => e.signature!)
            .slice(0, 6)
            .join('\n');
      return `--- ${fileName} ---\n${preview || '(no body preview)'}\n`;
    })
    .join('\n')
    .slice(0, PACKAGE_SAMPLE_CHARS);
}

function buildPrompt(group: PackageGroup, sampleCount: number): string {
  return [
    `You classify source files inside one package by their **archetype** —`,
    `the architectural role each file plays in the project, judged from its`,
    `filename AND the body content shown below.`,
    ``,
    `Package: ${group.packageSig}`,
    `Files in this package (sampled ${sampleCount} of ${group.files.length}):`,
    ``,
    joinSamples(group.files),
    ``,
    `For each file shown above, output ONE line in this exact format:`,
    `   <filename>|<archetype>|<confidence>`,
    ``,
    `Where <archetype> is one of (pick the role that best matches the file's`,
    `responsibility, NOT just the filename):`,
    ``,
    `  controller   — accepts inbound HTTP / RPC requests and routes them`,
    `                to a service layer (Spring @RestController, FastAPI`,
    `                @app.route, Express router, gRPC server impl).`,
    `  service      — application-level business logic; orchestrates other`,
    `                layers; often annotated @Service in Spring.`,
    `  repository   — persistence layer; CRUD against a DB / KV store / ORM`,
    `                (Spring Data, SQLAlchemy session, Mongoose model,`,
    `                Prisma client).`,
    `  client       — OUTBOUND HTTP / RPC caller; wraps an external API.`,
    `                Pattern: *Client, *ApiClient, *HttpClient, *FeignClient,`,
    `                requests.get / fetch / axios / got.`,
    `  gateway      — aggregates multiple backends / routes between protocols`,
    `                (API gateway, edge service, BFF).`,
    `  adapter      — translates between two incompatible interfaces`,
    `                (DB driver, protocol adapter, framework bridge).`,
    `  producer     — publishes events / messages outbound`,
    `                (@SendTo, EventEmitter.emit, Kafka producer, webhook).`,
    `  consumer     — subscribes to events / messages inbound`,
    `                (@KafkaListener, RabbitMQ consumer, EventEmitter.on).`,
    `  mapper       — converts between domain and DTO/persistence shapes`,
    `                (MapStruct, ModelMapper, manual toDto()/fromDto()).`,
    `  dto          — plain data carrier with no behaviour`,
    `                (record UserDto, dataclass, schema class).`,
    `  validator    — input validation rules`,
    `                (Bean Validation, Zod schema, request guards).`,
    `  presenter    — view-model glue layer (MVP/MVVM, @ControllerAdvice).`,
    `  view         — UI render unit (React component, Vue SFC, page).`,
    `  filter       — cross-cutting request filter / interceptor / guard.`,
    `  middleware   — cross-cutting pre/post-processing for a request.`,
    `  exception    — domain error / failure type / sealed Result.`,
    `  config       — configuration file (application.yml, package.json,`,
    `                settings.gradle, Dockerfile, Makefile, README).`,
    `  test         — *Test, *Spec, *_test.py, file under tests/.`,
    `  main         — entry point (main.py, Main.kt, index.ts).`,
    `  util         — generic helper with no domain meaning`,
    `                (StringUtils, DateHelper, paths/utils).`,
    `  unknown      — none of the above; briefly describe why in confidence.`,
    ``,
    `Distinguish carefully between:`,
    `  service  — ORCHESTRATES other layers (talks to repository, mapper)`,
    `  client   — CALLS an external API (outbound requests/grpc)`,
    `  gateway  — ROUTES between protocols / aggregates backends`,
    `  adapter  — TRANSLATES between two interfaces, often wraps a 3rd party lib.`,
    ``,
    `Distinguish between:`,
    `  dto      — pure data, no behaviour`,
    `  mapper   — has logic that converts between dto / entity / domain.`,
    ``,
    `Distinguish between:`,
    `  filter       — Spring @Component that intercepts BEFORE the controller`,
    `  interceptor  — Spring HandlerInterceptor (different lifecycle)`,
    `  middleware   — generic framework-level (Express, FastAPI, ASP.NET)`,
    ``,
    `Confidence: 'high' if the role is unambiguous from filename + content,`,
    `'medium' if filename alone would suffice, 'low' if you're guessing.`,
    `For low confidence, append a short tag after a pipe:`,
    `  'low|schema', 'low|protobuf', 'low|external-lib'`,
    ``,
    `Reply with ONLY the requested lines. No prose, no comments.`,
  ].join('\n');
}

function parseAssignments(raw: string): QwenAssignment[] {
  const out: QwenAssignment[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const m = /^(\S+)\|(\S+)\|(\S+)$/.exec(line.trim());
    if (!m) continue;
    out.push({ fileName: m[1], archetype: m[2].toLowerCase(), confidence: m[3] });
  }
  return out;
}

/**
 * Group files by package-signature (last 2 path segments). Files
 * referenced are CodeEntity-bearing files only (i.e. parsed code).
 */
export function groupFilesByPackage(
  entities: CodeEntity[],
): PackageGroup[] {
  const buckets = new Map<string, Array<{ filePath: string; entities: CodeEntity[] }>>();
  const entitiesByFile = new Map<string, CodeEntity[]>();
  for (const e of entities) {
    if (!e.filePath) continue;
    const arr = entitiesByFile.get(e.filePath) ?? [];
    arr.push(e);
    entitiesByFile.set(e.filePath, arr);
  }
  for (const [filePath, ents] of entitiesByFile) {
    const sig = dirPackageSig(filePath);
    const bucket = buckets.get(sig) ?? [];
    bucket.push({ filePath, entities: ents });
    buckets.set(sig, bucket);
  }
  return [...buckets.entries()].map(([packageSig, files]) => ({ packageSig, files }));
}

/**
 * Send one Qwen batch per package group; fall back to static heuristics per
 * file when Qwen is unavailable. Updates the supplied `index` in place.
 *
 * The optional `cache` is checked first — when the project fingerprint +
 * `packageSig` already has rules we skip the network call entirely.
 */
export async function learnArchetypes(args: {
  groups: PackageGroup[];
  index: ProjectArchetypeIndex;
  /** Existing rules keyed by `${projectFingerprint}|${packageSig}` — bypass Qwen when found. */
  cache?: Map<string, PackageArchetypeRule[]>;
  onProgress?: (current: number, total: number, pkg: string) => void;
}): Promise<{ usedFallback: boolean }> {
  const { groups, index, cache, onProgress } = args;

  let usedFallback = false;
  index.rulesByPackage = index.rulesByPackage ?? {};
  index.fileAssignment = index.fileAssignment ?? {};

  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    onProgress?.(i, groups.length, g.packageSig);

    const cachedKey = `${index.projectFingerprint}|${g.packageSig}`;
    const cachedRules = cache?.get(cachedKey);

    let rules: PackageArchetypeRule[] = [];
    if (cachedRules && cachedRules.length) {
      rules = cachedRules;
    } else {
      try {
        const samples = g.files.slice(0, SAMPLES_PER_PACKAGE);
        if (samples.length === 0) continue;
        const prompt = buildPrompt(g, samples.length);
        const raw = await Promise.race([
          generateViaQwen(prompt),
          new Promise<string>((_r, rej) => setTimeout(() => rej(new Error('timeout')), REQUEST_TIMEOUT_MS)),
        ]);
        const assignments = parseAssignments(raw);
        rules = assignments
          .filter((a) => a.fileName && a.archetype)
          .map((a) => ({
            packageSig: g.packageSig,
            archetype: normaliseArchetype(a.archetype),
            fileNamingPattern: deriveFilenamePattern(a.fileName),
            contentHints: extractHints(assignments, a),
            confidence: parseConfidence(a.confidence),
            learnedFrom: [findFile(g, a.fileName)].filter(Boolean) as string[],
            timestamp: Date.now(),
            source: 'qwen' as const,
          }));
      } catch {
        usedFallback = true;
      }
      if (!rules.length) rules = staticRulesForGroup(g);
    }

    index.rulesByPackage[g.packageSig] = rules;

    // Apply archetype labels to every file in the package via filename match.
    for (const f of g.files) {
      const fileName = extractIdent(f.filePath);
      const matched = matchRule(rules, fileName, f.entities);
      if (matched) {
        index.fileAssignment[f.filePath] = {
          archetype: matched.archetype,
          rulePackageSig: g.packageSig,
          confidence: matched.confidence,
          source: matched.source,
        };
      }
    }

    cache?.set(cachedKey, rules);
  }

  // Files that didn't get a learned rule fall back to static heuristics
  // when the consumer asks for them via the layer.
  return { usedFallback };
}

function normaliseArchetype(raw: string): Archetype {
  const s = raw.trim().toLowerCase();
  const known: Archetype[] = [
    'controller', 'service', 'repository', 'mapper', 'dto',
    'filter', 'middleware', 'client', 'gateway', 'adapter',
    'producer', 'consumer', 'validator', 'presenter', 'view',
    'exception', 'config', 'test', 'main', 'util', 'unknown',
  ];
  return (known.find((k) => k === s) ?? 'unknown') as Archetype;
}

function parseConfidence(raw: string): 'high' | 'medium' | 'low' {
  const r = raw.toLowerCase();
  if (r.startsWith('high')) return 'high';
  if (r.startsWith('low')) return 'low';
  return 'medium';
}

function deriveFilenamePattern(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, '');
  const suffix = stem.length >= 4 ? '*' + stem.slice(0, 4) + '*' : '*' + stem + '*';
  return `${stem.replace(/[A-Z]/g, (c) => c.toLowerCase())}|${suffix}`;
}

function extractHints(_all: QwenAssignment[], a: QwenAssignment): string[] {
  if (!/low/.test(a.confidence)) return [];
  const m = a.confidence.split('|')[1];
  return m ? [m.trim()] : [];
}

function findFile(g: PackageGroup, fileName: string): string | undefined {
  return g.files.find((f) => extractIdent(f.filePath) === fileName)?.filePath;
}

function matchRule(rules: PackageArchetypeRule[], fileName: string, entities: CodeEntity[]): PackageArchetypeRule | null {
  for (const rule of rules) {
    if (rule.source === 'qwen') {
      const re = globToRegex(rule.fileNamingPattern);
      if (re.test(fileName)) return rule;
    }
  }
  // annotation override (e.g. @RestController) wins over name patterns
  const annos = entities.flatMap((e) => e.annotations ?? []);
  const ann = staticArchetypeFromAnnotations(annos);
  if (ann) {
    const r = rules.find((r) => r.archetype === ann);
    if (r) return r;
  }
  return rules[0] ?? null;
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

/**
 * Fallback when Qwen is unavailable or returns nothing useful: assign
 * `static` rules from existing heuristics, one per file in the package.
 */
function staticRulesForGroup(g: PackageGroup): PackageArchetypeRule[] {
  const rules: PackageArchetypeRule[] = [];
  for (const f of g.files) {
    const fileName = extractIdent(f.filePath);
    const heuristic = staticArchetypeForFile(f.filePath);
    if (!heuristic) continue;
    rules.push({
      packageSig: g.packageSig,
      archetype: heuristic.archetype,
      fileNamingPattern: deriveFilenamePattern(fileName),
      contentHints: [],
      confidence: heuristic.confidence,
      learnedFrom: [f.filePath],
      timestamp: Date.now(),
      source: 'static',
    });
  }
  return rules;
}

/**
 * Compute a stable fingerprint for the picked project folder. Used as
 * the cache key for archetype rules and as the `projectFingerprint`
 * field in persisted state.
 */
export function projectFingerprintFor(rootPath: string, manifestNames: string[]): string {
  const sorted = [...manifestNames].sort().join('|');
  // FNV-1a (32-bit) over the joined key.
  let hash = 2166136261 >>> 0;
  const data = `${rootPath}::${sorted}`;
  for (let i = 0; i < data.length; i++) {
    hash ^= data.charCodeAt(i);
    hash = (hash * 16777619) >>> 0;
  }
  return `fp_${hash.toString(16).padStart(8, '0')}`;
}

/** Manifest filenames used as cache key. */
export const MANIFEST_NAMES = [
  'pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts',
  'package.json', 'Cargo.toml', 'go.mod', 'pyproject.toml', 'requirements.txt',
  'composer.json', 'Gemfile', 'Project.toml',
];
