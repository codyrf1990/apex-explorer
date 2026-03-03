import { buildFilename, buildFolderPath, parseQboFilename } from './shared/tokens.js';
import { DEFAULTS, getSettings } from './shared/settings.js';

const HISTORY_KEY = 'renameHistory';
const HISTORY_LIMIT = 5000;
const BATCH_KEY = 'batchQueueState';
const BATCH_TIMEOUT_MS = 30000;
const BATCH_CONCURRENCY = 2;

const batchTimeouts = new Map();
let historyWriteQueue = Promise.resolve();
let batchWriteQueue = Promise.resolve();
let batchProcessing = false;

chrome.storage.session.setAccessLevel({
  accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS'
});

// Re-inject content scripts into any open QBO tabs whenever the service
// worker starts — covers extension reloads during development and SW restarts.
// The IIFE guard in content.js prevents double-injection if already running.
chrome.tabs.query({ url: 'https://qbo.intuit.com/app/*' }, (tabs) => {
  for (let tab of tabs) {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    }).catch(() => {});
  }
});

recoverBatchState().catch((err) => {
  console.log('[Apex] batch recovery error:', err.message);
});

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  let suggested = false;
  let safeSuggest = (opts) => {
    if (suggested) return;
    suggested = true;
    suggest(opts);
  };

  let timeout = setTimeout(() => {
    console.log('[Apex] rename timed out, using original filename');
    safeSuggest({ filename: item.filename });
  }, 5000);

  renameDownload(item, safeSuggest).catch((err) => {
    console.log('[Apex] rename error:', err.message);
    safeSuggest({ filename: item.filename });
  }).finally(() => clearTimeout(timeout));

  return true;
});

