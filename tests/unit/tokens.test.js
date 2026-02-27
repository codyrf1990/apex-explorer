import { describe, expect, it } from 'vitest';
import { buildFilename, buildFolderPath, formatDate, parseQboFilename } from '../../shared/tokens.js';

describe('shared tokens', () => {
  it('formats dates from an explicit Date value', () => {
    let d = new Date('2026-02-20T12:00:00.000Z');
    expect(formatDate('YYYY-MM-DD', d)).toBe('2026-02-20');
    expect(formatDate('MM/DD/YYYY', d)).toBe('02/20/2026');
  });

  it('builds and sanitizes filenames', () => {
    let name = buildFilename('{type} {num} - {customer}', {
      type: 'Estimate',
      num: '87072',
      customer: 'Bison / Pumps:West'
    });
    expect(name).toBe('Estimate 87072 - Bison PumpsWest');
  });

  it('falls back to a timestamped name when empty', () => {
    let name = buildFilename('{customer}', { customer: '' });
    expect(name.startsWith('QBO_Document_')).toBe(true);
  });

  it('supports phase-1 tokens', () => {
    let name = buildFilename('{txndate}-{amount}-{po}-{status}', {
      txnDate: '02/20/2026',
      amount: '1234.56',
      po: 'PO-44',
      status: 'Open'
    });
    expect(name).toBe('02202026-1234.56-PO-44-Open');
  });

  it('builds safe folder paths', () => {
    let path = buildFolderPath('{customer}/{type}/../{status}', {
      customer: 'Bison/Pumps',
      type: 'Invoice',
      status: 'Open'
    });
    expect(path).toBe('Bison/Pumps/Invoice/Open');
  });

  it('parses qbo default names', () => {
    expect(parseQboFilename('Estimate 87072.pdf')).toEqual({
      type: 'Estimate',
      num: '87072',
      customer: ''
    });
    expect(parseQboFilename('something else.pdf')).toBeNull();
  });
});
