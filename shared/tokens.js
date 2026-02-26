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
  let name = format
    .replaceAll('{num}', data.num || '')
    .replaceAll('{customer}', data.customer || '')
    .replaceAll('{type}', data.type || '')
    .replaceAll('{date}', formatDate(data.dateFormat || 'YYYY-MM-DD', data.date));

  name = name.replace(/[<>:"/\\|?*]/g, '');
  name = Array.from(name, (ch) => (ch.charCodeAt(0) < 32 ? '' : ch)).join('');
  name = name.replace(/\s{2,}/g, ' ').replace(/-{3,}/g, '--');
  name = name.replace(/^[\s.]+|[\s.]+$/g, '');

  return name || 'QBO_Document_' + Date.now();
}

export function parseQboFilename(filename) {
  let match = filename?.match(/^(Estimate|Invoice|Sales Receipt|Purchase Order|Credit Memo|Bill|Refund Receipt)\s+(\d+)/i);
  if (!match) return null;
  return { type: match[1], num: match[2], customer: '' };
}