chrome.downloads.onChanged.addListener((delta) => {
  handleBatchDownloadChange(delta).catch((err) => {
    console.log('[Apex] batch download change error:', err.message);
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.url?.startsWith('blob:https://qbo.intuit.com') && changeInfo.status === 'complete') {
    handleBlobTab(tabId, tab);
  }

  if (changeInfo.status === 'complete') {
    handleBatchTabReady(tabId).catch((err) => {
      console.log('[Apex] batch tab ready error:', err.message);
    });
  }
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

  if (msg.action === 'batchGetState') {
    getBatchState().then((state) => {
      sendResponse({ ok: true, state });
    }).catch((err) => {
      sendResponse({ ok: false, error: err.message });
    });
    return true;
  }

  if (msg.action === 'batchStart') {
    startBatch(msg.items || [], msg.sourceTabId || null).then((state) => {
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

async function renameDownload(item, suggest) {
  let settings = await getSettings();
  if (!settings.enabled) {
    suggest({ filename: item.filename });
    return;
  }

  let isQboBlob = item.url?.startsWith('blob:https://qbo.intuit.com');
  let isQboFile = item.filename?.match(/^(Estimate|Invoice|Sales Receipt|Purchase Order|Credit Memo|Bill|Refund Receipt)\s+\d+/i);
  if (!isQboBlob && !isQboFile) {
    suggest({ filename: item.filename });
    return;
  }

  let data = null;
  let { pendingRename } = await chrome.storage.session.get('pendingRename');
  if (pendingRename && (Date.now() - pendingRename.timestamp < 15000)) {
    data = pendingRename;
  }

  if (!data && isQboBlob) {
    let { blobRenameData } = await chrome.storage.session.get('blobRenameData');
    if (blobRenameData && (Date.now() - blobRenameData.timestamp < 300000)) {
      data = blobRenameData;
      console.log('[Apex] using blobRenameData fallback');
    }
  }

  if (!data) {
    let stored = await chrome.storage.session.get('currentTransaction');
    if (stored.currentTransaction) {
      data = stored.currentTransaction;
      console.log('[Apex] using currentTransaction fallback');
    }
  }

  if (!data) {
    data = parseQboFilename(item.filename);
    if (data) console.log('[Apex] using filename parse fallback:', item.filename);
  }

  if (!data) {
    suggest({ filename: item.filename });
    notifyRenameFailure();
    return;
  }

  let tokenData = {
    num: data.num,
    customer: data.customer,
    type: data.type,
    txnDate: data.txnDate,
    amount: data.amount,
    po: data.po,
    status: data.status,
    dateFormat: settings.dateFormat
  };

  let renamedTo = buildFilename(settings.format, tokenData) + '.pdf';
  let folder = settings.folderEnabled ? buildFolderPath(settings.folderPattern || '{type}', tokenData) : '';
  let filename = folder ? `${folder}/${renamedTo}` : renamedTo;

  suggest({ filename, conflictAction: 'uniquify' });

  if (data.batchItemId) {
    attachBatchDownload(data.batchItemId, item.id);
  }

  queueHistoryAppend({
    id: `${Date.now()}-${item.id}-${Math.random().toString(16).slice(2, 8)}`,
    originalName: item.filename,
    renamedTo,
    folder: folder ? `${folder}/` : '',
    downloadId: item.id,
    timestamp: Date.now(),
    txnType: data.type || '',
    txnNum: data.num || '',
    customer: data.customer || ''
  });

  try {
    if (pendingRename) chrome.storage.session.remove('pendingRename');
    if (settings.notifyMode !== 'off') notifyRename(filename, settings.notifyMode);
  } catch (err) {
    console.log('[Apex] post-rename cleanup error:', err.message);
  }
}

async function handleBlobTab(tabId, tab) {
  let settings = await getSettings();
  if (!settings.enabled) return;

  let data = null;
  let { pendingRename } = await chrome.storage.session.get('pendingRename');
  if (pendingRename && (Date.now() - pendingRename.timestamp < 15000)) {
    data = pendingRename;
  }

  if (!data && tab.openerTabId) {
    try {
      data = await chrome.tabs.sendMessage(tab.openerTabId, { action: 'getTransactionData' });
    } catch (err) {
      console.log('[Apex] could not query opener tab:', err.message);
    }
  }

  if (!data) {
    let stored = await chrome.storage.session.get('currentTransaction');
    data = stored.currentTransaction;
  }

  if (!data?.num) return;

  let title = buildFilename(settings.format, {
    num: data.num,
    customer: data.customer,
    type: data.type,
    txnDate: data.txnDate,
    amount: data.amount,
    po: data.po,
    status: data.status,
    dateFormat: settings.dateFormat
  });

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (t) => { document.title = t; },
      args: [title]
    });
  } catch (err) {
    console.log('[Apex] could not set blob tab title:', err.message);
  }

  chrome.storage.session.set({
    blobRenameData: {
      num: data.num,
      customer: data.customer,
      type: data.type,
      txnDate: data.txnDate,
      amount: data.amount,
      po: data.po,
      status: data.status,
      timestamp: Date.now()
    }
  });

  if (pendingRename) chrome.storage.session.remove('pendingRename');
  console.log('[Apex] blob tab ready:', title);
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

function notifyRenameFailure() {
  chrome.action.setBadgeText({ text: '!' });
  chrome.action.setBadgeBackgroundColor({ color: '#D32F2F' });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 3000);
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
  if (batchProcessing) return;
  batchProcessing = true;

  try {
    let state = await getBatchState();
    if (!state || state.cancelled) return;

    let active = state.items.filter((item) => item.status === 'downloading').length;
    while (active < state.concurrency) {
      let nextItem = state.items.find((item) => item.status === 'pending');
      if (!nextItem) break;

      await queueBatchUpdate((current) => {
        if (!current || current.cancelled) return current;
        let item = current.items.find((x) => x.id === nextItem.id);
        if (!item || item.status !== 'pending') return current;
        item.status = 'downloading';
        item.error = '';
        return current;
      });

      startBatchItem(nextItem.id).catch((err) => {
        failBatchItem(nextItem.id, err.message || 'Unknown batch error');
      });

      state = await getBatchState();
      if (!state || state.cancelled) break;
      active = state.items.filter((item) => item.status === 'downloading').length;
    }
  } finally {
    batchProcessing = false;
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

  try {
    await chrome.tabs.sendMessage(tabId, {
      action: 'triggerDownload',
      batchItemId: item.id
    });

    await queueBatchUpdate((current) => {
      if (!current) return current;
      let target = current.items.find((x) => x.id === item.id);
      if (!target) return current;
      target.triggeredAt = Date.now();
      return current;
    });
  } catch {
    failBatchItem(item.id, 'Could not trigger download on transaction tab');
  }
}

function attachBatchDownload(itemId, downloadId) {
  queueBatchUpdate((state) => {
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
    completeBatchItem(item.id);
    return;
  }

  if (delta.state.current === 'interrupted') {
    failBatchItem(item.id, 'Download interrupted');
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
    return state;
  });

  clearBatchTimeout(itemId);
  if (tabId) chrome.tabs.remove(tabId).catch(() => {});
  processBatchQueue();
}
