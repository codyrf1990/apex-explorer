import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

async function walk(dir, out = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (['node_modules', 'dist', '.git', 'WorkBench'].includes(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

const files = await walk(process.cwd());
const tsFiles = files.filter((f) => ['.ts', '.tsx'].includes(extname(f)));

if (tsFiles.length === 0) {
  console.log('Typecheck skipped: no TypeScript files yet.');
  process.exit(0);
}

if (!existsSync('tsconfig.json')) {
  console.error('tsconfig.json is missing.');
  process.exit(1);
}

const result = spawnSync('npx', ['tsc', '--noEmit', '-p', 'tsconfig.json'], { stdio: 'inherit', shell: true });
process.exit(result.status ?? 1);
