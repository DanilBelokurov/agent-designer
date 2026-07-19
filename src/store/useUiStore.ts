// Tiny UI-only store: tracks which left-panel tab is active so that the
// canvas can switch between rendering the agent-graph (Harness tab) and
// the code-graph (Graph tab). Also owns the graphFilters used by the
// code-graph canvas to hide nodes/edges the user doesn't want to see,
// and the set of currently-collapsed compound nodes (class/interface/
// enum/object/companion) so the canvas only renders their headers.

import { create } from 'zustand';
import type { EntityKind, RelationKind } from '../services/codeIntel/types';
import { logger } from '../services/logger';

export type LeftTab = 'harness' | 'graph' | 'logs';

export interface GraphFilters {
  kinds: Set<EntityKind>;
  relations: Set<RelationKind>;
  languages: Set<string>;
  archetypes: Set<string>;
}

const DEFAULT_FILTERS: GraphFilters = {
  // By default we keep only architecturally-meaningful kinds. Detailed
  // kinds (field, parameter, constant, variable, module, type) are
  // hidden — toggleable in the Filters panel.
  kinds: new Set<EntityKind>([
    'class', 'interface', 'enum', 'object', 'companion',
    'function', 'method',
  ]),
  relations: new Set<RelationKind>([
    'inherits', 'implements', 'calls', 'imports', 'extension_of',
  ]),
  languages: new Set<string>(),
  archetypes: new Set<string>(),
};

export interface UiState {
  leftTab: LeftTab;
  graphFilters: GraphFilters;
  /** Compound node ids (class/interface/...) the user has collapsed. */
  compoundsCollapsed: Set<string>;
  /** Whether auto-layout should be applied automatically on next render. */
  autoLayoutRequested: number;
  /**
   * Which renderer the code-graph canvas uses. `sigma` (default for
   * new sessions) is the WebGL path — handles 10k+ entities; `reactflow`
   * is the legacy SVG path, kept as a fallback / comparison view.
   */
  codeGraphRenderer: 'sigma' | 'reactflow';
  /**
   * How Sigma colours nodes. `kind` mirrors the ReactFlow canvas;
   * `language` uses a per-language GitHub-style palette; `community`
   * runs Louvain over the graph and colours by cluster.
   */
  codeGraphColorMode: 'kind' | 'language' | 'community';

  setLeftTab: (tab: LeftTab) => void;
  resetToHarness: () => void;

  toggleFilterKind: (kind: EntityKind) => void;
  toggleFilterRelation: (kind: RelationKind) => void;
  toggleFilterLanguage: (language: string) => void;
  toggleFilterArchetype: (archetype: string) => void;
  setFilterLanguages: (languages: string[]) => void;
  resetFilters: () => void;

  toggleCompoundCollapse: (id: string) => void;
  expandAllCompounds: () => void;
  collapseAllCompounds: (ids: string[]) => void;
  requestAutoLayout: () => void;
  setCodeGraphRenderer: (r: UiState['codeGraphRenderer']) => void;
  setCodeGraphColorMode: (m: UiState['codeGraphColorMode']) => void;
}

function toggleSet<T>(s: Set<T>, value: T): Set<T> {
  const next = new Set(s);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

export const useUiStore = create<UiState>((set) => ({
  leftTab: 'harness',
  graphFilters: DEFAULT_FILTERS,
  compoundsCollapsed: new Set<string>(),
  autoLayoutRequested: 0,
  codeGraphRenderer: 'sigma',
  codeGraphColorMode: 'kind',

  setLeftTab: (tab) => {
    logger.info('ui.tab.switch', { tab });
    set({ leftTab: tab });
  },
  resetToHarness: () => set({ leftTab: 'harness' }),

  toggleFilterKind: (kind) => {
    logger.info('filter.toggle', { group: 'kind', value: kind });
    set((s) => ({ graphFilters: { ...s.graphFilters, kinds: toggleSet(s.graphFilters.kinds, kind) } }));
  },
  toggleFilterRelation: (rel) => {
    logger.info('filter.toggle', { group: 'relation', value: rel });
    set((s) => ({ graphFilters: { ...s.graphFilters, relations: toggleSet(s.graphFilters.relations, rel) } }));
  },
  toggleFilterLanguage: (language) => {
    logger.info('filter.toggle', { group: 'language', value: language });
    set((s) => ({ graphFilters: { ...s.graphFilters, languages: toggleSet(s.graphFilters.languages, language) } }));
  },
  toggleFilterArchetype: (archetype) => {
    logger.info('filter.toggle', { group: 'archetype', value: archetype });
    set((s) => ({ graphFilters: { ...s.graphFilters, archetypes: toggleSet(s.graphFilters.archetypes, archetype) } }));
  },
  setFilterLanguages: (languages) =>
    set((s) => ({ graphFilters: { ...s.graphFilters, languages: new Set(languages) } })),
  resetFilters: () => {
    logger.info('filter.reset');
    set({ graphFilters: DEFAULT_FILTERS });
  },

  toggleCompoundCollapse: (id) =>
    set((s) => ({ compoundsCollapsed: toggleSet(s.compoundsCollapsed, id) })),
  expandAllCompounds: () => set({ compoundsCollapsed: new Set() }),
  collapseAllCompounds: (ids) => set({ compoundsCollapsed: new Set(ids) }),
  requestAutoLayout: () => set((s) => ({ autoLayoutRequested: s.autoLayoutRequested + 1 })),
  setCodeGraphRenderer: (r) => set({ codeGraphRenderer: r }),
  setCodeGraphColorMode: (m) => set({ codeGraphColorMode: m }),
}));

export const ALL_KINDS: ReadonlyArray<EntityKind> = [
  'class', 'interface', 'enum', 'object', 'companion',
  'function', 'method', 'field', 'parameter', 'variable', 'constant',
  'annotation', 'module', 'package', 'type',
];

export const ALL_RELATIONS: ReadonlyArray<RelationKind> = [
  'contains', 'inherits', 'implements', 'calls', 'annotated_by',
  'imports', 'returns', 'has_parameter', 'field_of', 'extension_of', 'references',
];

export const ALL_ARCHETYPES: ReadonlyArray<string> = [
  'controller', 'service', 'repository', 'mapper', 'dto',
  'filter', 'middleware',
  'client', 'gateway', 'adapter', 'producer', 'consumer',
  'validator', 'presenter', 'view', 'exception',
  'config', 'test', 'main', 'util',
];