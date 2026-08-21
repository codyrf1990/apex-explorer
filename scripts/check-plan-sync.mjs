import { existsSync, readFileSync } from 'node:fs';

const requiredFiles = [
  'WorkBench/BUILD_PLAN.md',
  'AGENTS.md',
  'CLAUDE.md'
];

const missing = requiredFiles.filter((p) => !existsSync(p));
if (missing.length) {
  console.error('Plan sync failed. Missing files:');
  for (const m of missing) console.error(`- ${m}`);
  process.exit(1);
}

const plan = readFileSync('WorkBench/BUILD_PLAN.md', 'utf8');
const requiredSections = [
  '## Architecture Contract',
  '## Open Questions',
  '## File Map',
  '## Assumptions'
];

const missingSections = requiredSections.filter((s) => !plan.includes(s));
if (missingSections.length) {
  console.error('Plan sync failed. Missing required sections:');
  for (const s of missingSections) console.error(`- ${s}`);
  process.exit(1);
}

if (!plan.includes('renameContexts')) {
  console.error('Plan sync failed. renameContexts expectation missing.');
  process.exit(1);
}

if (!plan.includes('batchQueueState')) {
  console.error('Plan sync failed. batchQueueState expectation missing.');
  process.exit(1);
}

console.log('Plan sync checks passed.');
