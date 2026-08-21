export const CONTEXT_TTL_MS = 30000;
export const BLOB_TTL_MS = 300000;

export function emptyContexts() {
  return { transactions: {}, pending: {}, blobs: {}, history: {} };
}

export function pruneContexts(value, now = Date.now()) {
  let contexts = value || emptyContexts();
  contexts.transactions ||= {};
  contexts.pending ||= {};
  contexts.blobs ||= {};
  contexts.history ||= {};

  pruneMap(contexts.transactions, 'observedAt', BLOB_TTL_MS, now);
  pruneMap(contexts.pending, 'createdAt', CONTEXT_TTL_MS, now);
  pruneMap(contexts.blobs, 'createdAt', BLOB_TTL_MS, now);
  pruneMap(contexts.history, 'timestamp', BLOB_TTL_MS, now);
  return contexts;
}

function pruneMap(map, timestampKey, maxAge, now) {
  for (let [key, item] of Object.entries(map)) {
    let timestamp = item?.[timestampKey];
    if (!timestamp || now - timestamp > maxAge) delete map[key];
  }
}

function same(value, expected) {
  return String(value || '').trim().toLowerCase() === String(expected || '').trim().toLowerCase();
}

function sameDocumentUrl(value, expected) {
  try {
    let left = new URL(value);
    let right = new URL(expected);
    left.hash = '';
    right.hash = '';
    return left.href === right.href;
  } catch {
    return value === expected;
  }
}

export function identityMatches(data, parsed) {
  if (!data || !parsed?.num || !same(data.num, parsed.num)) return false;
  return !parsed.type || !data.type || same(data.type, parsed.type);
}

function unique(items) {
  return items.length === 1 ? items[0] : null;
}

function matchedEntry(entries, predicate) {
  return unique(entries.filter(predicate));
}

function resolveBlobContext(item, blobs, pending) {
  let exactBlob = matchedEntry(blobs, ([, value]) => value.blobUrl === item.url);
  if (exactBlob) return { source: 'blob', key: exactBlob[0], context: exactBlob[1] };
  if (!item.url?.startsWith('blob:https://qbo.intuit.com')) return null;

  let printMatch = matchedEntry(pending, ([, value]) => value.action === 'print');
  return printMatch
    ? { source: 'pending', key: printMatch[0], context: printMatch[1] }
    : null;
}

export function resolveRenameContext(item, contexts, parsed, now = Date.now()) {
  let current = pruneContexts(contexts, now);
  let blobs = Object.entries(current.blobs);
  let pending = Object.entries(current.pending);
  let blobMatch = resolveBlobContext(item, blobs, pending);
  if (blobMatch) return blobMatch;

  let matchedPending = pending.filter(([, value]) => {
    let referrerMatches = item.referrer && sameDocumentUrl(value.sourceUrl, item.referrer);
    let identity = parsed && identityMatches(value.data, parsed);
    return referrerMatches && (!parsed || identity);
  });
  let pendingMatch = unique(matchedPending);

  if (!pendingMatch && parsed) {
    pendingMatch = unique(pending.filter(([, value]) => identityMatches(value.data, parsed)));
  }
  if (pendingMatch) return { source: 'pending', key: pendingMatch[0], context: pendingMatch[1] };

  if (item.referrer) {
    let transactions = Object.entries(current.transactions)
      .filter(([, value]) => sameDocumentUrl(value.sourceUrl, item.referrer)
        && (!parsed || identityMatches(value.data, parsed)));
    let transaction = unique(transactions);
    if (transaction) return { source: 'transaction', key: transaction[0], context: transaction[1] };
  }

  return parsed ? { source: 'filename', key: '', context: { data: parsed } } : null;
}

export function consumeRenameContext(contexts, match) {
  if (match?.source === 'pending') delete contexts.pending[match.key];
  if (match?.source === 'blob') delete contexts.blobs[match.key];
  return contexts;
}
