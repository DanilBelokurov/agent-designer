// Prompt assembly + template validation for the instruction generator.
//
// The generated documents must follow the templates under
// ../../templates/agent-template.md and ../../templates/skill-template.md,
// which are bundled at build time as raw strings via Vite's `?raw` import.
// Qwen sees the template and is asked to output a document that fills it in
// for the specific node.
//
// `parseMarkdownFrontmatter` is exposed so the UI can validate Qwen's
// output against the template's expected fields.

import type { AppNode } from '../types';
import type { AgentState, CodeEntity } from './codeIntel/types';
import type { Intent } from './codeIntel/intentSearch';
import type { SemanticInfo } from './semanticCache';
import { collectContextForNode } from './codeIntel/contextCollector';
import agentTemplate from '../../templates/agent-template.md?raw';
import skillTemplate from '../../templates/skill-template.md?raw';

// ----------------- path derivation -----------------

function safeSlug(label: string): string {
  return (
    label
      .trim()
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/[^a-zа-я0-9-_]+/gi, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '') || 'node'
  );
}

export function relativePathForNode(node: AppNode): string {
  const slug = safeSlug(node.label);
  if (node.type === 'skill') return `skills/${slug}/SKILL.md`;
  return `agents/${slug}/AGENT.md`;
}

// ----------------- YAML frontmatter parser -----------------
//
// A focused parser that handles the subset of YAML used by our templates
// (scalar string/int keys, list-of-strings values, `#` comments). When the
// frontmatter doesn't match the template's required schema we report
// `error` instead of throwing — the dialog surfaces that to the user.

export interface FrontmatterValidation {
  frontmatter: Record<string, unknown>;
  body: string;
  /** Required keys (per template) that are missing. */
  missingRequired: string[];
  /** Schema violation messages for keys that are present but wrong type. */
  errors: string[];
}

function stripYamlComment(line: string): string {
  const idx = line.indexOf('#');
  // Skip `#` that appears inside a quoted string (rare in our templates).
  const before = idx === -1 ? line : line.slice(0, idx);
  return before.replace(/\s+$/, '');
}

export function parseMarkdownFrontmatter(text: string): FrontmatterValidation {
  const result: FrontmatterValidation = {
    frontmatter: {},
    body: text,
    missingRequired: [],
    errors: [],
  };

  if (!text.startsWith('---')) {
    result.errors.push('Missing opening `---` frontmatter fence');
    return result;
  }
  // Find the closing fence on its own line.
  const lines = text.split(/\r?\n/);
  let closeIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      closeIdx = i;
      break;
    }
  }
  if (closeIdx === -1) {
    result.errors.push('Missing closing `---` frontmatter fence');
    return result;
  }

  // Parse the YAML-ish content between open and close.
  const fmLines = lines.slice(1, closeIdx);
  let i = 0;
  while (i < fmLines.length) {
    const rawLine = fmLines[i];
    const line = stripYamlComment(rawLine);
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!m) {
      result.errors.push(`Line ${i + 2}: cannot parse \`${line.trim()}\``);
      i += 1;
      continue;
    }
    const key = m[1];
    const valuePart = m[2];

    if (valuePart === '') {
      // Either a list (next lines start with `  - …`) or an empty value.
      const listValues: string[] = [];
      let j = i + 1;
      while (j < fmLines.length) {
        const childRaw = fmLines[j];
        const childLine = stripYamlComment(childRaw);
        if (!childLine.trim()) {
          j += 1;
          continue;
        }
        const item = /^\s*-\s*(.+?)\s*$/.exec(childLine);
        if (!item) break;
        listValues.push(item[1]);
        j += 1;
      }
      result.frontmatter[key] = listValues;
      i = j;
      continue;
    }

    // Scalar value. Strip surrounding quotes.
    let value: unknown = valuePart.trim().replace(/^['"]|['"]$/g, '');

    // Try integer.
    if (/^-?\d+$/.test(String(value))) {
      value = parseInt(String(value), 10);
    }

    result.frontmatter[key] = value;
    i += 1;
  }

  result.body = lines.slice(closeIdx + 1).join('\n').replace(/^\s*\n/, '');

  return result;
}

export interface TemplateExpectations {
  required: string[];
  optional?: string[];
  bodyHeadings?: string[];
}

export const AGENT_EXPECTATIONS: TemplateExpectations = {
  required: ['name', 'description'],
  optional: ['model', 'approvalMode', 'tools', 'disallowedTools'],
};

export const SKILL_EXPECTATIONS: TemplateExpectations = {
  required: ['name', 'description'],
  optional: ['priority'],
  bodyHeadings: ['Instructions', 'Examples'],
};

