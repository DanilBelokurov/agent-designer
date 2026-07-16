import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Sparkles, FolderTree, Download, Save, AlertCircle, Loader2, Code2 } from 'lucide-react';
import type { Node, Edge } from 'reactflow';

import { useGraphStore } from '../store/useGraphStore';
import { useFileSystemStore } from '../store/useFileSystemStore';
import { useCodeGraphStore } from '../store/useCodeGraphStore';
import { describeGraph } from '../store/useCodeGraphStore';
import type { AppNode, NodeConfig } from '../types';
import {
  buildPromptForNode,
  parseMarkdownFrontmatter,
  relativePathForNode,
  validateAgentFrontmatter,
  validateSkillFrontmatter,
} from '../services/instructionGenerator';
import {
  downloadAsFile,
  isFileSystemAccessSupported,
  pickProjectDirectory,
  readInstructionFromDisk,
  rememberInMemory,
  writeInstructionToDisk,
} from '../services/fileSystem';
import { QwenUnavailableError, generateViaQwen } from '../services/qwenClient';
import { collectContextForNode } from '../services/treeSitter/contextCollector';

interface InstructionGeneratorDialogProps {
  node: Node;
  nodes: Node[];
  edges: Edge[];
  onClose: () => void;
}

const INITIAL_REQUEST_HINTS: Record<string, string> = {
  orchestrator:
    'Describe what this orchestrator coordinates, who delegates to it, and what makes a good delegation vs a bad one.',
  sub_agent:
    'Describe this agent\'s responsibilities, the kinds of tasks it should accept, and how it should leverage its tools.',
  skill:
    'Describe what this skill does, when to use it, and which kinds of inputs/outputs it handles.',
};

