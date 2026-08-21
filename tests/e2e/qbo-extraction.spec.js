import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

const extractor = resolve('shared/qbo-data.js');
const content = resolve('content.js');

test('visible transaction fields win over hidden stale SPA fields', async ({ page }) => {
  await page.setContent(`
    <form hidden>
      <input data-automation-id="reference_number" value="111">
      <input data-automation-id="customer_name" value="Old Customer">
    </form>
    <form>
      <input data-automation-id="reference_number" aria-label="Estimate number" value="87072">
      <input data-automation-id="customer_name" value="Bison Pumps">
    </form>
  `);
  await page.addScriptTag({ path: extractor });

  let result = await page.evaluate(() => globalThis.ApexQboData.readTransactionSnapshot(
    document,
    { href: 'https://qbo.intuit.com/app/estimate', pathname: '/app/estimate' }
  ));
  expect(result.data).toMatchObject({ num: '87072', customer: 'Bison Pumps', type: 'Estimate' });
  expect(result.ready).toBe(true);
});

test('content script waits for a lazily rendered customer', async ({ page }) => {
  await page.setContent(`
    <form>
      <input data-automation-id="reference_number" aria-label="Estimate number" value="87072">
      <div id="customer-slot"></div>
    </form>
  `);
  await page.addInitScript(() => {
    let listeners = [];
    window.__apexListeners = listeners;
    window.chrome = {
      runtime: {
        id: 'test-extension',
        sendMessage: async () => ({ ok: true }),
        onMessage: { addListener: (listener) => listeners.push(listener) }
      },
      storage: {
        sync: { get: async (defaults) => defaults },
        onChanged: { addListener: () => {}, removeListener: () => {} }
      }
    };
  });
  await page.reload();
  await page.setContent(`
    <form>
      <input data-automation-id="reference_number" aria-label="Estimate number" value="87072">
      <div id="customer-slot"></div>
    </form>
  `);
  await page.addScriptTag({ path: extractor });
  await page.addScriptTag({ path: content });

  await page.evaluate(() => setTimeout(() => {
    let input = document.createElement('input');
    input.dataset.automationId = 'customer_name';
    input.value = 'Bison Pumps';
    document.getElementById('customer-slot').append(input);
  }, 300));

  let result = await page.evaluate(() => new Promise((resolveResult) => {
    window.__apexListeners[0](
      { action: 'getTransactionData', waitForReady: true },
      { id: 'test-extension' },
      resolveResult
    );
  }));
  expect(result.ready).toBe(true);
  expect(result.data.customer).toBe('Bison Pumps');
});

test('batch automation preserves its correlated pending action', async ({ page }) => {
  await page.addInitScript(() => {
    let listeners = [];
    let messages = [];
    window.__apexListeners = listeners;
    window.__apexMessages = messages;
    window.chrome = {
      runtime: {
        id: 'test-extension',
        sendMessage: async (message) => {
          messages.push(message);
          return { ok: true };
        },
        onMessage: { addListener: (listener) => listeners.push(listener) }
      },
      storage: {
        sync: { get: async (defaults) => defaults },
        onChanged: { addListener: () => {}, removeListener: () => {} }
      }
    };
  });
  await page.goto('about:blank');
  await page.setContent(`
    <form>
      <input data-automation-id="reference_number" aria-label="Estimate number" value="87072">
      <input data-automation-id="customer_name" value="Bison Pumps">
    </form>
    <div data-automation-id="RethinkLayout_footer"><button id="open-menu">Print or download</button></div>
    <ul class="Menu-menu-list-wrapper"><li role="menuitem">Print</li><li role="menuitem">Download</li></ul>
  `);
  await page.addScriptTag({ path: extractor });
  await page.addScriptTag({ path: content });

  let result = await page.evaluate(() => new Promise((resolveResult) => {
    window.__apexListeners[0](
      { action: 'triggerDownload', batchItemId: 'batch-1' },
      { id: 'test-extension' },
      resolveResult
    );
  }));
  let prepared = await page.evaluate(() => window.__apexMessages
    .filter((message) => message.action === 'prepareRename'));

  expect(result.ok).toBe(true);
  expect(prepared).toHaveLength(1);
  expect(prepared[0].batchItemId).toBe('batch-1');
});
