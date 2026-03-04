import { buildFilename, buildFolderPath } from './shared/tokens.js';
import { DEFAULTS, getSettings } from './shared/settings.js';

let formatInput;
let enabledToggle;
let dateFormatRow;
let dateFormatSelect;
let folderEnabled;
let folderPattern;
let previewEl;
let sourceEl;
let notifyBtns;
let batchStatus;
let copyFeedback;
let saveTimer;
let lastPreview = '';

document.addEventListener('DOMContentLoaded', async () => {
  formatInput = document.getElementById('format');
  enabledToggle = document.getElementById('enabled');
  dateFormatRow = document.getElementById('date-format-row');
  dateFormatSelect = document.getElementById('dateFormat');
  folderEnabled = document.getElementById('folderEnabled');
  folderPattern = document.getElementById('folderPattern');
  previewEl = document.getElementById('preview');
  sourceEl = document.getElementById('source-info');
  notifyBtns = document.querySelectorAll('#notifyMode .seg-btn');
  batchStatus = document.getElementById('batchStatus');
  copyFeedback = document.getElementById('copyFeedback');

  document.getElementById('version').textContent = 'v' + chrome.runtime.getManifest().version;

  let settings = await getSettings();
  formatInput.value = settings.format;
  enabledToggle.checked = settings.enabled;
  dateFormatSelect.value = settings.dateFormat;
  folderEnabled.checked = settings.folderEnabled;
  folderPattern.value = settings.folderPattern;
  setActiveNotifyBtn(settings.notifyMode);
  updateDateFormatVisibility();
  await updatePreview();
  await updateBatchStatus();

  formatInput.addEventListener('input', () => {
    debouncedSave('format', formatInput.value);
    updateDateFormatVisibility();
    updatePreview();
  });

  enabledToggle.addEventListener('change', () => {
    save('enabled', enabledToggle.checked);
  });

  dateFormatSelect.addEventListener('change', () => {
    save('dateFormat', dateFormatSelect.value);
    updatePreview();
  });

  folderEnabled.addEventListener('change', () => {
    save('folderEnabled', folderEnabled.checked);
    updatePreview();
  });

  folderPattern.addEventListener('input', () => {
    debouncedSave('folderPattern', folderPattern.value);
    updatePreview();
  });

  for (let btn of notifyBtns) {
    btn.addEventListener('click', () => {
      setActiveNotifyBtn(btn.dataset.value);
      save('notifyMode', btn.dataset.value);
    });
  }

  for (let chip of document.querySelectorAll('.chip')) {
    chip.addEventListener('click', () => {
      insertToken(chip.dataset.token);
    });
  }

  for (let btn of document.querySelectorAll('.preset')) {
    btn.addEventListener('click', () => {
      formatInput.value = btn.dataset.format;
      save('format', formatInput.value);
      updateDateFormatVisibility();
      updatePreview();
    });
  }

  document.getElementById('copyPreview').addEventListener('click', () => {
    if (!lastPreview) return;
    navigator.clipboard.writeText(lastPreview).then(() => {
      copyFeedback.textContent = 'Copied!';
      setTimeout(() => { copyFeedback.textContent = ''; }, 2000);
    }).catch(() => {
      copyFeedback.textContent = 'Copy failed.';
      setTimeout(() => { copyFeedback.textContent = ''; }, 2000);
    });
  });

  document.getElementById('openHistory').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('history.html') });
  });

  document.getElementById('batchStart').addEventListener('click', startBatchFromActiveTab);
  document.getElementById('batchCancel').addEventListener('click', cancelBatch);

  document.getElementById('reset').addEventListener('click', async () => {
    await chrome.storage.sync.set(DEFAULTS);
    formatInput.value = DEFAULTS.format;
    enabledToggle.checked = DEFAULTS.enabled;
    dateFormatSelect.value = DEFAULTS.dateFormat;
    folderEnabled.checked = DEFAULTS.folderEnabled;
    folderPattern.value = DEFAULTS.folderPattern;
    setActiveNotifyBtn(DEFAULTS.notifyMode);
    updateDateFormatVisibility();
    updatePreview();
  });

  // Push-based updates — no polling. storage.onChanged fires when batch state changes.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && 'batchQueueState' in changes) updateBatchStatus();
  });
});