export function validateFrontmatter(
  parsed: FrontmatterValidation,
  expectations: TemplateExpectations,
): FrontmatterValidation {
  for (const k of expectations.required) {
    const v = parsed.frontmatter[k];
    if (v === undefined || v === '') {
      parsed.missingRequired.push(k);
    }
  }
  if (expectations.bodyHeadings) {
    for (const h of expectations.bodyHeadings) {
      const re = new RegExp(`^##\\s+${h}`, 'm');
      if (!re.test(parsed.body)) {
        parsed.errors.push(`Body is missing \`## ${h}\``);
      }
    }
  }
  // `name` shape: lowercase letters/digits/underscore (snake_case).
  if (typeof parsed.frontmatter.name === 'string') {
    if (!/^[a-z0-9_]+$/.test(parsed.frontmatter.name)) {
      parsed.errors.push(
        'Frontmatter `name` must be snake_case (lowercase, digits, underscores)',
      );
    }
  }
  return parsed;
}

export function validateSkillFrontmatter(parsed: FrontmatterValidation) {
  return validateFrontmatter(parsed, SKILL_EXPECTATIONS);
}

export function validateAgentFrontmatter(parsed: FrontmatterValidation) {
  return validateFrontmatter(parsed, AGENT_EXPECTATIONS);
}

// ----------------- prompt builder -----------------

interface BuildPromptInput {
  upstreamSummary?: string;
  downstreamSummary?: string;
  /** Code-intel `AgentState` — when provided, the relevant entities are enriched via Qwen and rendered into the prompt. */
  codeState?: AgentState | null;
  /** Qwen model id forwarded to the enrichment call. */
  model?: string;
  /**
   * Skip the live enrichment step and reuse this Markdown verbatim under
   * "Project Code Context". Useful for testing or when callers already
   * have the block handy.
   */
  precomputedCodeContext?: string | null;
  /**
   * User-supplied free-form request text. Passed through to the context
   * collector so it can run intent-based search (e.g. "external REST
   * module" → find RestClient / HttpGateway / ExternalApiAdapter).
   */
  userRequest?: string;
  /** Forwarded to `collectContextForNode` — invoked after each entity's enrichment completes. */
  onEnrichmentProgress?: (
    current: number,
    total: number,
    entityName: string,
    info: SemanticInfo,
  ) => void;
  /** Cap how many entities are sent to Qwen. Default 15. */
  enrichPoolSize?: number;
}

/**
 * Assembles the full prompt for /generate. Optionally enriches the top
 * matching code entities through Qwen before inserting them under
 * `## Project Code Context` (always via cache first).
 */
