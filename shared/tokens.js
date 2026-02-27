function normalizeBase(str) {
  let out = str.replace(/[<>:"/\\|?*]/g, '');
  out = Array.from(out, (ch) => (ch.charCodeAt(0) < 32 ? '' : ch)).join('');
  out = out.replace(/\s{2,}/g, ' ').replace(/-{3,}/g, '--');
  return out.replace(/^[\s.]+|[\s.]+$/g, '');
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

export function formatDate(fmt, date = new Date()) {
  let y = date.getFullYear();
  let m = String(date.getMonth() + 1).padStart(2, '0');
  let day = String(date.getDate()).padStart(2, '0');

  return fmt
    .replace('YYYY', y)
    .replace('MM', m)
    .replace('DD', day);
}

export function buildFilename(format, data) {
  let name = normalizeBase(withTokens(format, data));
  return name || 'QBO_Document_' + Date.now();
}

export function buildFolderPath(pattern, data) {
  let raw = withTokens(pattern, data).replaceAll('\\', '/');
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
  let match = filename?.match(/^(Estimate|Invoice|Sales Receipt|Purchase Order|Credit Memo|Bill|Refund Receipt)\s+(\d+)/i);
  if (!match) return null;
  return { type: match[1], num: match[2], customer: '' };
}
