// Tiny UI-only store: tracks which left-panel tab is active so that the
// canvas can switch between rendering the agent-graph (Harness tab) and
// the code-graph (Graph tab). Also owns the graphFilters used by the
// code-graph canvas to hide nodes/edges the user doesn't want to see.

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
  kinds: new Set<EntityKind>([
    'class', 'interface', 'enum', 'object', 'companion',
    'function', 'method', 'field', 'constant', 'parameter',
  ]),
  relations: new Set<RelationKind>([
    'inherits', 'implements', 'calls', 'imports', 'extension_of',
    'returns', 'has_parameter', 'field_of', 'references',
  ]),
  languages: new Set<string>(),
  archetypes: new Set<string>(),
};

interface UiState {
  leftTab: LeftTab;
  graphFilters: GraphFilters;

  setLeftTab: (tab: LeftTab) => void;
  resetToHarness: () => void;

  toggleFilterKind: (kind: EntityKind) => void;
  toggleFilterRelation: (kind: RelationKind) => void;
  toggleFilterLanguage: (language: string) => void;
  toggleFilterArchetype: (archetype: string) => void;
  setFilterLanguages: (languages: string[]) => void;
  resetFilters: () => void;
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