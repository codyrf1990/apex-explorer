export const DEFAULTS = {
  enabled: true,
  format: '{num} - {customer}',
  dateFormat: 'YYYY-MM-DD',
  notifyMode: 'toast',
  folderEnabled: false,
  folderPattern: '{type}'
};

export async function getSettings() {
  let settings = await chrome.storage.sync.get(DEFAULTS);
  let repairs = {};

  if (typeof settings.format !== 'string' || !settings.format.trim()) {
    settings.format = DEFAULTS.format;
    repairs.format = DEFAULTS.format;
  }
  if (typeof settings.folderPattern !== 'string' || !settings.folderPattern.trim()) {
    settings.folderPattern = DEFAULTS.folderPattern;
    repairs.folderPattern = DEFAULTS.folderPattern;
  }

  if (typeof settings.showNotification === 'boolean') {
    settings.notifyMode = settings.showNotification ? 'toast' : 'off';
    chrome.storage.sync.remove('showNotification');
    repairs.notifyMode = settings.notifyMode;
  }

  if (Object.keys(repairs).length) await chrome.storage.sync.set(repairs);

  return settings;
}
