(function () {
'use strict';

const TXN_PATH = /^\/app\/(estimate|invoice|salesreceipt|purchaseorder|creditmemo|bill|refundreceipt|check|vendorcredit|journalentry|deposit|expense|transfer|payment)(?:[/?#]|$)/i;
if (location.hostname === 'qbo.intuit.com' && !TXN_PATH.test(location.pathname)) return;
if (document.__apexLoaded) return;
document.__apexLoaded = true;

const DEFAULT_FORMAT = '{num} - {customer}';
const READY_ATTEMPTS = 20;
const READY_DELAY_MS = 250;

let format = DEFAULT_FORMAT;
let lastUrl = location.href;
let navTimer;
let readGeneration = 0;
let dead = false;
let ignoredActionClick = '';

function teardown() {
  if (dead) return;
  dead = true;
  document.__apexLoaded = false;
  observer.disconnect();
  document.removeEventListener('click', onClick, true);
  chrome.storage?.onChanged?.removeListener(onStorageChanged);
  clearTimeout(navTimer);
  console.log('[Apex] context invalidated — torn down');
}

function alive() {
  if (dead) return false;
  try {
    if (!chrome.runtime?.id) {
      teardown();
      return false;
    }
    return true;
  } catch {
    teardown();
    return false;
  }
}

function snapshot() {
  return globalThis.ApexQboData.readTransactionSnapshot(document, location, format);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForReady(generation = readGeneration) {
  let result = snapshot();
  for (let attempt = 1; !result.ready && attempt < READY_ATTEMPTS; attempt++) {
    await delay(READY_DELAY_MS);
    if (!alive() || generation !== readGeneration) return result;
    result = snapshot();
  }
  return result;
}

async function sendObservation(result) {
  if (!result?.data || !alive()) return;
  try {
    await chrome.runtime.sendMessage({ action: 'transactionObserved', snapshot: result });
  } catch {
    teardown();
  }
}

async function readAndPublish() {
  let generation = ++readGeneration;
  let result = await waitForReady(generation);
  if (generation !== readGeneration) return;
  await sendObservation(result);
  console.log('[Apex] transaction observed', location.href, result);
}

function scheduleRead(delayMs = 100) {
  clearTimeout(navTimer);
  navTimer = setTimeout(readAndPublish, delayMs);
}

function onStorageChanged(changes, area) {
  if (area !== 'sync' || !changes.format) return;
  let next = changes.format.newValue;
  format = typeof next === 'string' && next.trim() ? next : DEFAULT_FORMAT;
  scheduleRead(0);
}

chrome.storage.onChanged.addListener(onStorageChanged);
chrome.storage.sync.get({ format: DEFAULT_FORMAT }).then((settings) => {
  format = typeof settings.format === 'string' && settings.format.trim()
    ? settings.format
    : DEFAULT_FORMAT;
  scheduleRead(0);
}).catch(() => teardown());

let observer = new MutationObserver(() => {
  if (!alive() || location.href === lastUrl) return;
  lastUrl = location.href;
  readGeneration++;
  scheduleRead(100);
});

observer.observe(document.body, { childList: true, subtree: true });

async function prepareRename(action, result, batchItemId = '') {
  if (!result?.data || !alive()) return { ok: false, error: 'Transaction data is unavailable.' };
  try {
    return await chrome.runtime.sendMessage({
      action: 'prepareRename',
      renameAction: action,
      batchItemId,
      snapshot: result
    });
  } catch {
    teardown();
    return { ok: false, error: 'Extension context is unavailable.' };
  }
}

function actionFromClick(e) {
  let menuItem = e.target.closest('[class*="Menu-menu-list-wrapper"] li[role="menuitem"]');
  let headerPrint = e.target.closest('[data-automation-id="print-button"]');
  if (headerPrint) return 'print';
  if (!menuItem) return '';
  let text = menuItem.innerText?.trim().toLowerCase();
  return text === 'download' || text === 'print' ? text : '';
}

function onClick(e) {
  if (dead) return;
  let action = actionFromClick(e);
  if (!action) return;
  if (ignoredActionClick === action) return;
  let result = snapshot();
  prepareRename(action, result);
  console.log('[Apex] preparing', action, result);
}

document.addEventListener('click', onClick, true);

async function waitForMenuItem(action) {
  for (let attempt = 0; attempt < 40; attempt++) {
    let items = document.querySelectorAll('[class*="Menu-menu-list-wrapper"] li[role="menuitem"]');
    let item = globalThis.ApexQboData.findActionItem(items, action);
    if (item) return item;
    await delay(50);
  }
  return null;
}

async function triggerAction(action, batchItemId = '') {
  if (!alive()) return { ok: false, error: 'Extension context is unavailable.' };

  let result = await waitForReady();
  if (!result.ready) {
    return { ok: false, error: `Missing filename fields: ${result.missingTokens.join(', ')}` };
  }

  let prepared = await prepareRename(action, result, batchItemId);
  if (!prepared?.ok) return prepared;

  let footerBtn = document.querySelector('[data-automation-id="RethinkLayout_footer"] button:first-of-type');
  let headerBtn = document.querySelector('[data-automation-id="print-button"]');
  let btn = footerBtn || headerBtn;
  if (!btn) return { ok: false, error: 'Print or download button was not found.' };
  btn.click();

  let item = await waitForMenuItem(action);
  if (!item) return { ok: false, error: `${action} menu item was not found.` };
  ignoredActionClick = action;
  item.click();
  ignoredActionClick = '';
  return { ok: true, data: result.data };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (dead || sender.id !== chrome.runtime.id) return;

  if (msg.action === 'getTransactionData') {
    let task = msg.waitForReady ? waitForReady() : Promise.resolve(snapshot());
    task.then(sendResponse);
    return true;
  }

  if (msg.action === 'triggerPrint' || msg.action === 'triggerDownload') {
    let action = msg.action === 'triggerDownload' ? 'download' : 'print';
    triggerAction(action, msg.batchItemId || '').then(sendResponse);
    return true;
  }

  if (msg.action === 'navigate') scheduleRead(600);
});

}());
