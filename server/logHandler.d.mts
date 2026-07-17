// Type declarations for the dynamically imported `server/logHandler.mjs`
// from vite.config.ts (and other .ts files). Pure shape — the .mjs file
// owns the runtime implementation.

export function dispatchLog(
  req: any,
  res: any,
  urlPath: string,
): Promise<boolean>;

export const LOG_PATHS: {
  LOG_DIR: string;
  LOG_FILE: string;
};
