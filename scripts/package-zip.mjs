import { createWriteStream, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import archiver from 'archiver';

const cwd = process.cwd();
const manifestPath = join(cwd, 'manifest.json');
if (!existsSync(manifestPath)) {
  console.error('manifest.json not found. Run from project root.');
  process.exit(1);
}

const files = [
  'manifest.json',
  'background.js',
  'content.js',
  'content-list.js',
  'popup.html',
  'popup.js',
  'popup.css',
  'history.html',
  'history.js',
  'history.css',
  'icons/icon16.png',
  'icons/icon48.png',
  'icons/icon128.png',
  'shared/qbo-data.js',
  'shared/rename-state.js',
  'shared/settings.js',
  'shared/tokens.js'
];

for (const file of files) {
  if (existsSync(join(cwd, file))) continue;
  console.error(`Missing extension file: ${file}`);
  process.exit(1);
}

if (process.argv.includes('--check')) {
  console.log(`Package inputs verified (${files.length} extension files).`);
  process.exit(0);
}

const version = JSON.parse(readFileSync(manifestPath, 'utf8')).version;
const outDir = join(cwd, 'packages');
mkdirSync(outDir, { recursive: true });
const zipPath = join(outDir, `apex-explorer-v${version}.zip`);
const output = createWriteStream(zipPath);
const archive = archiver('zip', { zlib: { level: 9 } });

output.on('close', () => {
  console.log(`Created ${relative(cwd, zipPath)} (${archive.pointer()} bytes)`);
});
archive.on('error', (err) => {
  console.error(err.message);
  process.exit(1);
});
archive.pipe(output);

for (const file of files) archive.file(join(cwd, file), { name: file });

await archive.finalize();
