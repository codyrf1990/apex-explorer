import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import archiver from 'archiver';

const cwd = process.cwd();
const manifestPath = join(cwd, 'manifest.json');
if (!existsSync(manifestPath)) {
  console.error('manifest.json not found. Run from project root.');
  process.exit(1);
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

const files = [
  'manifest.json',
  'background.js',
  'content.js',
  'popup.html',
  'popup.js',
  'popup.css'
];

for (const file of files) {
  const full = join(cwd, file);
  if (!existsSync(full)) {
    console.error(`Missing extension file: ${file}`);
    process.exit(1);
  }
  archive.file(full, { name: file });
}

const iconsDir = join(cwd, 'icons');
if (existsSync(iconsDir)) {
  const icons = readdirSync(iconsDir).sort();
  for (const icon of icons) {
    const full = join(iconsDir, icon);
    if (statSync(full).isFile()) {
      archive.file(full, { name: `icons/${icon}` });
    }
  }
}

await archive.finalize();
