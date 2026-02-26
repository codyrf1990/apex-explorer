import { buildFilename } from './shared/tokens.js';
import { DEFAULTS, getSettings } from './shared/settings.js';

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

  let settings = await getSettings();

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
    let filename = buildFilename(format, {
      num: data.num,
      customer: data.customer,
      type: data.type,
      dateFormat: dateFmt
    });
    previewEl.textContent = filename + '.pdf';
    sourceEl.textContent = (data.type ? data.type + ' ' : '') + (data.num || '') + (data.customer ? ' \u2014 ' + data.customer : '');
  } else {
    previewEl.textContent = buildFilename(format, {
      num: '87072',
      customer: 'Bison Pumps',
      type: 'Estimate',
      dateFormat: dateFmt
    }) + '.pdf';
    sourceEl.textContent = 'Sample preview \u2014 open a QBO transaction for live data';
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
