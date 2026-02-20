'use strict';

const DEFAULTS = {
  enabled: true,
  format: '{num} - {customer}',
  dateFormat: 'YYYY-MM-DD',
  notifyMode: 'toast'
};

let formatInput, enabledToggle, dateFormatRow, dateFormatSelect;
let previewEl, sourceEl, notifyBtns;
let saveTimer;

document.addEventListener('DOMContentLoaded', async () => {
  formatInput = document.getElementById('format');
  enabledToggle = document.getElementById('enabled');
  dateFormatRow = document.getElementById('date-format-row');
  dateFormatSelect = document.getElementById('dateFormat');
  previewEl = document.getElementById('preview');
  sourceEl = document.getElementById('source-info');
  notifyBtns = document.querySelectorAll('#notifyMode .seg-btn');

  // Version from manifest
  document.getElementById('version').textContent = 'v' + chrome.runtime.getManifest().version;

  // Load saved settings (with migration from old showNotification boolean)
  let settings = await chrome.storage.sync.get(DEFAULTS);

  // Migrate old boolean showNotification → notifyMode
  if (typeof settings.showNotification === 'boolean') {
    settings.notifyMode = settings.showNotification ? 'toast' : 'off';
    chrome.storage.sync.remove('showNotification');
    chrome.storage.sync.set({ notifyMode: settings.notifyMode });
  }

  formatInput.value = settings.format;
  enabledToggle.checked = settings.enabled;
  dateFormatSelect.value = settings.dateFormat;
  setActiveNotifyBtn(settings.notifyMode);
  updateDateFormatVisibility();

  // -- Event listeners --

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

  // Notification mode segmented control
  for (let btn of notifyBtns) {
    btn.addEventListener('click', () => {
      setActiveNotifyBtn(btn.dataset.value);
      save('notifyMode', btn.dataset.value);
    });
  }

  // Token chip insertion
  for (let chip of document.querySelectorAll('.chip')) {
    chip.addEventListener('click', () => {
      let token = chip.dataset.token;
      let pos = formatInput.selectionStart ?? formatInput.value.length;
      let val = formatInput.value;
      formatInput.value = val.slice(0, pos) + token + val.slice(pos);
      formatInput.focus();
      formatInput.selectionStart = formatInput.selectionEnd = pos + token.length;
      debouncedSave('format', formatInput.value);
      updateDateFormatVisibility();
      updatePreview();
    });
  }

  // Preset buttons
  for (let btn of document.querySelectorAll('.preset')) {
    btn.addEventListener('click', () => {
      formatInput.value = btn.dataset.format;
      save('format', formatInput.value);
      updateDateFormatVisibility();
      updatePreview();
    });
  }

  // Reset to defaults
  document.getElementById('reset').addEventListener('click', async () => {
    await chrome.storage.sync.set(DEFAULTS);
    formatInput.value = DEFAULTS.format;
    enabledToggle.checked = DEFAULTS.enabled;
    dateFormatSelect.value = DEFAULTS.dateFormat;
    setActiveNotifyBtn(DEFAULTS.notifyMode);
    updateDateFormatVisibility();
    updatePreview();
  });

  updatePreview();
});

// -- Save to storage --

function save(key, value) {
  chrome.storage.sync.set({ [key]: value });
}

function debouncedSave(key, value) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => save(key, value), 200);
}

// -- Date format conditional visibility --

function updateDateFormatVisibility() {
  let hasDate = formatInput.value.includes('{date}');
  dateFormatRow.classList.toggle('hidden', !hasDate);
}

// -- Notification mode --

function setActiveNotifyBtn(value) {
  for (let btn of notifyBtns) {
    let isActive = btn.dataset.value === value;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-checked', isActive);
  }
}

// -- Live preview --

async function updatePreview() {
  let data = await getActiveTabData();
  let format = formatInput.value || DEFAULTS.format;
  let dateFmt = dateFormatSelect.value;

  if (data) {
    let filename = buildPreview(format, data, dateFmt);
    previewEl.textContent = filename + '.pdf';
    sourceEl.textContent = (data.type ? data.type + ' ' : '') + (data.num || '') + (data.customer ? ' \u2014 ' + data.customer : '');
  } else {
    previewEl.textContent = buildPreview(format, { num: '87072', customer: 'Bison Pumps', type: 'Estimate' }, dateFmt) + '.pdf';
    sourceEl.textContent = 'Sample preview \u2014 open a QBO transaction for live data';
  }
}

function buildPreview(format, data, dateFmt) {
  let date = '';
  if (format.includes('{date}')) {
    let d = new Date();
    date = dateFmt
      .replace('YYYY', d.getFullYear())
      .replace('MM', String(d.getMonth() + 1).padStart(2, '0'))
      .replace('DD', String(d.getDate()).padStart(2, '0'));
  }

  let name = format
    .replaceAll('{num}', data.num || '')
    .replaceAll('{customer}', data.customer || '')
    .replaceAll('{type}', data.type || '')
    .replaceAll('{date}', date);

  // Mirror the same sanitization as background.js buildFilename
  name = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '');
  name = name.replace(/\s{2,}/g, ' ').replace(/-{3,}/g, '--');
  name = name.replace(/^[\s.]+|[\s.]+$/g, '');

  return name || 'QBO_Document';
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
