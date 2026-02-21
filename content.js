'use strict';

// -- Transaction type labels for filename tokens --
const TXN_LABELS = {
  estimate: 'Estimate',
  invoice: 'Invoice',
  salesreceipt: 'Sales Receipt',
  purchaseorder: 'Purchase Order',
  creditmemo: 'Credit Memo',
  bill: 'Bill',
  refundreceipt: 'Refund Receipt'
};

// -- DOM data extraction --

function readTransactionData() {
  let num = '';
  let customer = '';
  let type = '';

  // Primary: data-automation-id is Intuit's QA hook, most stable selector
  let refInput = document.querySelector('[data-automation-id="reference_number"]');
  if (refInput) {
    num = refInput.value?.trim() || '';
    // The aria-label on this input tells us the type: "Estimate number", "Invoice number", etc.
    let label = refInput.getAttribute('aria-label') || '';
    type = label.replace(/\s*number\s*/i, '').trim();
  }

  // Fallback chain for transaction number
  if (!num) {
    let header = document.querySelector('[data-automation-id="RethinkLayout_header"]');
    if (!header) header = document.querySelector('[class*="txp-capability-formTitle"]');
    if (!header) header = document.querySelector('[class*="TrowserHeader-headerTitleText"]');

    if (header) {
      let text = header.innerText?.trim() || '';
      let match = text.match(/^(.+?)\s+(\d{3,})$/);
      if (match) {
        if (!type) type = match[1];
        num = match[2];
      }
    }
  }

  // URL-based type fallback
  if (!type) {
    let pathMatch = window.location.pathname.match(/\/app\/([^/?]+)/);
    let slug = pathMatch?.[1] || '';
    type = TXN_LABELS[slug] || slug;
  }

  // Customer / Vendor name — Bills and POs use "Vendor" instead of "Customer"
  let nameInput = document.querySelector('[data-automation-id="customer_name"]')
    || document.querySelector('input[aria-label="Customer"]')
    || document.querySelector('[data-automation-id="vendor_name"]')
    || document.querySelector('input[aria-label="Vendor"]');
  customer = nameInput?.value?.trim() || '';

  if (!num && !customer) return null;

  return { num, customer, type };
}

// -- SPA navigation detection --

let lastUrl = location.href;
let navTimer;

function onNavigate() {
  // Small delay lets React finish re-rendering
  setTimeout(() => {
    let data = readTransactionData();
    if (data) {
      chrome.storage.session.set({ currentTransaction: data });
    }
    console.log('[Apex] navigated to', location.href, data);
  }, 600);
}

let observer = new MutationObserver(() => {
  if (location.href === lastUrl) return;
  lastUrl = location.href;
  clearTimeout(navTimer);
  navTimer = setTimeout(onNavigate, 100);
});

observer.observe(document.body, { childList: true, subtree: true });

// -- Click interception (capture phase — fires before React) --

document.addEventListener('click', function(e) {
  let menuItem = e.target.closest('[class*="Menu-menu-list-wrapper"] li[role="menuitem"]');
  let headerPrint = e.target.closest('[data-automation-id="print-button"]');

  if (!menuItem && !headerPrint) return;

  let action;
  if (headerPrint) {
    action = 'print';
  } else {
    let text = menuItem.innerText?.trim().toLowerCase();
    if (text === 'download') action = 'download';
    else if (text === 'print') action = 'print';
    else return;
  }

  let data = readTransactionData();
  if (!data) return;

  chrome.storage.session.set({
    pendingRename: {
      action,
      num: data.num,
      customer: data.customer,
      type: data.type,
      timestamp: Date.now()
    }
  });
  console.log('[Apex] pending', action, data);
}, true);

// -- Hotkey simulation (triggered by background.js commands) --

function clickButton(selector) {
  return new Promise((resolve) => {
    let el = document.querySelector(selector);
    if (el) { el.click(); resolve(true); return; }

    let attempts = 0;
    let poll = setInterval(() => {
      el = document.querySelector(selector);
      if (el) { clearInterval(poll); el.click(); resolve(true); }
      if (++attempts > 40) { clearInterval(poll); resolve(false); }
    }, 50);
  });
}

async function triggerAction(action) {
  let data = readTransactionData();
  if (data) {
    await chrome.storage.session.set({
      pendingRename: {
        action,
        num: data.num,
        customer: data.customer,
        type: data.type,
        timestamp: Date.now()
      }
    });
  }

  // Click the "Print or download" footer button to open the menu
  let footerBtn = document.querySelector('[data-automation-id="RethinkLayout_footer"] button:first-of-type');
  let headerBtn = document.querySelector('[data-automation-id="print-button"]');
  let btn = footerBtn || headerBtn;
  if (btn) btn.click();

  // Wait for menu to appear, then click the right item
  let found = await clickButton('[class*="Menu-menu-list-wrapper"] li[role="menuitem"]');
  if (!found) return;

  // Brief delay for menu to fully render
  await new Promise(r => setTimeout(r, 100));

  // Match menu items by text content, not positional index (QBO may reorder)
  let items = document.querySelectorAll('[class*="Menu-menu-list-wrapper"] li[role="menuitem"]');
  let target = action === 'download' ? 'download' : 'print';
  for (let item of items) {
    if (item.innerText?.trim().toLowerCase() === target) {
      item.click();
      break;
    }
  }
}

// -- Message listener --

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'getTransactionData') {
    sendResponse(readTransactionData());
    return;
  }

  if (msg.action === 'triggerPrint') {
    triggerAction('print');
    return;
  }

  if (msg.action === 'triggerDownload') {
    triggerAction('download');
    return;
  }

  if (msg.action === 'navigate') {
    onNavigate();
    return;
  }
});

// -- Init --
// QBO renders fields progressively — retry until customer/vendor appears or we give up

function initRead(attempt = 0) {
  let data = readTransactionData();
  if (data) {
    chrome.storage.session.set({ currentTransaction: data });
    // Retry if customer is missing — QBO renders it late
    if (!data.customer && attempt < 5) {
      setTimeout(() => initRead(attempt + 1), 600);
      return;
    }
  }
  console.log('[Apex] content script loaded on', location.href, data);
}

initRead();
