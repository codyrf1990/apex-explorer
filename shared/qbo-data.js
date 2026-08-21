(function (root) {
'use strict';

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

const TOKEN_NAMES = ['num', 'customer', 'type', 'txndate', 'amount', 'po', 'status'];

function isVisible(el) {
  if (!el || !el.isConnected || hiddenByAttribute(el) || hiddenByStyle(el)) return false;
  return !el.getClientRects || el.getClientRects().length > 0;
}

function hiddenByAttribute(el) {
  return el.hidden
    || el.getAttribute('aria-hidden') === 'true'
    || Boolean(el.closest('[hidden],[aria-hidden="true"]'));
}

function hiddenByStyle(el) {
  let style = el.ownerDocument?.defaultView?.getComputedStyle?.(el);
  return style?.display === 'none' || style?.visibility === 'hidden';
}

function findVisible(doc, selectors, rootEl = doc) {
  for (let sel of selectors) {
    for (let el of rootEl.querySelectorAll(sel)) {
      if (isVisible(el)) return el;
    }
  }
  return null;
}

function readValue(el) {
  return el?.value?.trim() || el?.textContent?.trim() || '';
}

function pathType(loc) {
  let slug = loc.pathname.match(/\/app\/([^/?]+)/)?.[1] || '';
  return TXN_LABELS[slug] || slug;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseHeader(text, expectedType = '') {
  let clean = text?.trim() || '';
  if (!clean) return null;

  if (expectedType) {
    let match = clean.match(new RegExp(`^${escapeRegExp(expectedType)}\\s+([^\\s]+)$`, 'i'));
    if (match) return { type: expectedType, num: match[1] };
  }

  let match = clean.match(/^(.+?)\s+([A-Za-z0-9][A-Za-z0-9._/-]*)$/);
  return match ? { type: match[1], num: match[2] } : null;
}

function requiredTokens(format) {
  let pattern = typeof format === 'string' && format.trim() ? format : '{num} - {customer}';
  return TOKEN_NAMES.filter((token) => pattern.includes(`{${token}}`));
}

function findActionItem(items, action) {
  return [...items].find((item) => item.innerText?.trim().toLowerCase() === action) || null;
}

function readIdentity(doc, loc) {
  let type = pathType(loc);
  let ref = findVisible(doc, ['[data-automation-id="reference_number"]']);
  let scope = ref?.closest('form,[role="dialog"],main,[data-automation-id*="RethinkLayout"]') || doc;
  let num = readValue(ref);
  type = typeFromReference(ref) || type;

  if (!num) {
    let header = findVisible(doc, [
      '[data-automation-id="RethinkLayout_header"]',
      '[class*="txp-capability-formTitle"]',
      '[class*="TrowserHeader-headerTitleText"]'
    ]);
    let parsed = parseHeader(header?.innerText || header?.textContent, type);
    if (parsed) {
      type = parsed.type;
      num = parsed.num;
    }
  }

  return { num, type, scope };
}

function typeFromReference(ref) {
  return (ref?.getAttribute('aria-label') || '').replace(/\s*number\s*/i, '').trim();
}

function readField(doc, scope, selectors, textOnly = false) {
  let el = findVisible(doc, selectors, scope);
  if (!el && scope !== doc) el = findVisible(doc, selectors);
  return textOnly ? el?.textContent?.trim() || '' : readValue(el);
}

function readFields(doc, scope) {
  let customer = readField(doc, scope, [
    '[data-automation-id="customer_name"]',
    'input[aria-label="Customer"]',
    '[data-automation-id="vendor_name"]',
    'input[aria-label="Vendor"]'
  ]);
  let txnDate = readField(doc, scope, [
    '[data-automation-id="date_field"]',
    '[data-automation-id="txn_date"]',
    'input[aria-label="Date"]',
    'input[aria-label="Bill date"]'
  ]);
  let rawAmount = readField(doc, scope, [
    '[data-automation-id="total"]',
    '[data-automation-id="balance_due"]',
    '[data-automation-id="amount_due"]'
  ], true);
  let amount = rawAmount.replace(/[^0-9.,-]/g, '').replace(/,/g, '').trim();
  let po = readField(doc, scope, [
    '[data-automation-id="po_number"]',
    'input[aria-label="P.O. number"]'
  ]);
  let status = readField(doc, scope, [
    '[data-automation-id="status"]',
    '[class*="Badge"]',
    '[class*="Status"]'
  ], true);
  return { customer, txnDate, amount, po, status };
}

function readTransactionSnapshot(doc = document, loc = location, format = '{num} - {customer}') {
  let { num, type, scope } = readIdentity(doc, loc);
  let fields = readFields(doc, scope);
  let { customer } = fields;
  let data = num || customer ? { num, type, ...fields } : null;
  let missingTokens = requiredTokens(format).filter((token) => !data?.[token]);
  let customerRequired = requiredTokens(format).includes('customer');
  let ready = Boolean(data?.num && (!customerRequired || data.customer));

  return {
    data,
    missingTokens,
    ready,
    sourceUrl: loc.href,
    observedAt: Date.now()
  };
}

root.ApexQboData = {
  TXN_LABELS,
  findVisible,
  findActionItem,
  isVisible,
  parseHeader,
  readTransactionSnapshot,
  requiredTokens
};

}(globalThis));
