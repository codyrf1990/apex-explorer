import { existsSync } from 'node:fs';

const checks = [
  ['manifest', 'manifest.json'],
  ['background', 'background.js'],
  ['content', 'content.js'],
  ['list content', 'content-list.js'],
  ['popup html', 'popup.html'],
  ['popup js', 'popup.js'],
  ['popup css', 'popup.css'],
  ['history html', 'history.html'],
  ['history js', 'history.js'],
  ['history css', 'history.css'],
  ['shared settings', 'shared/settings.js'],
  ['shared tokens', 'shared/tokens.js']
];

const missing = checks.filter(([, file]) => !existsSync(file));

console.log('Manual smoke helper');
console.log('1. Load unpacked extension from project root.');
console.log('2. Open QBO transaction page.');
console.log('3. Test download rename.');
console.log('4. Test popup preview and settings save.');
console.log('5. If phase includes batch/history, run those checks from BUILD_PLAN.md.');

if (missing.length) {
  console.error('\nMissing expected files:');
  for (const [name, file] of missing) console.error(`- ${name}: ${file}`);
  process.exit(1);
}

console.log('\nSmoke prerequisites look good.');
