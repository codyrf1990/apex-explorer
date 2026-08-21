import { describe, expect, it } from 'vitest';
import {
  consumeRenameContext,
  emptyContexts,
  pruneContexts,
  resolveRenameContext
} from '../../shared/rename-state.js';

function pending(sourceTabId, sourceUrl, num, createdAt = 1000) {
  return {
    sourceTabId,
    sourceUrl,
    data: { type: 'Estimate', num, customer: `Customer ${num}` },
    createdAt
  };
}

describe('rename context correlation', () => {
  it('uses an exact blob URL before any other context', () => {
    let contexts = emptyContexts();
    contexts.blobs[90] = {
      blobUrl: 'blob:https://qbo.intuit.com/exact',
      data: { num: '90', customer: 'Exact' },
      createdAt: 1000
    };
    contexts.pending.other = pending(1, 'https://qbo.intuit.com/app/estimate/1', '1');

    let match = resolveRenameContext({ url: 'blob:https://qbo.intuit.com/exact' }, contexts, null, 1100);
    expect(match).toMatchObject({ source: 'blob', key: '90' });
  });

  it('uses one unambiguous pending print when blob registration raced the download', () => {
    let contexts = emptyContexts();
    contexts.pending.print = { ...pending(1, 'https://qbo.intuit.com/app/estimate/1', '1'), action: 'print' };
    let match = resolveRenameContext({
      url: 'blob:https://qbo.intuit.com/7afca6b4-544d-4728-a9f0-ce05ebb28cfe'
    }, contexts, null, 1100);
    expect(match).toMatchObject({ source: 'pending', key: 'print' });
  });

  it('matches concurrent tabs by referrer and transaction identity', () => {
    let contexts = emptyContexts();
    contexts.pending.one = pending(1, 'https://qbo.intuit.com/app/estimate/1', '1');
    contexts.pending.two = pending(2, 'https://qbo.intuit.com/app/estimate/2', '2');

    let match = resolveRenameContext({
      filename: 'Estimate 2.pdf',
      referrer: 'https://qbo.intuit.com/app/estimate/2'
    }, contexts, { type: 'Estimate', num: '2' }, 1100);
    expect(match).toMatchObject({ source: 'pending', key: 'two' });
    expect(match.context.data.customer).toBe('Customer 2');
  });

  it('ignores URL fragments when matching a download referrer', () => {
    let contexts = emptyContexts();
    contexts.pending.one = pending(1, 'https://qbo.intuit.com/app/estimate?id=7#activity', '7');
    let match = resolveRenameContext({
      referrer: 'https://qbo.intuit.com/app/estimate?id=7'
    }, contexts, null, 1100);
    expect(match).toMatchObject({ source: 'pending', key: 'one' });
  });

  it('refuses ambiguous state and falls back to parsed filename data', () => {
    let contexts = emptyContexts();
    contexts.pending.one = pending(1, 'https://qbo.intuit.com/app/estimate/1', '7');
    contexts.pending.two = pending(2, 'https://qbo.intuit.com/app/estimate/2', '7');

    let match = resolveRenameContext({}, contexts, { type: 'Estimate', num: '7', customer: '' }, 1100);
    expect(match.source).toBe('filename');
  });

  it('expires stale records and consumes matched state once', () => {
    let contexts = emptyContexts();
    contexts.pending.old = pending(1, 'https://qbo.intuit.com/app/estimate/1', '1', 1);
    contexts.pending.current = pending(2, 'https://qbo.intuit.com/app/estimate/2', '2', 40000);
    pruneContexts(contexts, 40001);
    expect(contexts.pending.old).toBeUndefined();

    consumeRenameContext(contexts, { source: 'pending', key: 'current' });
    expect(contexts.pending.current).toBeUndefined();
  });

  it('resolves persisted state after a service-worker-style round trip', () => {
    let contexts = emptyContexts();
    contexts.pending.saved = pending(4, 'https://qbo.intuit.com/app/estimate?id=44', '44');
    let restored = JSON.parse(JSON.stringify(contexts));
    let match = resolveRenameContext({
      referrer: 'https://qbo.intuit.com/app/estimate?id=44'
    }, restored, null, 1100);
    expect(match).toMatchObject({ source: 'pending', key: 'saved' });
  });
});
