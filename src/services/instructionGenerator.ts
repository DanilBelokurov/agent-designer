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

interface BuildPromptOptions {
  upstreamSummary?: string;
  downstreamSummary?: string;
  /** Markdown produced by `collectContextForNode` — included verbatim under "Project Code Context". */
  codeContext?: string | null;
}

export function buildPromptForNode(
  node: AppNode,
  userRequest: string,
  options: BuildPromptOptions = {},
): string {
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
  if (options.upstreamSummary) {
    lines.push('## Upstream (delegates into this node)', options.upstreamSummary, '');
  }
  if (options.downstreamSummary) {
    lines.push('## Downstream (this node attaches to)', options.downstreamSummary, '');
  }
  if (options.codeContext && options.codeContext.trim()) {
    lines.push(
      '## Project Code Context',
      'Real code extracted from the project folder by a tree-sitter scan. ' +
        'Treat signatures, doc comments, and bodies as ground truth for naming, parameter shapes, behaviour, and edge cases.',
      '',
      options.codeContext.trim(),
      '',
    );
  }

  // ----- User request -----
  lines.push('## User Request', userRequest.trim(), '');

  // ----- Template + per-type rules -----
  lines.push('## Template (output MUST match this structure)');
  lines.push('```markdown');
  if (node.type === 'skill') lines.push(skillTemplate);
  else lines.push(agentTemplate);
  lines.push('```', '');

  if (node.type === 'skill') {
    lines.push(
      '## Skill — Required Frontmatter',
      '- `name` REQUIRED, snake_case — use the Slug provided above.',
      '- `description` REQUIRED — one line, when and how to use this skill.',
      '- `priority` OPTIONAL — integer 1-100, omit if unsure.',
      '',
      '## Skill — Required Body Sections',
      '- `# <title>` matching the label in human-readable form.',
      '- `## Instructions` — clear, step-by-step guidance.',
      '- `## Examples` — concrete usage examples.',
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
