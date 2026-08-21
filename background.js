import { buildFolderPath, parseQboFilename, resolveFilename } from './shared/tokens.js';
import { DEFAULTS, getSettings } from './shared/settings.js';
import { consumeRenameContext, emptyContexts, pruneContexts, resolveRenameContext } from './shared/rename-state.js';

const HISTORY_KEY = 'renameHistory';
const HISTORY_LIMIT = 5000;
const BATCH_KEY = 'batchQueueState';
const BATCH_TIMEOUT_MS = 30000;
const BATCH_CONCURRENCY = 2;
const CONTEXT_KEY = 'renameContexts';

const batchTimeouts = new Map();
const blobJobs = new Map();
let historyWriteQueue = Promise.resolve();
let batchWriteQueue = Promise.resolve();
let contextWriteQueue = Promise.resolve();

chrome.storage.session.setAccessLevel({
  accessLevel: 'TRUSTED_CONTEXTS'
}).catch((err) => console.log('[Apex] setAccessLevel error:', err.message));
chrome.storage.session.remove([
  'pendingRename',
  'currentTransaction',
  'blobRenameData',
  'blobTabId',
  'pendingFolderCopy'
]).catch((err) => console.log('[Apex] legacy state cleanup error:', err.message));

// Clear any badge left over from a previous SW session
chrome.action.setBadgeText({ text: '' });

(async () => {
  let tabs = await chrome.tabs.query({ url: 'https://qbo.intuit.com/app/*' });
  for (let tab of tabs) {
    if (!isTransactionUrl(tab.url)) continue;
    chrome.tabs.sendMessage(tab.id, { action: 'getTransactionData' }).then((response) => {
      if (response?.sourceUrl) return;
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['shared/qbo-data.js', 'content.js']
      }).catch((err) => console.log('[Apex] re-inject tab', tab.id, 'failed:', err.message));
    }).catch(() => {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['shared/qbo-data.js', 'content.js']
      }).catch((err) => console.log('[Apex] re-inject tab', tab.id, 'failed:', err.message));
    });
  }
})();

recoverBatchState().catch((err) => {
  console.log('[Apex] batch recovery error:', err.message);
});

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  let suggested = false;
  let safeSuggest = (opts) => {
    if (suggested) return false;
    suggested = true;
    suggest(opts);
    return true;
  };

  let timeout = setTimeout(() => {
    console.log('[Apex] rename timed out, using original filename');
    if (safeSuggest({ filename: item.filename })) {
      notifyRenameFailure('Rename timed out; kept the original filename.');
    }
  }, 5000);

  renameDownload(item, safeSuggest).catch((err) => {
    console.log('[Apex] rename error:', err.message);
    if (safeSuggest({ filename: item.filename })) {
      notifyRenameFailure('Rename failed; kept the original filename.');
    }
  }).finally(() => clearTimeout(timeout));

  return true;
});

chrome.downloads.onChanged.addListener((delta) => {
  handleDownloadChange(delta).catch((err) => {
    console.log('[Apex] download change error:', err.message);
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  let blobUrl = qboBlobUrl(tab, changeInfo);
  if (blobUrl) queueBlobTab(tabId, blobUrl, tab.openerTabId);

  if (changeInfo.status === 'complete') {
    handleBatchTabReady(tabId).catch((err) => {
      console.log('[Apex] batch tab ready error:', err.message);
    });
  }
});

chrome.tabs.onCreated.addListener((tab) => {
  let blobUrl = qboBlobUrl(tab);
  if (blobUrl) queueBlobTab(tab.id, blobUrl, tab.openerTabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  updateContexts((contexts) => {
    delete contexts.transactions[tabId];
    delete contexts.blobs[tabId];
    for (let [key, item] of Object.entries(contexts.pending)) {
      if (item.sourceTabId === tabId) delete contexts.pending[key];
    }
    return contexts;
  });
});

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details.frameId !== 0) return;
  chrome.tabs.sendMessage(details.tabId, { action: 'navigate' }).catch(() => {});
}, {
  url: [{ hostContains: 'qbo.intuit.com' }]
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) {
    sendResponse({ ok: false, error: 'unauthorized_sender' });
    return;
  }

  if (msg.action === 'transactionObserved' || msg.action === 'prepareRename') {
    storeTransactionMessage(msg, sender).then(() => {
      sendResponse({ ok: true });
    }).catch((err) => {
      sendResponse({ ok: false, error: err.message });
    });
    return true;
  }

  if (msg.action === 'batchGetState') {
    getBatchState().then((state) => {
      sendResponse({ ok: true, state });
    }).catch((err) => {
      sendResponse({ ok: false, error: err.message });
    });
    return true;
  }

  if (msg.action === 'batchStart') {
    let items = (msg.items || []).filter((item) =>
      typeof item?.url === 'string' && isTransactionUrl(item.url)
    );
    startBatch(items, msg.sourceTabId || null).then((state) => {
      sendResponse({ ok: true, state });
    }).catch((err) => {
      sendResponse({ ok: false, error: err.message });
    });
    return true;
  }

  if (msg.action === 'batchCancel') {
    cancelBatch('Cancelled by user').then((state) => {
      sendResponse({ ok: true, state });
    }).catch((err) => {
      sendResponse({ ok: false, error: err.message });
    });
    return true;
  }
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.sync.set(DEFAULTS);
  }
  console.log('[Apex] installed/updated:', details.reason);
});

