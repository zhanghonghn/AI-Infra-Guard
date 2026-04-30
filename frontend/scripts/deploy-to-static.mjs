#!/usr/bin/env node
// Copies the production build (frontend/dist/) into common/websocket/static/
// so that the Go embed.FS picks it up on the next `go build`.
//
// This is OPT-IN — running it overwrites the currently shipped bundle.
// Use only after thoroughly testing the new source-form frontend.
//
//   npm run build && npm run deploy:static

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(FRONTEND_DIR, '..');
const SRC = path.join(FRONTEND_DIR, 'dist');
const DEST = path.join(REPO_ROOT, 'common', 'websocket', 'static');
// Asset directories that must be preserved across deploys (they are not
// produced by Vite — they ship docs/images/fonts the backend serves directly).
const PRESERVE = new Set(['aigdocs', 'images', 'fonts']);

if (!fs.existsSync(SRC)) {
  console.error(`[deploy] dist not found at ${SRC}. Run 'npm run build' first.`);
  process.exit(1);
}
if (!fs.existsSync(DEST)) {
  console.error(`[deploy] target not found: ${DEST}`);
  process.exit(1);
}

// Wipe everything except preserved sub-directories.
for (const entry of fs.readdirSync(DEST)) {
  if (PRESERVE.has(entry)) continue;
  fs.rmSync(path.join(DEST, entry), { recursive: true, force: true });
}

function copyRec(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const child of fs.readdirSync(src)) {
      copyRec(path.join(src, child), path.join(dest, child));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

for (const entry of fs.readdirSync(SRC)) {
  copyRec(path.join(SRC, entry), path.join(DEST, entry));
}

console.log(`[deploy] copied ${SRC} -> ${DEST}`);
console.log('[deploy] preserved directories:', [...PRESERVE].join(', '));
console.log('[deploy] remember to rebuild the Go binary so embed.FS refreshes.');
