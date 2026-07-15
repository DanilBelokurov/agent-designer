// Prompt assembly helpers for the instruction generator.

import type { AppNode } from '../types';

function safeSlug(label: string): string {
  const cleaned = label
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9-_]+/gi, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return cleaned || 'node';
}

export function relativePathForNode(node: AppNode): string {
  const slug = safeSlug(node.label);
  if (node.type === 'skill') return `skills/${slug}/SKILL.md`;
  return `agents/${slug}/AGENT.md`;
}

interface BuildPromptOptions {
  upstreamSummary?: string;
  downstreamSummary?: string;
}

export function buildPromptForNode(
  node: AppNode,
  userRequest: string,
  options: BuildPromptOptions = {},
): string {
  const lines: string[] = [];

  lines.push(
    'You write a Markdown instruction document for one node of an AI-agent graph.',
    'Be concise, concrete, and structured. Do not wrap the document in code fences.',
    '',
  );

  lines.push('## Node', `- Type: ${node.type}`, `- Label: ${node.label}`);
  if ('instructions' in node.config && node.config.instructions) {
    lines.push(`- Current instructions: """${node.config.instructions}"""`);
  }
  if ('maxDelegations' in node.config && node.config.maxDelegations) {
    lines.push(`- Max delegations: ${node.config.maxDelegations}`);
  }
  if ('functionName' in node.config && node.config.functionName) {
    lines.push(`- Function name: ${node.config.functionName}`);
  }
  if ('description' in node.config && node.config.description) {
    lines.push(`- Description: ${node.config.description}`);
  }
  lines.push('');

  if (options.upstreamSummary) {
    lines.push('## Upstream (delegates into this node)', options.upstreamSummary, '');
  }
  if (options.downstreamSummary) {
    lines.push('## Downstream (this node attaches to)', options.downstreamSummary, '');
  }

  lines.push('## User Request', userRequest.trim(), '');

  if (node.type === 'skill') {
    lines.push(
      '## Required Output Sections',
      '1. `## Title` — one line using the label',
      '2. `## Description` — 1-3 sentences on what the skill does',
      '3. `## Usage` — 2-3 concrete code examples (input → output)',
      '4. `## Notes` — edge cases or limitations (skip section if nothing relevant)',
      '',
      'Output ONLY the Markdown, no preamble.',
    );
  } else {
    lines.push(
      '## Required Output Sections',
      '1. `## Title` — one line using the label',
      '2. `## Role` — agent purpose and scope',
      '3. `## Workflow` — how it interacts with delegating orchestrators and attached skills',
      '4. `## Examples` — 1-2 usage scenarios',
      '',
      'Output ONLY the Markdown, no preamble.',
    );
  }

  return lines.join('\n');
}

export function summarizeLabel(label: string, fallback: string): string {
  if (!label || label === fallback) return fallback;
  return `${label} (${fallback})`;
}