function isTransactionUrl(url = '') {
  return /^https:\/\/qbo\.intuit\.com\/app\/(estimate|invoice|salesreceipt|purchaseorder|creditmemo|bill|refundreceipt|check|vendorcredit|journalentry|deposit|expense|transfer|payment)(?:[/?#]|$)/i.test(url);
}

function qboBlobUrl(tab, changeInfo = {}) {
  return [changeInfo.url, tab.pendingUrl, tab.url]
    .find((url) => url?.startsWith('blob:https://qbo.intuit.com')) || '';
}

function queueBlobTab(tabId, blobUrl, openerTabId) {
  if (!tabId || blobJobs.has(tabId)) return;
  let job = new Promise((resolve) => setTimeout(resolve, 50)).then(async () => {
    let tab = await chrome.tabs.get(tabId);
    await handleBlobTab(tabId, { ...tab, openerTabId: tab.openerTabId || openerTabId }, blobUrl);
  }).catch((err) => {
    console.log('[Apex] blob tab error:', err.message);
  }).finally(() => blobJobs.delete(tabId));
  blobJobs.set(tabId, job);
}

async function getContexts() {
  let stored = await chrome.storage.session.get(CONTEXT_KEY);
  return pruneContexts(stored[CONTEXT_KEY] || emptyContexts());
}

function updateContexts(updater) {
  let task = contextWriteQueue.catch(() => null).then(async () => {
    let contexts = await getContexts();
    let next = await updater(contexts) || contexts;
    await chrome.storage.session.set({ [CONTEXT_KEY]: pruneContexts(next) });
    return next;
  });
  contextWriteQueue = task.catch((err) => {
    console.log('[Apex] context write error:', err.message);
    return null;
  });
  return task;
}

async function storeTransactionMessage(msg, sender) {
  let tabId = sender.tab?.id;
  let sourceUrl = msg.snapshot?.sourceUrl;
  if (!tabId || !isTransactionUrl(sourceUrl) || !isTransactionUrl(sender.tab?.url) || !msg.snapshot?.data) {
    throw new Error('Invalid transaction context.');
  }

  await updateContexts((contexts) => {
    let observed = {
      sourceTabId: tabId,
      sourceUrl,
      data: msg.snapshot.data,
      missingTokens: msg.snapshot.missingTokens || [],
      observedAt: msg.snapshot.observedAt || Date.now()
    };
    contexts.transactions[tabId] = observed;

    if (msg.action === 'prepareRename') {
      for (let [key, item] of Object.entries(contexts.pending)) {
        if (item.sourceTabId === tabId && item.action === msg.renameAction) delete contexts.pending[key];
      }
      let id = `${tabId}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      contexts.pending[id] = {
        ...observed,
        action: msg.renameAction,
        batchItemId: msg.batchItemId || '',
        createdAt: Date.now()
      };
    }
    return contexts;
  });
}

function tokenData(data, settings) {
  return { ...data, dateFormat: settings.dateFormat };
}

async function renameDownload(item, suggest) {
  let settings = await getSettings();
  if (!settings.enabled) {
    suggest({ filename: item.filename });
    return;
  }

  let isQboBlob = item.url?.startsWith('blob:https://qbo.intuit.com');
  let parsed = parseQboFilename(item.filename);
  if (!isQboBlob && !parsed) {
    suggest({ filename: item.filename });
    return;
  }

  let contexts = await getContexts();
  let match = resolveRenameContext(item, contexts, parsed);
  if (!match?.context?.data) {
    suggest({ filename: item.filename });
    notifyRenameFailure('Could not match this download to a QBO transaction.');
    return;
  }

  let data = match.context.data;
  let values = tokenData(data, settings);
  let result = resolveFilename(settings.format, values, { requireComplete: ['num', 'customer'] });
  if (result.fallbackKind === 'timestamp') {
    suggest({ filename: item.filename });
    notifyRenameFailure('Transaction number and customer were unavailable.');
    return;
  }

  let renamedTo = result.name + '.pdf';
  let fromBlobViewer = match.source === 'blob';
  let folder = !fromBlobViewer && settings.folderEnabled
    ? buildFolderPath(settings.folderPattern, values)
    : '';
  let filename = folder ? `${folder}/${renamedTo}` : renamedTo;

  if (match.context.batchItemId) {
    await attachBatchDownload(match.context.batchItemId, item.id);
  }

  await updateContexts((current) => {
    consumeRenameContext(current, match);
    current.history[item.id] = {
      id: `${Date.now()}-${item.id}`,
      originalName: item.filename,
      renamedTo,
      folder: folder ? `${folder}/` : '',
      downloadId: item.id,
      timestamp: Date.now(),
      txnType: data.type || '',
      txnNum: data.num || '',
      customer: data.customer || ''
    };
    return current;
  });

  if (!suggest({ filename, conflictAction: 'uniquify' })) {
    await updateContexts((current) => {
      delete current.history[item.id];
      return current;
    });
    return;
  }
  if (result.missingTokens.length) {
    notifyRenameFailure(`Missing ${result.missingTokens.join(', ')}; used ${result.name}.`);
  } else if (settings.notifyMode !== 'off') {
    notifyRename(filename, settings.notifyMode);
  }
}

async function handleBlobTab(tabId, tab, blobUrl) {
  let settings = await getSettings();
  if (!settings.enabled) return;

  let contexts = await getContexts();
  let openerTabId = tab.openerTabId;
  let candidates = Object.values(contexts.pending)
    .filter((item) => item.action === 'print' && (!openerTabId || item.sourceTabId === openerTabId))
    .sort((a, b) => b.createdAt - a.createdAt);
  let candidate = openerTabId ? candidates[0] : (candidates.length === 1 ? candidates[0] : null);
  let data = candidate?.data || null;
  if (!openerTabId) {
    openerTabId = candidate?.sourceTabId;
  }
  if (!openerTabId) {
    notifyRenameFailure('Print preview could not be matched to its QBO tab.');
    return;
  }

  let response = null;
  if (!data || candidate?.missingTokens?.includes('customer')) {
    try {
      response = await chrome.tabs.sendMessage(openerTabId, {
        action: 'getTransactionData',
        waitForReady: true
      });
    } catch (err) {
      console.log('[Apex] could not query opener tab:', err.message);
    }
  }

  data = response?.data || data;
  if (!data) {
    candidates = Object.values(contexts.pending)
      .filter((item) => item.sourceTabId === openerTabId && item.action === 'print')
      .sort((a, b) => b.createdAt - a.createdAt);
    data = candidates[0]?.data;
  }
  if (!data?.num) {
    notifyRenameFailure('Print preview opened before transaction data was available.');
    return;
  }

  let result = resolveFilename(settings.format, tokenData(data, settings), {
    requireComplete: ['num', 'customer']
  });
  if (result.fallbackKind === 'timestamp') {
    notifyRenameFailure('Print preview could not identify this transaction.');
    return;
  }

  await updateContexts((contexts) => {
    contexts.blobs[tabId] = {
      sourceTabId: openerTabId,
      sourceUrl: response?.sourceUrl || candidate?.sourceUrl || '',
      blobUrl,
      data,
      createdAt: Date.now()
    };
    for (let [key, item] of Object.entries(contexts.pending)) {
      if (item.sourceTabId === openerTabId && item.action === 'print') delete contexts.pending[key];
    }
    return contexts;
  });

  await setBlobTitle(tabId, result.name);

  if (result.missingTokens.length) {
    notifyRenameFailure(`Missing ${result.missingTokens.join(', ')}; print title is ${result.name}.`);
  }
  console.log('[Apex] blob tab ready:', result.name);
}

async function setBlobTitle(tabId, title) {
  let lastError;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: (value) => { document.title = value; },
        args: [title],
        injectImmediately: true
      });
      return;
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  console.log('[Apex] could not set blob tab title:', lastError?.message || 'unknown error');
}

function notifyRename(filename, mode) {
  chrome.action.setBadgeText({ text: '\u2713' });
  chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 3000);

  if (mode === 'toast') {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'Apex Explorer',
      message: 'Saved as: ' + filename
    });
  }
}

function notifyRenameFailure(message = '') {
  chrome.action.setBadgeText({ text: '!' });
  chrome.action.setBadgeBackgroundColor({ color: '#D32F2F' });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 3000);
  if (message) console.log('[Apex] rename incomplete:', message);
}

function queueHistoryAppend(entry) {
  historyWriteQueue = historyWriteQueue.then(async () => {
    let stored = await chrome.storage.local.get(HISTORY_KEY);
    let history = stored[HISTORY_KEY] || [];
    history.unshift(entry);
    if (history.length > HISTORY_LIMIT) history = history.slice(0, HISTORY_LIMIT);
    await chrome.storage.local.set({ [HISTORY_KEY]: history });
  }).catch((err) => {
    console.log('[Apex] history write error:', err.message);
  });
  return historyWriteQueue;
}

async function handleDownloadChange(delta) {
  if (!delta.id || !delta.state?.current) return;

  let entry = null;
  await updateContexts((contexts) => {
    if (delta.state.current === 'complete') entry = contexts.history[delta.id] || null;
    if (delta.state.current === 'complete' || delta.state.current === 'interrupted') {
      delete contexts.history[delta.id];
    }
    return contexts;
  });
  if (entry) await queueHistoryAppend(entry);
  await handleBatchDownloadChange(delta);
}

async function getBatchState() {
  let stored = await chrome.storage.session.get(BATCH_KEY);
  return stored[BATCH_KEY] || null;
}

function queueBatchUpdate(updater) {
  batchWriteQueue = batchWriteQueue.then(async () => {
    let state = await getBatchState();
    let next = await updater(state);
    if (next) {
      await chrome.storage.session.set({ [BATCH_KEY]: next });
      return next;
    }
    return state;
  }).catch((err) => {
    console.log('[Apex] batch update error:', err.message);
    return null;
  });

  return batchWriteQueue;
}

async function startBatch(items, sourceTabId) {
  let unique = [];
  let seen = new Set();
  for (let item of items) {
    let url = item?.url?.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    unique.push({
      id: `batch-${Date.now()}-${unique.length + 1}`,
      url,
      type: item.type || '',
      num: item.num || '',
      status: 'pending',
      error: '',
      tabId: null,
      downloadId: null,
      triggeredAt: 0
    });
  }

  if (!unique.length) {
    throw new Error('No valid selected transactions found for batch.');
  }

  let state = {
    items: unique,
    startedAt: Date.now(),
    sourceTabId: sourceTabId || null,
    concurrency: BATCH_CONCURRENCY,
    cancelled: false
  };

  await chrome.storage.session.set({ [BATCH_KEY]: state });
  processBatchQueue();
  return state;
}

async function cancelBatch(reason) {
  let closeTabs = [];
  let state = await queueBatchUpdate((current) => {
    if (!current) return current;
    current.cancelled = true;
    for (let item of current.items) {
      if (item.status === 'pending' || item.status === 'downloading') {
        item.status = 'failed';
        item.error = reason;
      }
      if (item.tabId) closeTabs.push(item.tabId);
    }
    return current;
  });

  for (let item of state?.items || []) {
    clearBatchTimeout(item.id);
  }
  for (let tabId of closeTabs) {
    chrome.tabs.remove(tabId).catch(() => {});
  }

  return state;
}

async function recoverBatchState() {
  let closeTabs = [];
  await queueBatchUpdate((state) => {
    if (!state) return state;
    for (let item of state.items) {
      if (item.status === 'downloading') {
        item.status = 'failed';
        item.error = 'Service worker restarted';
      }
      if (item.tabId && item.status !== 'done') closeTabs.push(item.tabId);
    }
    return state;
  });

  for (let tabId of closeTabs) {
    chrome.tabs.remove(tabId).catch(() => {});
  }

  processBatchQueue();
}

async function processBatchQueue() {
  // All state transitions happen atomically inside queueBatchUpdate, which is
  // a serial promise chain — no global boolean flag needed, safe across SW restarts.
  let toStart = [];
  await queueBatchUpdate((state) => {
    if (!state || state.cancelled) return state;
    let active = state.items.filter((i) => i.status === 'downloading').length;
    while (active < state.concurrency) {
      let next = state.items.find((i) => i.status === 'pending');
      if (!next) break;
      next.status = 'downloading';
      next.error = '';
      toStart.push(next.id);
      active++;
    }
    return state;
  });
  for (let id of toStart) {
    startBatchItem(id).catch((err) => failBatchItem(id, err.message || 'Unknown batch error'));
  }
}

async function startBatchItem(itemId) {
  let state = await getBatchState();
  if (!state || state.cancelled) return;
  let item = state.items.find((x) => x.id === itemId);
  if (!item || item.status !== 'downloading') return;

  try {
    let tab = await chrome.tabs.create({ url: item.url, active: false });
    await queueBatchUpdate((current) => {
      if (!current) return current;
      let target = current.items.find((x) => x.id === itemId);
      if (!target) return current;
      target.tabId = tab.id;
      return current;
    });
    setBatchTimeout(itemId);
  } catch {
    failBatchItem(itemId, 'Could not open transaction tab');
  }
}

function setBatchTimeout(itemId) {
  clearBatchTimeout(itemId);
  let timer = setTimeout(() => {
    failBatchItem(itemId, 'Timed out after 30 seconds');
  }, BATCH_TIMEOUT_MS);
  batchTimeouts.set(itemId, timer);
}

function clearBatchTimeout(itemId) {
  let timer = batchTimeouts.get(itemId);
  if (!timer) return;
  clearTimeout(timer);
  batchTimeouts.delete(itemId);
}

async function handleBatchTabReady(tabId) {
  let state = await getBatchState();
  if (!state || state.cancelled) return;

  let item = state.items.find((x) => x.tabId === tabId && x.status === 'downloading' && !x.triggeredAt);
  if (!item) return;

  // Guard against Chrome reusing a closed batch tab's ID for a non-QBO tab
  try {
    let tab = await chrome.tabs.get(tabId);
    if (!tab.url?.startsWith('https://qbo.intuit.com/')) return;
  } catch {
    return;
  }

  try {
    let response = await sendBatchTrigger(tabId, item.id);
    if (!response?.ok) throw new Error(response?.error || 'Download trigger failed');

    await queueBatchUpdate((current) => {
      if (!current) return current;
      let target = current.items.find((x) => x.id === item.id);
      if (!target) return current;
      target.triggeredAt = Date.now();
      return current;
    });
  } catch (err) {
    failBatchItem(item.id, err.message || 'Could not trigger download on transaction tab');
  }
}

async function sendBatchTrigger(tabId, itemId) {
  let lastError;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      return await chrome.tabs.sendMessage(tabId, {
        action: 'triggerDownload',
        batchItemId: itemId
      });
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError || new Error('Transaction content script did not become ready.');
}

function attachBatchDownload(itemId, downloadId) {
  return queueBatchUpdate((state) => {
    if (!state) return state;
    let item = state.items.find((x) => x.id === itemId);
    if (!item) return state;
    item.downloadId = downloadId;
    return state;
  });
}

async function handleBatchDownloadChange(delta) {
  if (!delta.id || !delta.state?.current) return;
  let state = await getBatchState();
  if (!state) return;

  let item = state.items.find((x) => x.downloadId === delta.id && x.status === 'downloading');
  if (!item) return;

  if (delta.state.current === 'complete') {
    await completeBatchItem(item.id);
    return;
  }

  if (delta.state.current === 'interrupted') {
    await failBatchItem(item.id, 'Download interrupted');
  }
}

async function completeBatchItem(itemId) {
  let tabId = null;
  await queueBatchUpdate((state) => {
    if (!state) return state;
    let item = state.items.find((x) => x.id === itemId);
    if (!item) return state;
    item.status = 'done';
    tabId = item.tabId;
    item.tabId = null; // prevent stale ID match if Chrome reuses this tabId
    return state;
  });

  clearBatchTimeout(itemId);
  if (tabId) chrome.tabs.remove(tabId).catch(() => {});
  processBatchQueue();
}

async function failBatchItem(itemId, reason) {
  let tabId = null;
  await queueBatchUpdate((state) => {
    if (!state) return state;
    let item = state.items.find((x) => x.id === itemId);
    if (!item || item.status === 'done' || item.status === 'failed') return state;
    item.status = 'failed';
    item.error = reason;
    tabId = item.tabId;
    item.tabId = null; // prevent stale ID match if Chrome reuses this tabId
    return state;
  });

  clearBatchTimeout(itemId);
  if (tabId) chrome.tabs.remove(tabId).catch(() => {});
  processBatchQueue();
}