function insertToken(token) {
  let pos = formatInput.selectionStart ?? formatInput.value.length;
  let val = formatInput.value;
  formatInput.value = val.slice(0, pos) + token + val.slice(pos);
  formatInput.focus();
  formatInput.selectionStart = formatInput.selectionEnd = pos + token.length;
  debouncedSave('format', formatInput.value);
  updateDateFormatVisibility();
  updatePreview();
}

function save(key, value) {
  chrome.storage.sync.set({ [key]: value });
}

function debouncedSave(key, value) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => save(key, value), 200);
}

function updateDateFormatVisibility() {
  let hasDate = formatInput.value.includes('{date}');
  dateFormatRow.classList.toggle('hidden', !hasDate);
}

function setActiveNotifyBtn(value) {
  for (let btn of notifyBtns) {
    let isActive = btn.dataset.value === value;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-checked', isActive);
  }
}

async function updatePreview() {
  let data = await getActiveTabData();
  let dateFmt = dateFormatSelect.value;
  let tokenData = data || {
    num: '87072',
    customer: 'Bison Pumps',
    type: 'Estimate',
    txnDate: '02/20/2026',
    amount: '1234.56',
    po: 'PO44',
    status: 'Open'
  };

  let base = buildFilename(formatInput.value || DEFAULTS.format, {
    ...tokenData,
    dateFormat: dateFmt
  }) + '.pdf';

  let fullPath = base;
  if (folderEnabled.checked) {
    let folder = buildFolderPath(folderPattern.value || DEFAULTS.folderPattern, {
      ...tokenData,
      dateFormat: dateFmt
    });
    if (folder) fullPath = `${folder}/${base}`;
  }

  lastPreview = fullPath;
  previewEl.textContent = fullPath;

  if (data) {
    sourceEl.textContent = (data.type ? data.type + ' ' : '') + (data.num || '') + (data.customer ? ' - ' + data.customer : '');
  } else {
    sourceEl.textContent = 'Sample preview - open a QBO transaction for live data';
  }
}

async function getActiveTabData() {
  try {
    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url?.includes('qbo.intuit.com')) return null;
    let response = await chrome.tabs.sendMessage(tab.id, { action: 'getTransactionData' });
    return response;
  } catch {
    return null;
  }
}

async function startBatchFromActiveTab() {
  batchStatus.textContent = 'Collecting selected rows...';

  try {
    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url?.includes('qbo.intuit.com')) {
      batchStatus.textContent = 'Open a QBO list page first.';
      return;
    }

    let response = await chrome.tabs.sendMessage(tab.id, { action: 'getBatchCandidates' });
    let items = response?.items || [];
    if (!items.length) {
      batchStatus.textContent = 'No selected/visible transaction links found on this page.';
      return;
    }

    let start = await chrome.runtime.sendMessage({
      action: 'batchStart',
      sourceTabId: tab.id,
      items
    });

    if (!start?.ok) {
      batchStatus.textContent = start?.error || 'Batch start failed.';
      return;
    }

    batchStatus.textContent = `Batch started with ${items.length} item(s).`;
  } catch {
    batchStatus.textContent = 'Batch start failed. Make sure this is a supported QBO list page.';
  }
}

async function cancelBatch() {
  let result = await chrome.runtime.sendMessage({ action: 'batchCancel' });
  if (result?.ok) {
    batchStatus.textContent = 'Batch cancelled.';
  } else {
    batchStatus.textContent = 'No active batch to cancel.';
  }
}

async function updateBatchStatus() {
  try {
    let { batchQueueState: state } = await chrome.storage.session.get('batchQueueState');
    if (!state?.items?.length) {
      if (!batchStatus.textContent) batchStatus.textContent = 'No active batch.';
      return;
    }

    let done = state.items.filter((x) => x.status === 'done').length;
    let fail = state.items.filter((x) => x.status === 'failed').length;
    let active = state.items.filter((x) => x.status === 'downloading').length;
    batchStatus.textContent = `Batch: ${done}/${state.items.length} done, ${fail} failed, ${active} active.`;
  } catch {
    // Popup can close while async ops are in flight; ignore.
  }
}
