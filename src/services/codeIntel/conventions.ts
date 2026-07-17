// Convention sniffer — runs over a sample of parsed code and produces a
// report: indentation style, naming conventions, top imports, detected
// frameworks. Per-language aggregation (since a Kotlin project and a Python
// file in the same project will both want their own report).

import type { CodeEntity, ConventionReport } from './types';

const FRAMEWORK_KEYWORDS: Array<{ name: string; re: RegExp }> = [
  { name: 'Spring', re: /@SpringBoot[A-Za-z]*\b|org\.springframework\.|spring-boot-starter/i },
  { name: 'Spring Data', re: /@SpringBootApplication|@Repository\b|org\.springframework\.data\./i },
  { name: 'Spring Security', re: /@EnableWebSecurity|@PreAuthorize|SpringSecurity/i },
  { name: 'Jakarta EE', re: /jakarta\.(persistence|servlet|ejb|validation|ws)\./i },
  { name: 'Quarkus', re: /@QuarkusTest|io\.quarkus\./i },
  { name: 'Micronaut', re: /io\.micronaut\./i },
  { name: 'Android', re: /androidx\.|android\.(app|view|content)\./i },
  { name: 'Flutter', re: /^package:flutter\//m },
  { name: 'Ktor', re: /io\.ktor\./i },
  { name: 'Hibernate', re: /org\.hibernate\./i },
  { name: 'Reactor', re: /reactor\.(core|util|net)/i },
  { name: 'RxJava', re: /io\.reactivex\./i },
  { name: 'Jackson', re: /com\.fasterxml\.jackson\./i },
  { name: 'JUnit', re: /org\.junit\.|@org\.junit\.jupiter\./i },
  { name: 'TestNG', re: /org\.testng\./i },
  { name: 'Mockito', re: /org\.mockito\.|mockito-(inline|core)/i },
  { name: 'JUnit 5 Jupiter', re: /org\.junit\.jupiter\.api\./i },
  { name: 'Kotest', re: /io\.kotest\.|@kotest/i },
  { name: 'Express', re: /require\(['"]express['"]\)|from ['"]express['"]/i },
  { name: 'Fastify', re: /require\(['"]fastify['"]\)|from ['"]fastify['"]/i },
  { name: 'NestJS', re: /@nestjs\/(core|common|platform)/i },
  { name: 'React', re: /from ['"]react['"]|require\(['"]react['"]\)/i },
  { name: 'Vue', re: /from ['"]vue['"]|require\(['"]vue['"]\)/i },
  { name: 'Next.js', re: /from ['"]next['"]|require\(['"]next['"]\)/i },
  { name: 'Django', re: /from django\.|import django\b/i },
  { name: 'Flask', re: /from flask import|import flask\b/i },
  { name: 'FastAPI', re: /fastapi\.|from fastapi import/i },
  { name: 'SQLAlchemy', re: /sqlalchemy\b/i },
  { name: 'Alpine.js', re: /from ['"]alpinejs['"]|require\(['"]alpinejs['"]\)/i },
  { name: 'Tailwind', re: /@tailwind\s+css/i },
  { name: 'Hibernate Validator', re: /javax\.validation\.|jakarta\.validation\./i },
  { name: 'MapStruct', re: /org\.mapstruct\./i },
  { name: 'Lombok', re: /lombok\.|@lombok\./i },
];

const NAME_PATTERNS = {
  snake: /^[a-z][a-z0-9_]*$/,
  snakeUpper: /^[A-Z][A-Z0-9_]*$/,
  camel: /^[a-z][a-zA-Z0-9]*$/,
  pascal: /^[A-Z][a-zA-Z0-9]*$/,
  kebab: /^[a-z][a-z0-9-]*$/,
  dot: /^[a-z][a-zA-Z0-9.]*$/,
} as const;

type NameStyle = keyof typeof NAME_PATTERNS | 'mixed';

function classifyName(s: string): NameStyle {
  for (const [style, re] of Object.entries(NAME_PATTERNS)) {
    if (re.test(s)) return style as NameStyle;
  }
  return 'mixed';
}

function dominant<T extends string>(counts: Record<T, number>): T | 'mixed' {
  let best: T | 'mixed' = 'mixed';
  let bestCount = 0;
  let total = 0;
  for (const k of Object.keys(counts) as T[]) {
    const v = counts[k];
    total += v;
    if (v > bestCount) {
      best = k;
      bestCount = v;
    }
  }
  if (bestCount * 2 > total) return best;
  return 'mixed';
}

export interface ConventionsInput {
  /** Map of `language → [fileContents...]`. */
  byLanguage: Record<
    string,
    Array<{ path: string; content: string; entities: CodeEntity[] }>
  >;
}

export function detectConventions(input: ConventionsInput): Record<string, ConventionReport> {
  const out: Record<string, ConventionReport> = {};
  for (const [language, files] of Object.entries(input.byLanguage)) {
    if (!files.length) continue;
    out[language] = sniffLanguage(language, files);
  }
  return out;
}

function sniffLanguage(language: string, files: ConventionsInput['byLanguage'][string]): ConventionReport {
  let spaces2 = 0;
  let spaces4 = 0;
  let tabs = 0;
  const functionCounts: Record<string, number> = {};
  const classCounts: Record<string, number> = {};
  const constantCounts: Record<string, number> = {};
  const importCounts = new Map<string, number>();
  const frameworkHits = new Map<string, number>();

  for (const f of files) {
    const lines = f.content.split('\n');
    for (const line of lines) {
      const m = line.match(/^(\s*)\S/);
      if (m) {
        const ws = m[1];
        if (ws.length === 0) continue;
        if (ws.includes('\t')) tabs++;
        else if (ws.length % 4 === 0) spaces4++;
        else if (ws.length % 2 === 0) spaces2++;
      }
    }
    for (const e of f.entities) {
      if (e.kind === 'function' || e.kind === 'method') {
        const style = classifyName(e.name);
        functionCounts[style] = (functionCounts[style] ?? 0) + 1;
      } else if (e.kind === 'class' || e.kind === 'object' || e.kind === 'interface' || e.kind === 'enum') {
        const style = classifyName(e.name);
        classCounts[style] = (classCounts[style] ?? 0) + 1;
      } else if (e.kind === 'module' && e.name) {
        // crude constant heuristic for Kotlin/JS const declarations via signature
        if (/[A-Z_]+\s+[A-Z_]+/.test(e.signature ?? '')) {
          const style = classifyName(e.name);
          constantCounts[style] = (constantCounts[style] ?? 0) + 1;
        } else {
          // treat as import expression for stats
          const key = stripImportNoise(e.name).slice(0, 80);
          importCounts.set(key, (importCounts.get(key) ?? 0) + 1);
        }
      }
    }
    // framework detection
    for (const fw of FRAMEWORK_KEYWORDS) {
      if (fw.re.test(f.content)) {
        frameworkHits.set(fw.name, (frameworkHits.get(fw.name) ?? 0) + 1);
      }
    }
  }

  const functionStyle = dominant(functionCounts);
  const classStyle = dominant(classCounts);
  const constantStyle = dominant(constantCounts);

  const indent =
    tabs * 2 >= spaces2 + spaces4
      ? 'tabs'
      : spaces2 >= spaces4
      ? 'spaces2'
      : spaces4 > 0
      ? 'spaces4'
      : 'mixed';

  const top = [...importCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([module, count]) => ({ module, count }));
  const detectedFrameworks = [...frameworkHits.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name]) => name);

  return {
    indent: { spaces2, spaces4, tabs, dominant: indent },
    naming: { functionStyle, classStyle, constantStyle },
    imports: { top },
    detectedFrameworks,
    language,
    fileCount: files.length,
  };
}

function stripImportNoise(s: string): string {
  return s.replace(/[\s;{}()]/g, '').replace(/\*$/, '').trim();
}
