// Fetches the web-tree-sitter runtime and language grammars into
// public/grammars/, so the browser can load them at /grammars/*.wasm.
//
// Run:  node scripts/fetch-grammars.cjs
//
// The runtime wasm is always copied from node_modules/web-tree-sitter.
// Language grammars are pulled from GitHub release assets of tree-sitter-*
// repositories.

const fs = require('fs');
const path = require('path');
const https = require('https');

const LANGUAGE_GRAMMARS = [
  {
    name: 'typescript',
    repo: 'tree-sitter/tree-sitter-typescript',
    asset: 'tree-sitter-typescript.wasm',
    defaultTag: 'v0.23.2',
    envVar: 'TREE_SITTER_TYPESCRIPT_VERSION',
  },
  {
    name: 'javascript',
    repo: 'tree-sitter/tree-sitter-javascript',
    asset: 'tree-sitter-javascript.wasm',
    defaultTag: 'v0.25.0',
    envVar: 'TREE_SITTER_JAVASCRIPT_VERSION',
  },
  {
    name: 'python',
    repo: 'tree-sitter/tree-sitter-python',
    asset: 'tree-sitter-python.wasm',
    defaultTag: 'v0.25.0',
    envVar: 'TREE_SITTER_PYTHON_VERSION',
  },
];

function httpGet(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error('too many redirects'));
    https.get(url, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        const next = res.headers.location;
        if (!next) return reject(new Error('redirect without location'));
        return resolve(httpGet(next, maxRedirects - 1));
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  const outDir = path.resolve(__dirname, '..', 'public', 'grammars');
  fs.mkdirSync(outDir, { recursive: true });

  // Copy the runtime wasm from node_modules so the loader can serve it
  // from /grammars/web-tree-sitter.wasm.
  const runtimeSrc = path.resolve(__dirname, '..', 'node_modules', 'web-tree-sitter', 'web-tree-sitter.wasm');
  const runtimeDst = path.join(outDir, 'web-tree-sitter.wasm');
  if (fs.existsSync(runtimeSrc)) {
    fs.copyFileSync(runtimeSrc, runtimeDst);
    console.log(`[grammar] runtime  →  ${path.relative(process.cwd(), runtimeDst)} (${fs.statSync(runtimeDst).size} bytes)`);
  } else {
    console.warn(`[grammar] runtime not found at ${runtimeSrc}; the loader will fall back to fetching from the dev server`);
  }

  let okCount = 0;
  for (const g of LANGUAGE_GRAMMARS) {
    const tag = process.env[g.envVar] ?? g.defaultTag;
    const url = `https://github.com/${g.repo}/releases/download/${tag}/${g.asset}`;
    try {
      const buf = await httpGet(url);
      const dest = path.join(outDir, g.asset);
      fs.writeFileSync(dest, buf);
      okCount += 1;
      console.log(`[grammar] ${g.name.padEnd(11)} →  ${path.relative(process.cwd(), dest)} (${buf.length} bytes) from ${g.repo}@${tag}`);
    } catch (err) {
      console.warn(`[grammar] ${g.name}: ${err.message}`);
    }
  }

  if (okCount === 0) {
    console.warn('[grammar] no language grammars downloaded — the app will fall back to regex parsing');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
