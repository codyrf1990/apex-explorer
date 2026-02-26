import { buildFilename, parseQboFilename } from './shared/tokens.js';
import { DEFAULTS, getSettings } from './shared/settings.js';

// -- Session storage access for content scripts (MUST be at top level) --
chrome.storage.session.setAccessLevel({
  accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS'
});

// -- Download filename renaming --
// This listener MUST be at top level and MUST return true synchronously.
// The async-wrapper-with-catch pattern guarantees suggest() is always called.

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  renameDownload(item, suggest).catch(() => {
    suggest({ filename: item.filename });
  });
  return true;
});

async function renameDownload(item, suggest) {
  let settings = await getSettings();
  if (!settings.enabled) {
    suggest({ filename: item.filename });
    return;
  }

  // Only intercept QBO blob downloads or QBO-pattern filenames
  let isQboBlob = item.url?.startsWith('blob:https://qbo.intuit.com');
  let isQboFile = item.filename?.match(/^(Estimate|Invoice|Sales Receipt|Purchase Order|Credit Memo|Bill|Refund Receipt)\s+\d+/i);

  if (!isQboBlob && !isQboFile) {
    suggest({ filename: item.filename });
    return;
  }

  let data = null;

  // 1st: pendingRename from click interception
  let { pendingRename } = await chrome.storage.session.get('pendingRename');
  if (pendingRename && (Date.now() - pendingRename.timestamp < 15000)) {
    data = pendingRename;
  }

  // 2nd: blobRenameData cached when blob tab opened (covers PDF viewer download)
  if (!data && isQboBlob) {
    let { blobRenameData } = await chrome.storage.session.get('blobRenameData');
    if (blobRenameData && (Date.now() - blobRenameData.timestamp < 300000)) {
      data = blobRenameData;
      console.log('[Apex] using blobRenameData fallback');
    }
  }

  // 3rd: currentTransaction from session storage
  if (!data) {
    let stored = await chrome.storage.session.get('currentTransaction');
    if (stored.currentTransaction) {
      data = stored.currentTransaction;
      console.log('[Apex] using currentTransaction fallback');
    }
  }

  // 4th: parse the original QBO filename for partial data
  if (!data) {
    data = parseQboFilename(item.filename);
    if (data) console.log('[Apex] using filename parse fallback:', item.filename);
  }

  if (!data) {
    suggest({ filename: item.filename });
    return;
  }

  let filename = buildFilename(settings.format, {
    num: data.num,
    customer: data.customer,
    type: data.type,
    dateFormat: settings.dateFormat
  }) + '.pdf';

  suggest({ filename, conflictAction: 'uniquify' });

  // Cleanup and notification after suggest — wrapped so a failure here
  // can't trigger the .catch() fallback and double-call suggest()
  try {
    if (pendingRename) chrome.storage.session.remove('pendingRename');
    if (settings.notifyMode !== 'off') notifyRename(filename, settings.notifyMode);
  } catch (e) {
    console.log('[Apex] post-rename cleanup error:', e.message);
  }
}

// -- Blob tab handling --
// QBO opens blob tabs for print preview. Set document.title (for Ctrl+P)
// and cache rename data (for downloads from the PDF viewer).

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!tab.url?.startsWith('blob:https://qbo.intuit.com')) return;
  if (changeInfo.status !== 'complete') return;
  handleBlobTab(tabId, tab);
});

async function handleBlobTab(tabId, tab) {
  let settings = await getSettings();
  if (!settings.enabled) return;

  let data = null;

  // 1st: pendingRename from click interception (highest confidence)
  let { pendingRename } = await chrome.storage.session.get('pendingRename');
  if (pendingRename && (Date.now() - pendingRename.timestamp < 15000)) {
    data = pendingRename;
  }

  // 2nd: ask the opener tab's content script for live data
  if (!data && tab.openerTabId) {
    try {
      data = await chrome.tabs.sendMessage(tab.openerTabId, { action: 'getTransactionData' });
    } catch (e) {
      console.log('[Apex] could not query opener tab:', e.message);
    }
  }

  // 3rd: currentTransaction from session storage
  if (!data) {
    let stored = await chrome.storage.session.get('currentTransaction');
    data = stored.currentTransaction;
  }

  if (!data?.num) return;

  let title = buildFilename(settings.format, {
    num: data.num,
    customer: data.customer,
    type: data.type,
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

  // Cache for downloads triggered later from this blob tab
  chrome.storage.session.set({
    blobRenameData: { num: data.num, customer: data.customer, type: data.type, timestamp: Date.now() }
  });

  if (pendingRename) chrome.storage.session.remove('pendingRename');
  console.log('[Apex] blob tab ready:', title);
}

// -- SPA navigation bridge --
// webNavigation catches QBO's pushState navigations from the service worker side.

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details.frameId !== 0) return;
  chrome.tabs.sendMessage(details.tabId, { action: 'navigate' }).catch(() => {});
}, {
  url: [{ hostContains: 'qbo.intuit.com' }]
});

// -- Notification --

function notifyRename(filename, mode) {
  // Badge checkmark — shown for both 'badge' and 'toast' modes
  chrome.action.setBadgeText({ text: '\u2713' });
  chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 3000);

  // System notification toast — only in 'toast' mode
  if (mode === 'toast') {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'Apex Explorer',
      message: 'Saved as: ' + filename
    });
  }
}

// -- Install / update handler --

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.sync.set(DEFAULTS);
  }

  // Re-inject content script into existing QBO tabs after extension update
  if (details.reason === 'update') {
    chrome.tabs.query({ url: 'https://qbo.intuit.com/app/*' }, (tabs) => {
      for (let tab of tabs) {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        }).catch(() => {});
      }
    });
  }

  console.log('[Apex] installed/updated:', details.reason);
});
