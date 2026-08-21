function normalizeBase(str) {
  let out = str.replace(/[<>:"/\\|?*]/g, '');
  out = Array.from(out, (ch) => (ch.charCodeAt(0) < 32 ? '' : ch)).join('');
  out = out.replace(/\s{2,}/g, ' ').replace(/-{3,}/g, '--');
  return out.replace(/^[\s.-]+|[\s.-]+$/g, '');
}

function withTokens(pattern, data) {
  return pattern
    .replaceAll('{num}', data.num || '')
    .replaceAll('{customer}', data.customer || '')
    .replaceAll('{type}', data.type || '')
    .replaceAll('{date}', formatDate(data.dateFormat || 'YYYY-MM-DD', data.date))
    .replaceAll('{txndate}', data.txnDate || '')
    .replaceAll('{amount}', data.amount || '')
    .replaceAll('{po}', data.po || '')
    .replaceAll('{status}', data.status || '');
}

export function requiredTokens(format) {
  let pattern = typeof format === 'string' && format.trim() ? format : '{num} - {customer}';
  return ['num', 'customer', 'type', 'date', 'txndate', 'amount', 'po', 'status']
    .filter((token) => pattern.includes(`{${token}}`));
}

export function formatDate(fmt, date = new Date()) {
  let y = date.getFullYear();
  let m = String(date.getMonth() + 1).padStart(2, '0');
  let day = String(date.getDate()).padStart(2, '0');

  return fmt
    .replace('YYYY', y)
    .replace('MM', m)
    .replace('DD', day);
}

export function resolveFilename(format, data, options = {}) {
  let pattern = typeof format === 'string' && format.trim() ? format : '{num} - {customer}';
  let missingTokens = requiredTokens(pattern).filter((token) => token !== 'date' && !data?.[token]);
  let name = normalizeBase(withTokens(pattern, data || {}));

  let blocking = options.requireComplete === true
    ? missingTokens
    : missingTokens.filter((token) => options.requireComplete?.includes(token));
  if (blocking.length) name = '';
  if (name) return { name, missingTokens, usedFallback: false, fallbackKind: '' };

  return fallbackFilename(data, missingTokens);
}

function fallbackFilename(data, missingTokens) {
  let identity = normalizeBase([data?.type, data?.num].filter(Boolean).join(' '));
  if (identity) return { name: identity, missingTokens, usedFallback: true, fallbackKind: 'identity' };
  return { name: 'QBO_Document_' + Date.now(), missingTokens, usedFallback: true, fallbackKind: 'timestamp' };
}

export function buildFilename(format, data) {
  return resolveFilename(format, data).name;
}

export function buildFolderPath(pattern, data) {
  let folderData = {};
  for (let [key, value] of Object.entries(data || {})) {
    folderData[key] = typeof value === 'string' ? normalizeBase(value) : value;
  }
  let raw = withTokens(pattern, folderData).replaceAll('\\', '/');
  let parts = raw.split('/');
  let clean = [];

  for (let part of parts) {
    let trimmed = part.trim();
    if (!trimmed || trimmed === '.' || trimmed === '..') continue;
    let safe = normalizeBase(trimmed);
    if (safe) clean.push(safe);
  }

  return clean.join('/');
}

export function parseQboFilename(filename) {
  let base = filename?.split(/[\\/]/).at(-1)?.replace(/\.pdf$/i, '') || '';
  let match = base.match(/^(Estimate|Invoice|Sales Receipt|Purchase Order|Credit Memo|Bill|Refund Receipt|Check|Vendor Credit|Journal Entry|Deposit|Expense|Transfer|Payment)\s+(.+)$/i);
  if (!match) return null;
  return { type: match[1], num: match[2], customer: '' };
}
