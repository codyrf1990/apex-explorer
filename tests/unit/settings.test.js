import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULTS, getSettings } from '../../shared/settings.js';

afterEach(() => {
  delete globalThis.chrome;
});

describe('settings normalization', () => {
  it('repairs blank filename and folder patterns', async () => {
    let set = vi.fn(async () => {});
    globalThis.chrome = {
      storage: {
        sync: {
          get: vi.fn(async () => ({ ...DEFAULTS, format: ' ', folderPattern: '' })),
          set,
          remove: vi.fn()
        }
      }
    };

    let settings = await getSettings();
    expect(settings.format).toBe(DEFAULTS.format);
    expect(settings.folderPattern).toBe(DEFAULTS.folderPattern);
    expect(set).toHaveBeenCalledWith({
      format: DEFAULTS.format,
      folderPattern: DEFAULTS.folderPattern
    });
  });
});
