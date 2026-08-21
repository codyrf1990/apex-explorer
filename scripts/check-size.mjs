import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

const MAX_FILE_LINES = 350;
const MAX_FUNCTION_LINES = 70;
const targets = ['.js', '.mjs', '.ts', '.tsx'];
const skipDirs = new Set(['node_modules', 'dist', '.git', 'WorkBench']);
const legacyExclusions = new Set(['background.js', 'content.js', 'popup.js']);

function walk(dir, out = []) {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    if (skipDirs.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (targets.includes(extname(full))) out.push(full);
  }
  return out;
}

function estimateFunctions(lines) {
  const starts = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let namedFunction = /^\s*(?:export\s+)?(?:async\s+)?function\s+\w+/.test(line);
    let assignedArrow = /^\s*(?:const|let)\s+\w+\s*=.*=>\s*\{\s*$/.test(line);
    if (namedFunction || assignedArrow) starts.push(i);
  }
  const lengths = [];
  for (const s of starts) {
    let depth = 0;
    let started = false;
    for (let i = s; i < lines.length; i++) {
      const line = lines[i];
      for (const ch of line) {
        if (ch === '{') {
          depth++;
          started = true;
        }
        if (ch === '}') depth--;
      }
      if (started && depth <= 0) {
        lengths.push(i - s + 1);
        break;
      }
    }
  }
  return lengths;
}

const files = walk(process.cwd());
const errors = [];

for (const file of files) {
  const normalized = file.replace(/\\/g, '/');
  const base = normalized.split('/').at(-1);
  if (legacyExclusions.has(base)) continue;

  const text = readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);

  if (lines.length > MAX_FILE_LINES) {
    errors.push(`${file}: file has ${lines.length} lines (max ${MAX_FILE_LINES})`);
  }

  const fnLens = estimateFunctions(lines);
  for (const len of fnLens) {
    if (len > MAX_FUNCTION_LINES) {
      errors.push(`${file}: function estimated ${len} lines (max ${MAX_FUNCTION_LINES})`);
      break;
    }
  }
}

if (errors.length) {
  console.error('Size checks failed:');
  for (const e of errors) console.error(`- ${e}`);
  process.exit(1);
}

console.log('Size checks passed.');
