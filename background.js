'use strict';

// -- Session storage access for content scripts (MUST be at top level) --
chrome.storage.session.setAccessLevel({
  accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS'
});

// -- Settings defaults --
const DEFAULTS = {
  enabled: true,
  format: '{num} - {customer}',
  dateFormat: 'YYYY-MM-DD',
  notifyMode: 'toast'
};

async function getSettings() {
  let settings = await chrome.storage.sync.get(DEFAULTS);

  // One-time migration: showNotification boolean → notifyMode enum
  if (typeof settings.showNotification === 'boolean') {
    settings.notifyMode = settings.showNotification ? 'toast' : 'off';
    chrome.storage.sync.remove('showNotification');
    chrome.storage.sync.set({ notifyMode: settings.notifyMode });
  }

  return settings;
}

// -- Filename building (pure function, no side effects) --

function buildFilename(format, data) {
  let name = format
    .replaceAll('{num}', data.num || '')
    .replaceAll('{customer}', data.customer || '')
    .replaceAll('{type}', data.type || '')
    .replaceAll('{date}', formatDate(data.dateFormat || 'YYYY-MM-DD'));

  // Strip illegal filename characters
  name = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '');
  // Collapse multiple spaces or dashes
  name = name.replace(/\s{2,}/g, ' ').replace(/-{3,}/g, '--');
  // Trim spaces and dots (Windows silently strips trailing dots)
  name = name.replace(/^[\s.]+|[\s.]+$/g, '');

  return name || 'QBO_Document_' + Date.now();
}

function formatDate(fmt) {
  let d = new Date();
  let y = d.getFullYear();
  let m = String(d.getMonth() + 1).padStart(2, '0');
  let day = String(d.getDate()).padStart(2, '0');

  return fmt
    .replace('YYYY', y)
    .replace('MM', m)
    .replace('DD', day);
}

// -- Fallback: parse QBO's default filename for partial data --
// QBO names files like "Estimate 87072.pdf" — extract what we can
function parseQboFilename(filename) {
  let match = filename?.match(/^(Estimate|Invoice|Sales Receipt|Purchase Order|Credit Memo|Bill|Refund Receipt)\s+(\d+)/i);
  if (!match) return null;
  return { type: match[1], num: match[2], customer: '' };
}

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

  let { pendingRename } = await chrome.storage.session.get('pendingRename');

  // Discard stale data (> 15 seconds old)
  if (pendingRename && (Date.now() - pendingRename.timestamp > 15000)) {
    console.log('[Apex] stale pendingRename discarded');
    pendingRename = null;
  }

  // Fallback: parse the original QBO filename for partial data
  if (!pendingRename) {
    let parsed = parseQboFilename(item.filename);
    if (parsed) {
      pendingRename = parsed;
      console.log('[Apex] using fallback from original filename:', item.filename);
    }
  }

  if (!pendingRename) {
    suggest({ filename: item.filename });
    return;
  }

  let filename = buildFilename(settings.format, {
    num: pendingRename.num,
    customer: pendingRename.customer,
    type: pendingRename.type,
    dateFormat: settings.dateFormat
  }) + '.pdf';

  suggest({ filename, conflictAction: 'uniquify' });

  // Cleanup and notification after suggest — wrapped so a failure here
  // can't trigger the .catch() fallback and double-call suggest()
  try {
    chrome.storage.session.remove('pendingRename');
    if (settings.notifyMode !== 'off') notifyRename(filename, settings.notifyMode);
  } catch (e) {
    console.log('[Apex] post-rename cleanup error:', e.message);
  }
}

// -- Print tab title renaming --
// Detect blob tabs opened by QBO for print preview and set document.title.

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Bail fast for non-blob tabs
  if (!tab.url?.startsWith('blob:https://qbo.intuit.com')) return;
  // Wait until the blob content is loaded
  if (changeInfo.status !== 'complete') return;

  renamePrintTab(tabId);
});

async function renamePrintTab(tabId) {
  let settings = await getSettings();
  if (!settings.enabled) return;

  let { pendingRename } = await chrome.storage.session.get('pendingRename');

  if (!pendingRename || (Date.now() - pendingRename.timestamp > 15000)) return;
  if (pendingRename.action !== 'print') return;

  let title = buildFilename(settings.format, {
    num: pendingRename.num,
    customer: pendingRename.customer,
    type: pendingRename.type,
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

  chrome.storage.session.remove('pendingRename');
}

// -- SPA navigation bridge --
// webNavigation catches QBO's pushState navigations from the service worker side.

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details.frameId !== 0) return;
  chrome.tabs.sendMessage(details.tabId, { action: 'navigate' }).catch(() => {});
}, {
  url: [{ hostContains: 'qbo.intuit.com' }]
});

// -- Hotkey commands --

chrome.commands.onCommand.addListener(async (command) => {
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.includes('qbo.intuit.com')) return;

  let action = command === 'trigger-print' ? 'triggerPrint' : 'triggerDownload';
  chrome.tabs.sendMessage(tab.id, { action }).catch(() => {});
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
