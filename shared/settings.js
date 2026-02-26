export const DEFAULTS = {
  enabled: true,
  format: '{num} - {customer}',
  dateFormat: 'YYYY-MM-DD',
  notifyMode: 'toast'
};

export async function getSettings() {
  let settings = await chrome.storage.sync.get(DEFAULTS);

  if (typeof settings.showNotification === 'boolean') {
    settings.notifyMode = settings.showNotification ? 'toast' : 'off';
    chrome.storage.sync.remove('showNotification');
    chrome.storage.sync.set({ notifyMode: settings.notifyMode });
  }

  return settings;
}