export async function buildPromptForNode(
  node: AppNode,
  userRequest: string,
  input: BuildPromptInput = {},
): Promise<string> {
  const lines: string[] = [];

  lines.push(
    'You write one Markdown document with a YAML frontmatter for a single node of an AI-agent graph.',
    'Follow the template below EXACTLY — keep the structure, keep the field names, fill every required key.',
    '',
  );

  // ----- Node info -----
  lines.push('## Node', `- Type: ${node.type}`, `- Label: ${node.label}`);
  if (node.type === 'skill') {
    const cfg = node.config as { functionName?: string; description?: string };
    if (cfg.functionName) lines.push(`- Function name: ${cfg.functionName}`);
    if (cfg.description) lines.push(`- Description: ${cfg.description}`);
  } else {
    const cfg = node.config as { instructions?: string; maxDelegations?: number };
    if (cfg.instructions) lines.push(`- Current instructions: """${cfg.instructions}"""`);
    if (cfg.maxDelegations) lines.push(`- Max delegations: ${cfg.maxDelegations}`);
  }
  lines.push(`- Slug (use as \`name\`): ${safeSlug(node.label)}`);
  lines.push('');

  // ----- Context blocks -----
  if (input.upstreamSummary) {
    lines.push('## Upstream (delegates into this node)', input.upstreamSummary, '');
  }
  if (input.downstreamSummary) {
    lines.push('## Downstream (this node attaches to)', input.downstreamSummary, '');
  }

  // ----- User request -----
  lines.push('## User Request', userRequest.trim(), '');

  // ----- Template (so Qwen sees the exact schema, including `## Examples`). -----
  lines.push('## Template (output MUST match this structure)');
  lines.push('```markdown');
  if (node.type === 'skill') lines.push(skillTemplate);
  else lines.push(agentTemplate);
  lines.push('```', '');

  // ----- Code context (placed right before Required Body so Qwen reads
  //       the snippets last and can ground `## Examples` in them). -----
  let codeContextMarkdown: string | null = null;
  let collectedEntityCount = 0;
  let collectedEntities: CodeEntity[] = [];
  let detectedIntents: Intent[] = [];

  if (input.precomputedCodeContext !== undefined) {
    codeContextMarkdown = input.precomputedCodeContext ?? null;
  } else if (input.codeState && input.codeState.entities.length > 0) {
    const collected = await collectContextForNode(node, input.codeState, {
      enrichPoolSize: input.enrichPoolSize,
      model: input.model,
      onProgress: input.onEnrichmentProgress,
      userRequest: input.userRequest,
    });
    collectedEntityCount = collected.entityCount;
    collectedEntities = collected.entities;
    codeContextMarkdown = collected.entityCount > 0 ? collected.markdown : null;
    detectedIntents = collected.intents;
  }

  // Pick a "primary anchor" entity whose name matches what the user
  // thinks they're describing — skill's functionName first, otherwise
  // the slugified label.
  const anchorName = collectAnchorName(node);
  const anchorEntity =
    collectedEntities.find(
      (e) => e.name === anchorName || e.name.toLowerCase() === anchorName.toLowerCase(),
    ) ?? null;

  if (codeContextMarkdown && codeContextMarkdown.trim()) {
    lines.push(
      '## Project Code Context',
      'Real code extracted from the project folder by the universal code-intel extractor, ' +
        'annotated by Qwen with role + short description, and tagged with the file archetype ' +
        '(controller / service / repository / mapper / …) learned per package. Treat signatures, ' +
        'doc comments, and bodies as ground truth for naming, parameter shapes, behaviour, and edge cases.',
      '',
    );
    if (anchorEntity) {
      lines.push(
        `**PRIMARY ANCHOR:** \`${anchorEntity.name}\` — at \`${anchorEntity.filePath}\`, line ${anchorEntity.startLine + 1}. ` +
          'Anchor your `## Examples` on the body shown for this entity.',
        '',
      );
    } else if (collectedEntityCount > 0) {
      lines.push(
        `No exact match for the anchor name "${anchorName}" was found in the code graph. ` +
          'The snippets below are the closest matches by name; use them as the source of `## Examples` regardless.',
        '',
      );
    }
    lines.push(codeContextMarkdown.trim(), '');
  }

  if (node.type === 'skill') {
    const intentNote = detectedIntents.length > 0
      ? `\n- Recognised intent(s) from the user request: ${detectedIntents.map((i) => `\`${i.id}\` (${i.label})`).join(', ')}. ` +
        `Ground the skill in the entities surfaced under "Discovered by intent" in \`## Project Code Context\`.`
      : '';
    lines.push(
      '## Skill — Required Frontmatter',
      '- `name` REQUIRED, snake_case — use the Slug provided above.',
      '- `description` REQUIRED — one line, when and how to use this skill. Write it so a reader who has never seen the codebase understands when to reach for this skill.',
      '- `priority` OPTIONAL — integer 1-100, omit if unsure.',
      '',
      '## Skill — Required Body Sections',
      '- `# <title>` matching the label in human-readable form.',
      '- `## Instructions` — clear, step-by-step guidance. Pull behaviour, naming, parameter shape, error handling, and edge cases from the `## Project Code Context` block above.' +
        intentNote,
      '- `## Examples` — **REQUIRED**. Every example MUST be a runnable snippet (input → output, ' +
        'or call → response) and MUST use the EXACT symbols (function / class / method names, ' +
        'parameter names, return shapes) you saw in `## Project Code Context`. Do not invent APIs. ' +
        (anchorEntity
          ? 'Anchor on `' + anchorEntity.name + '` — you have its full body in the context. '
          : detectedIntents.length > 0
            ? 'No exact-name anchor — use the entities under "Discovered by intent" as your anchor. '
            : '') +
        'Provide 2-4 examples that cover happy-path + at least one edge case (timeout, retry, error response, ' +
        'or whatever failure mode the surfaced code actually handles). ' +
        'Show enough surrounding code that a reader can run the snippet without guessing.',
      '',
    );
  } else {
    lines.push(
      '## Agent — Required Frontmatter',
      '- `name` REQUIRED, snake_case — use the Slug provided above.',
      '- `description` REQUIRED — one line, when and how to use this agent.',
      '- `model` OPTIONAL — one of: `inherit`, `fast`, `modelId`, or `authType:modelId`. Omit to use the project default.',
      '- `approvalMode` OPTIONAL — one of: `default`, `plan`, `auto-edit`, `yolo`, `bubble`. Omit for `default`.',
      '- `tools` OPTIONAL — whitelist of tool names; omit the key entirely when empty.',
      '- `disallowedTools` OPTIONAL — blacklist of tool names; omit the key entirely when empty.',
      '',
      '## Agent — Required Body',
      '- Multi-paragraph system prompt below the closing `---`.',
      '- Describe how the agent interacts with delegating orchestrators and attached skills.',
      '',
    );
  }

  lines.push(
    '## Output Rules',
    '- Output a single Markdown document ONLY. No preamble, no explanation, no "Here is the file:" wrapper.',
    '- The three lines `---` … `---` MUST be present and contain valid YAML.',
    '- Do not wrap the whole document in a fenced code block.',
  );

  return lines.join('\n');
}

export function summarizeLabel(label: string, fallback: string): string {
  if (!label || label === fallback) return fallback;
  return `${label} (${fallback})`;
}

/**
 * Pick the name we expect Qwen to anchor `## Examples` on: skill's
 * `functionName` if set, otherwise the slugified node label.
 */
function collectAnchorName(node: AppNode): string {
  if (node.type === 'skill') {
    const cfg = node.config as { functionName?: string };
    if (cfg.functionName) return cfg.functionName;
  }
  return safeSlug(node.label);
}
