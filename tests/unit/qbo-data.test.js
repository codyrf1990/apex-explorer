import { beforeAll, describe, expect, it } from 'vitest';

beforeAll(async () => {
  await import('../../shared/qbo-data.js');
});

function fakeDocument(values) {
  let doc = {
    defaultView: { getComputedStyle: () => ({ display: 'block', visibility: 'visible' }) },
    querySelectorAll: (selector) => values[selector] || []
  };

  for (let elements of Object.values(values)) {
    for (let el of elements) el.ownerDocument = doc;
  }
  return doc;
}

function fakeElement(options = {}) {
  let attrs = options.attrs || {};
  return {
    value: options.value || '',
    textContent: options.text || '',
    innerText: options.text || '',
    hidden: false,
    isConnected: true,
    getAttribute: (name) => attrs[name] || '',
    getClientRects: () => options.visible === false ? [] : [{}],
    closest: (selector) => options.hiddenParent && selector.includes('[hidden]') ? {} : null
  };
}

function read(values, path = '/app/estimate', format = '{num} - {customer}') {
  let loc = { href: `https://qbo.intuit.com${path}`, pathname: path };
  return globalThis.ApexQboData.readTransactionSnapshot(fakeDocument(values), loc, format);
}

describe('QBO transaction extraction', () => {
  it('ignores hidden stale fields and reads the visible transaction', () => {
    let result = read({
      '[data-automation-id="reference_number"]': [
        fakeElement({ value: '111', visible: false }),
        fakeElement({ value: '87072', attrs: { 'aria-label': 'Estimate number' } })
      ],
      '[data-automation-id="customer_name"]': [
        fakeElement({ value: 'Old Customer', visible: false }),
        fakeElement({ value: 'Bison Pumps' })
      ]
    });

    expect(result.ready).toBe(true);
    expect(result.data).toMatchObject({ num: '87072', customer: 'Bison Pumps', type: 'Estimate' });
  });

  it('supports vendor fields and reports missing required tokens', () => {
    let result = read({
      '[data-automation-id="reference_number"]': [
        fakeElement({ value: 'PO-A7', attrs: { 'aria-label': 'Purchase Order number' } })
      ],
      'input[aria-label="Vendor"]': [fakeElement({ value: 'Supply House' })]
    }, '/app/purchaseorder', '{num} - {customer} - {po}');

    expect(result.data.customer).toBe('Supply House');
    expect(result.missingTokens).toEqual(['po']);
    expect(result.ready).toBe(true);
  });

  it('parses short and alphanumeric numbers from headers', () => {
    expect(globalThis.ApexQboData.parseHeader('Estimate A-7', 'Estimate'))
      .toEqual({ type: 'Estimate', num: 'A-7' });
    expect(globalThis.ApexQboData.parseHeader('Invoice 1', 'Invoice'))
      .toEqual({ type: 'Invoice', num: '1' });
  });

  it('selects the requested menu action instead of the first item', () => {
    let print = { innerText: 'Print' };
    let download = { innerText: 'Download' };
    expect(globalThis.ApexQboData.findActionItem([print, download], 'download')).toBe(download);
  });
});
