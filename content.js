(function () {
'use strict';

// Prevent double-injection when extension reloads into a live tab.
// teardown() clears this so re-injection works after context death.
if (document.__apexLoaded) return;
document.__apexLoaded = true;

const TXN_LABELS = {
  estimate: 'Estimate',
  invoice: 'Invoice',
  salesreceipt: 'Sales Receipt',
  purchaseorder: 'Purchase Order',
  creditmemo: 'Credit Memo',
  bill: 'Bill',
  refundreceipt: 'Refund Receipt',
  check: 'Check',
  vendorcredit: 'Vendor Credit',
  journalentry: 'Journal Entry',
  deposit: 'Deposit',
  expense: 'Expense',
  transfer: 'Transfer',
  payment: 'Payment'
};

function pickInput(selectors) {
  for (let sel of selectors) {
    let el = document.querySelector(sel);
    if (!el) continue;
    let val = el.value?.trim() || el.textContent?.trim() || '';
    if (val) return val;
  }
  return '';
}

function pickText(selectors) {
  for (let sel of selectors) {
    let el = document.querySelector(sel);
    let val = el?.textContent?.trim() || '';
    if (val) return val;
  }
  return '';
}

function readTransactionData() {
  let num = '';
  let customer = '';
  let type = '';

  let refInput = document.querySelector('[data-automation-id="reference_number"]');
  if (refInput) {
    num = refInput.value?.trim() || '';
    let label = refInput.getAttribute('aria-label') || '';
    type = label.replace(/\s*number\s*/i, '').trim();
  }

  if (!num) {
    let header = document.querySelector('[data-automation-id="RethinkLayout_header"]')
      || document.querySelector('[class*="txp-capability-formTitle"]')
      || document.querySelector('[class*="TrowserHeader-headerTitleText"]');

    if (header) {
      let text = header.innerText?.trim() || '';
      let match = text.match(/^(.+?)\s+(\d{3,})$/);
      if (match) {
        if (!type) type = match[1];
        num = match[2];
      }
    }
  }

  if (!type) {
    let pathMatch = window.location.pathname.match(/\/app\/([^/?]+)/);
    let slug = pathMatch?.[1] || '';
    type = TXN_LABELS[slug] || slug;
  }

  customer = pickInput([
    '[data-automation-id="customer_name"]',
    'input[aria-label="Customer"]',
    '[data-automation-id="vendor_name"]',
    'input[aria-label="Vendor"]'
  ]);

  let txnDate = pickInput([
    '[data-automation-id="date_field"]',
    '[data-automation-id="txn_date"]',
    'input[aria-label="Date"]',
    'input[aria-label="Bill date"]'
  ]);

  let rawAmount = pickText([
    '[data-automation-id="total"]',
    '[data-automation-id="balance_due"]',
    '[data-automation-id="amount_due"]'
  ]);
  let amount = rawAmount.replace(/[^0-9.,-]/g, '').replace(/,/g, '').trim();

  let po = pickInput([
    '[data-automation-id="po_number"]',
    'input[aria-label="P.O. number"]'
  ]);

  let status = pickText([
    '[data-automation-id="status"]',
    '[class*="Badge"]',
    '[class*="Status"]'
  ]);

  if (!num && !customer) return null;

  return { num, customer, type, txnDate, amount, po, status };
}

let lastUrl = location.href;
let navTimer;
let dead = false;

function teardown() {
  if (dead) return;
  dead = true;
  document.__apexLoaded = false; // allow re-injection after context death
  observer.disconnect();
  document.removeEventListener('click', onClick, true);
  clearTimeout(navTimer);
  console.log('[Apex] context invalidated — torn down');
}

function alive() {
  if (dead) return false;
  try {
    if (!chrome.runtime?.id) { teardown(); return false; }
    return true;
  } catch {
    teardown();
    return false;
  }
}

function onNavigate() {
  navTimer = setTimeout(() => {
    if (!alive()) return;
    let data = readTransactionData();
    if (data) {
      try {
        chrome.storage.session.set({ currentTransaction: data });
      } catch { teardown(); return; }
    }
    console.log('[Apex] navigated to', location.href, data);
  }, 600);
}

let observer = new MutationObserver(() => {
  if (!alive()) return;
  if (location.href === lastUrl) return;
  lastUrl = location.href;
  clearTimeout(navTimer);
  navTimer = setTimeout(onNavigate, 100);
});

observer.observe(document.body, { childList: true, subtree: true });

function writePendingRename(action, data, batchItemId) {
  if (!data || !alive()) return;
  try {
    chrome.storage.session.set({
      pendingRename: {
        action,
        batchItemId: batchItemId || '',
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
  } catch { teardown(); }
}

function onClick(e) {
  if (dead) return;
  let menuItem = e.target.closest('[class*="Menu-menu-list-wrapper"] li[role="menuitem"]');
  let headerPrint = e.target.closest('[data-automation-id="print-button"]');
  if (!menuItem && !headerPrint) return;

  let action = '';
  if (headerPrint) {
    action = 'print';
  } else {
    let text = menuItem.innerText?.trim().toLowerCase();
    if (text === 'download') action = 'download';
    if (text === 'print') action = 'print';
  }
  if (!action) return;

  let data = readTransactionData();
  writePendingRename(action, data);
  console.log('[Apex] pending', action, data);
}

document.addEventListener('click', onClick, true);

function clickButton(selector) {
  return new Promise((resolve) => {
    let el = document.querySelector(selector);
    if (el) {
      el.click();
      resolve(true);
      return;
    }

    let attempts = 0;
    let poll = setInterval(() => {
      el = document.querySelector(selector);
      if (el) {
        clearInterval(poll);
        el.click();
        resolve(true);
      }
      if (++attempts > 40) {
        clearInterval(poll);
        resolve(false);
      }
    }, 50);
  });
}

async function triggerAction(action, batchItemId = '') {
  if (!alive()) return;
  let data = readTransactionData();
  writePendingRename(action, data, batchItemId);

  let footerBtn = document.querySelector('[data-automation-id="RethinkLayout_footer"] button:first-of-type');
  let headerBtn = document.querySelector('[data-automation-id="print-button"]');
  let btn = footerBtn || headerBtn;
  if (btn) btn.click();

  let found = await clickButton('[class*="Menu-menu-list-wrapper"] li[role="menuitem"]');
  if (!found) return;
  await new Promise((r) => setTimeout(r, 100));

  let items = document.querySelectorAll('[class*="Menu-menu-list-wrapper"] li[role="menuitem"]');
  let target = action === 'download' ? 'download' : 'print';
  for (let item of items) {
    if (item.innerText?.trim().toLowerCase() === target) {
      item.click();
      break;
    }
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (dead) return;
  if (msg.action === 'getTransactionData') {
    sendResponse(readTransactionData());
    return;
  }

  if (msg.action === 'triggerPrint') {
    triggerAction('print', msg.batchItemId || '');
    return;
  }

  if (msg.action === 'triggerDownload') {
    triggerAction('download', msg.batchItemId || '');
    return;
  }

  if (msg.action === 'navigate') {
    onNavigate();
  }
});

function initRead(attempt = 0) {
  if (!alive()) return;
  let data = readTransactionData();
  if (data) {
    try {
      chrome.storage.session.set({ currentTransaction: data });
    } catch { teardown(); return; }
    if (!data.customer && attempt < 10) {
      setTimeout(() => initRead(attempt + 1), 500);
      return;
    }
  } else if (attempt < 10) {
    // QBO renders lazily — retry until form fields appear
    setTimeout(() => initRead(attempt + 1), 500);
    return;
  }
  console.log('[Apex] content script loaded on', location.href, data);
}

initRead();

}());
