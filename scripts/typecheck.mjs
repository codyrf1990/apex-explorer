import { readdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

async function walk(dir, out = []) {
  let entries = await readdir(dir, { withFileTypes: true });
  for (let entry of entries) {
    if (['node_modules', 'dist', '.git', 'WorkBench'].includes(entry.name)) continue;
    let full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else if (['.js', '.mjs'].includes(extname(full))) out.push(full);
  }
  return out;
}

let files = await walk(process.cwd());
let failed = false;
for (let file of files) {
  let result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) failed = true;
}

if (failed) process.exit(1);
console.log(`Syntax checked ${files.length} JavaScript files.`);
