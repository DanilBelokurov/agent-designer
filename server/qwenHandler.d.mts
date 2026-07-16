// Hand-written declarations for qwenHandler.mjs so TypeScript recognises the
// dynamic import in vite.config.ts.

import type { IncomingMessage, ServerResponse } from 'node:http';

export function handleGenerate(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean>;

export function handleHealth(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean>;

export function dispatchBridge(
  req: IncomingMessage,
  res: ServerResponse,
  urlPath: string,
): Promise<boolean>;
