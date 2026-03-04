(function () {
'use strict';

// Prevent duplicate listener registration if somehow injected twice.
if (document.__apexListLoaded) return;
document.__apexListLoaded = true;

const TXN_SLUGS = [
  'estimate',
  'invoice',
  'salesreceipt',
  'purchaseorder',
  'creditmemo',
  'bill',
  'refundreceipt',
  'check',
  'vendorcredit',
  'journalentry',
  'deposit',
  'expense',
  'transfer',
  'payment'
];

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

function findRow(el) {
  return el.closest('tr,[role="row"],li,[data-automation-id*="row"]');
}

function matchTxnUrl(url) {
  if (!url) return '';
  for (let slug of TXN_SLUGS) {
    if (url.includes(`/app/${slug}`)) return slug;
  }
  return '';
}

function parseRow(row) {
  let links = row.querySelectorAll('a[href]');
  for (let a of links) {
    let href = a.getAttribute('href') || '';
    let url = new URL(href, location.origin).href;
    let slug = matchTxnUrl(url);
    if (!slug) continue;

    let text = row.innerText || '';
    let numMatch = text.match(/\b(\d{3,})\b/);
    return {
      url,
      type: TXN_LABELS[slug] || slug,
      num: numMatch?.[1] || ''
    };
  }
  return null;
}

function collectRowsFromChecks() {
  let checks = document.querySelectorAll('input[type="checkbox"]:checked,[role="checkbox"][aria-checked="true"]');
  let rows = new Set();
  for (let check of checks) {
    let row = findRow(check);
    if (row) rows.add(row);
  }
  return [...rows];
}

function collectVisibleRows() {
  return [...document.querySelectorAll('tr,[role="row"],li[data-automation-id*="row"]')];
}

function collectBatchCandidates() {
  let rows = collectRowsFromChecks();
  if (!rows.length) rows = collectVisibleRows();

  let out = [];
  let seen = new Set();
  for (let row of rows) {
    let item = parseRow(row);
    if (!item || seen.has(item.url)) continue;
    seen.add(item.url);
    out.push(item);
  }
  return out;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;
  if (msg.action === 'getBatchCandidates') {
    sendResponse({ items: collectBatchCandidates() });
  }
});

}());