export default function InstructionGeneratorDialog({
  node,
  nodes,
  edges,
  onClose,
}: InstructionGeneratorDialogProps) {
  const updateNode = useGraphStore((s) => s.updateNode);
  const directory = useFileSystemStore((s) => s.directory);
  const setDirectory = useFileSystemStore((s) => s.setDirectory);
  const setDirError = useFileSystemStore((s) => s.setError);

  const nodeType = node.type as 'orchestrator' | 'sub_agent' | 'skill';
  const config = node.data.config as NodeConfig;
  const fieldForInstructions: 'instructions' | 'description' =
    nodeType === 'skill' ? 'description' : 'instructions';
  const existingText =
    (nodeType === 'skill'
      ? (config as { description?: string }).description
      : (config as { instructions?: string }).instructions) ?? '';

  const [userRequest, setUserRequest] = useState<string>('');
  const [draft, setDraft] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'generating' | 'saving'>('idle');
  const [previewSource, setPreviewSource] = useState<'generated' | 'existing' | 'none'>(
    () => (existingText ? 'existing' : 'none'),
  );
  const [savedPath, setSavedPath] = useState<string | null>(
    () => ((config as { instructionFilePath?: string }).instructionFilePath ?? null),
  );

  const dialogRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<HTMLTextAreaElement>(null);

  const relativePath = useMemo(
    () => relativePathForNode({ id: node.id, type: nodeType, label: node.data.label, config } as AppNode),
    [node.id, nodeType, node.data.label, config],
  );

  useEffect(() => {
    requestRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Try to load existing instruction from disk on mount
  useEffect(() => {
    if (!directory) return;
    let cancelled = false;
    readInstructionFromDisk(directory, relativePath).then((text) => {
      if (cancelled) return;
      if (text !== null && !existingText) {
        setDraft(text);
        setPreviewSource('existing');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [directory, relativePath, existingText]);

  const appNode = useMemo(
    () =>
      ({
        id: node.id,
        type: nodeType,
        label: node.data.label,
        config,
      }) as AppNode,
    [node.id, nodeType, node.data.label, config],
  );

  const upstream = useMemo(
    () => edges.filter((e) => e.target === node.id).map((e) => nodes.find((n) => n.id === e.source)?.data?.label).filter(Boolean),
    [edges, node.id, nodes],
  );
  const downstream = useMemo(
    () => edges.filter((e) => e.source === node.id).map((e) => nodes.find((n) => n.id === e.target)?.data?.label).filter(Boolean),
    [edges, node.id, nodes],
  );

  const codeGraph = useCodeGraphStore((s) => s.graph);
  const codePhase = useCodeGraphStore((s) => s.phase);
  const codeStats = useMemo(() => describeGraph(codeGraph), [codeGraph]);

  const codeContext = useMemo(() => {
    if (!userRequest.trim()) return null; // only when user actually wants to generate
    return collectContextForNode(appNode, codeGraph);
  }, [appNode, codeGraph, userRequest]);

  const onGenerate = async () => {
    if (!userRequest.trim()) {
      setError('Please describe what you want the instruction to cover.');
      return;
    }
    setStatus('generating');
    setError(null);
    try {
      const ctx = codeContext ?? collectContextForNode(appNode, codeGraph);
      const prompt = buildPromptForNode(appNode, userRequest, {
        upstreamSummary: upstream.length ? upstream.join(', ') : undefined,
        downstreamSummary: downstream.length ? downstream.join(', ') : undefined,
        codeContext: ctx.entityCount > 0 ? ctx.markdown : null,
      });
      const text = await generateViaQwen(prompt);
      if (!text) {
        setError('Qwen returned an empty response.');
        setStatus('idle');
        return;
      }
      setDraft(text);
      setPreviewSource('generated');
      setStatus('idle');
    } catch (err) {
      const msg = err instanceof QwenUnavailableError
        ? err.message
        : err instanceof Error
        ? err.message
        : String(err);
      setError(msg);
      setStatus('idle');
    }
  };

  const onPickFolder = async () => {
    setError(null);
    try {
      const dir = await pickProjectDirectory();
      const writable = await dir.verifyWritable();
      if (!writable) {
        setError('You did not grant write access. Re-pick the folder and allow modification.');
        setDirError('write denied');
        return;
      }
      setDirectory(dir);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    }
  };

  const applyToConfig = (text: string, path: string | null) => {
    if (nodeType === 'skill') {
      const c = config as { description?: string; instructionFilePath?: string };
      updateNode(node.id, {
        config: {
          ...c,
          description: text,
          instructionFilePath: path ?? c.instructionFilePath ?? undefined,
        },
      });
    } else {
      const c = config as { instructions?: string; instructionFilePath?: string };
      updateNode(node.id, {
        config: {
          ...c,
          instructions: text,
          instructionFilePath: path ?? c.instructionFilePath ?? undefined,
        },
      });
    }
  };

  const onSave = async () => {
    if (!draft.trim()) {
      setError('Nothing to save. Generate first.');
      return;
    }
    setStatus('saving');
    setError(null);
    try {
      let writtenPath: string | null = null;
      if (directory) {
        await writeInstructionToDisk(directory, relativePath, draft);
        writtenPath = relativePath;
        setSavedPath(relativePath);
      } else {
        // Fallback: download the file and remember it locally for the session.
        downloadAsFile(relativePath, draft);
        rememberInMemory(relativePath, draft);
        writtenPath = relativePath;
        setSavedPath(relativePath);
      }
      applyToConfig(draft, writtenPath);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setStatus('idle');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="relative w-full max-w-4xl max-h-[90vh] flex flex-col bg-gradient-to-b from-slate-900 via-slate-900/95 to-slate-950 border border-slate-700/50 rounded-2xl shadow-2xl shadow-indigo-500/10"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-700/50">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="absolute inset-0 bg-indigo-500/40 blur-md rounded-lg" />
              <div className="relative p-2 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg shadow-lg shadow-indigo-500/30">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Generate instruction</h2>
              <p className="text-xs text-slate-400">
                {nodeType.replace('_', ' ')} · {node.data.label}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Folder status */}
          <div className="flex items-center justify-between p-3 bg-slate-800/40 border border-slate-700/50 rounded-xl">
            <div className="flex items-center gap-2 text-sm min-w-0">
              <FolderTree className="w-4 h-4 text-slate-400 flex-shrink-0" />
              <div className="min-w-0">
                {directory ? (
                  <>
                    <div className="text-slate-200 font-mono truncate">{directory.name}</div>
                    <div className="text-[11px] text-slate-500 truncate">{relativePath}</div>
                  </>
                ) : isFileSystemAccessSupported() ? (
                  <span className="text-slate-400">No project folder picked</span>
                ) : (
                  <span className="text-slate-400">
                    File System Access API not available — save will download instead
                  </span>
                )}
              </div>
            </div>
            {isFileSystemAccessSupported() && (
              <button
                onClick={onPickFolder}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-700/60 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-600/50 transition-colors"
              >
                {directory ? 'Change…' : 'Pick folder…'}
              </button>
            )}
          </div>

          {/* Code-graph status */}
          <div className="flex items-center justify-between p-3 bg-slate-800/40 border border-slate-700/50 rounded-xl">
            <div className="flex items-center gap-2 text-sm min-w-0">
              <Code2 className="w-4 h-4 text-slate-400 flex-shrink-0" />
              <div className="min-w-0">
                {codeStats.totalEntities > 0 ? (
                  <>
                    <div className="text-slate-200">
                      {codeStats.totalEntities} code entities
                      {codeContext && codeContext.entityCount > 0 && (
                        <span className="ml-2 text-[11px] text-emerald-400">
                          ({codeContext.entityCount} match this node)
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 truncate">
                      {Object.entries(codeStats.byKind)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 4)
                        .map(([k, n]) => `${n} ${k}`)
                        .join(' · ')}
                    </div>
                  </>
                ) : codePhase === 'scanning' ? (
                  <span className="text-slate-400">Scanning project for code…</span>
                ) : (
                  <span className="text-slate-400">
                    Run a code-graph scan from the toolbar to enrich the prompt with real signatures.
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Request */}
          <div className="space-y-2">
            <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider">
              Request
            </label>
            <textarea
              ref={requestRef}
              value={userRequest}
              onChange={(e) => setUserRequest(e.target.value)}
              rows={3}
              placeholder={INITIAL_REQUEST_HINTS[nodeType] ?? 'Describe what this instruction should cover…'}
              className="w-full px-3 py-2 bg-slate-800/50 border border-slate-700/50 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all resize-none backdrop-blur-sm text-sm"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-300 text-sm">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span className="break-words">{error}</span>
            </div>
          )}

          {/* Preview */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider">
                Preview
                {previewSource === 'existing' && (
                  <span className="ml-2 normal-case text-[11px] text-slate-500 tracking-normal">
                    (loaded from disk)
                  </span>
                )}
                {savedPath && (
                  <span className="ml-2 normal-case text-[11px] text-emerald-400 tracking-normal">
                    ✓ saved to {savedPath}
                  </span>
                )}
              </label>
              <span className="text-[11px] text-slate-500">{draft.length} chars</span>
            </div>
            <textarea
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                if (previewSource === 'none') setPreviewSource('existing');
              }}
              rows={14}
              placeholder="Click Generate to fill this with a draft from Qwen, or type your own instructions here."
              className="w-full px-3 py-2 bg-slate-800/50 border border-slate-700/50 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all resize-none backdrop-blur-sm font-mono text-sm"
            />
            <ValidationChip draft={draft} nodeType={nodeType} />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 p-5 border-t border-slate-700/50">
          <div className="text-[11px] text-slate-500">
            {fieldForInstructions === 'description'
              ? 'Skill · saved into `description`'
              : `${nodeType.replace('_', ' ')} · saved into \`instructions\``}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm bg-slate-800/50 hover:bg-slate-700/50 border border-slate-700/50 text-slate-300 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onGenerate}
              disabled={status !== 'idle'}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-slate-800/50 hover:bg-slate-700/50 border border-slate-700/50 text-slate-300 rounded-xl transition-colors disabled:opacity-50"
            >
              {status === 'generating' ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Generating…
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Generate
                </>
              )}
            </button>
            <button
              onClick={onSave}
              disabled={status !== 'idle' || !draft.trim()}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 text-white rounded-xl shadow-lg shadow-indigo-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {status === 'saving' ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving…
                </>
              ) : directory ? (
                <>
                  <Save className="w-4 h-4" />
                  Save
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  Save & download
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ----------------- validation chip -----------------

function ValidationChip({
  draft,
  nodeType,
}: {
  draft: string;
  nodeType: 'orchestrator' | 'sub_agent' | 'skill';
}) {
  if (!draft.trim()) {
    return (
      <div className="text-[11px] text-slate-500 italic">
        Output will be validated against the {nodeType === 'skill' ? 'skill' : 'agent'} template once generated.
      </div>
    );
  }

  const parsed = parseMarkdownFrontmatter(draft);
  const validated =
    nodeType === 'skill' ? validateSkillFrontmatter(parsed) : validateAgentFrontmatter(parsed);
  const schemaOk = validated.missingRequired.length === 0 && validated.errors.length === 0;

  const summary: string[] = [];
  if (validated.missingRequired.length) {
    summary.push(`missing ${validated.missingRequired.join(', ')}`);
  }
  if (validated.errors.length) {
    summary.push(validated.errors[0]);
  }

  return (
    <div
      className={`flex items-start gap-2 px-2.5 py-1.5 rounded-lg text-[11px] ${
        schemaOk
          ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
          : 'bg-amber-500/10 border border-amber-500/30 text-amber-300'
      }`}
    >
      <span className="font-mono text-[10px] mt-0.5">
        {schemaOk ? '✓ template' : '⚠ template'}
      </span>
      <span className="flex-1 break-words">
        {schemaOk
          ? `Matches the ${nodeType === 'skill' ? 'skill-template.md' : 'agent-template.md'} structure.`
          : summary.join(' · ')}
      </span>
    </div>
  );
}
