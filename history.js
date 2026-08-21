const HISTORY_KEY = 'renameHistory';
const IDB_NAME = 'ApexFolderHandles';
const IDB_STORE = 'handles';

let all = [];
let historyLookup = new Map(); // relative path → history entry (rebuilt when `all` changes)
let folderFiles = []; // [{name, lastModified, handle}]
let dirHandle = null;
let folderGranted = false;

document.getElementById('search').addEventListener('input', render);
document.getElementById('sort').addEventListener('change', render);
document.getElementById('exportCsv').addEventListener('click', exportCsv);
document.getElementById('folderBtn').addEventListener('click', handleFolderBtn);

let pollTimer = null;

load().catch((err) => console.log('[Apex] history load error:', err.message));

async function load() {
  let stored = await chrome.storage.local.get(HISTORY_KEY);
  setHistory(stored[HISTORY_KEY] || []);

  dirHandle = await idbGet('folder');
  if (dirHandle) {
    let perm = await dirHandle.queryPermission({ mode: 'read' });
    if (perm === 'granted') {
      folderGranted = true;
      await readFolder();
    }
  }

  updateFolderBtn();
  render();
  startPolling();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[HISTORY_KEY]) return;
  setHistory(changes[HISTORY_KEY].newValue || []);
  render();
});

function setHistory(entries) {
  all = entries;
  historyLookup = new Map();
  for (let entry of all) {
    if (!entry.renamedTo) continue;
    historyLookup.set(`${entry.folder || ''}${entry.renamedTo}`, entry);
    if (!historyLookup.has(entry.renamedTo)) historyLookup.set(entry.renamedTo, entry);
  }
}

function updateFolderBtn() {
  let btn = document.getElementById('folderBtn');
  let path = document.getElementById('folderPath');

  if (!dirHandle) {
    btn.textContent = 'Select Folder';
    path.textContent = '';
  } else if (!folderGranted) {
    btn.textContent = 'Grant Access';
    path.textContent = dirHandle.name;
  } else {
    btn.textContent = 'Change Folder';
    path.textContent = dirHandle.name;
  }
}

async function handleFolderBtn() {
  if (!dirHandle || folderGranted) {
    try {
      dirHandle = await window.showDirectoryPicker({ mode: 'read' });
    } catch {
      return;
    }
    await idbSet('folder', dirHandle);
    folderGranted = true;
    await readFolder();
  } else {
    let perm = await dirHandle.requestPermission({ mode: 'read' });
    if (perm !== 'granted') return;
    folderGranted = true;
    await readFolder();
  }

  updateFolderBtn();
  render();
}

async function readFolder() {
  if (!dirHandle || !folderGranted) return;
  try {
    folderFiles = await walkFolder(dirHandle, '', true);
  } catch (err) {
    console.log('[Apex] folder read error:', err.message);
    folderGranted = false;
    updateFolderBtn();
    return;
  }
}

async function readFolderNames() {
  if (!dirHandle || !folderGranted) return null;
  try {
    let files = await walkFolder(dirHandle, '', false);
    return new Set(files.map((file) => file.name));
  } catch {
    return null;
  }
}

async function walkFolder(handle, prefix, includeMetadata) {
  let files = [];
  for await (let entry of handle.values()) {
    let name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.kind === 'directory') {
      files.push(...await walkFolder(entry, name, includeMetadata));
      continue;
    }

    let lastModified = 0;
    if (includeMetadata) lastModified = (await entry.getFile()).lastModified;
    files.push({ name, lastModified, handle: entry });
  }
  return files;
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    if (!folderGranted || !dirHandle) return;
    if (document.hidden) return;

    let curNames = await readFolderNames();
    if (!curNames) return;

    let prevNames = new Set(folderFiles.map((f) => f.name));
    if (curNames.size !== prevNames.size || [...curNames].some((n) => !prevNames.has(n))) {
      await readFolder();
      render();
    }
  }, 3000);
}

// Pause/resume polling when tab visibility changes
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && folderGranted && dirHandle) {
    readFolder().then(render);
  }
});

function filtered() {
  let search = document.getElementById('search').value.trim().toLowerCase();

  let rows = folderFiles.map((f) => {
    let hist = historyLookup.get(f.name);
    return {
      name: f.name,
      lastModified: f.lastModified,
      handle: f.handle,
      customer: hist?.customer || '',
      txnType: hist?.txnType || '',
      txnNum: hist?.txnNum || '',
    };
  });

  if (search) {
    rows = rows.filter((x) => {
      let hay = [x.name, x.customer, x.txnType, x.txnNum].join(' ').toLowerCase();
      return hay.includes(search);
    });
  }

  let sort = document.getElementById('sort').value;
  if (sort === 'newest') rows.sort((a, b) => b.lastModified - a.lastModified);
  if (sort === 'oldest') rows.sort((a, b) => a.lastModified - b.lastModified);
  if (sort === 'name') rows.sort((a, b) => a.name.localeCompare(b.name));
  if (sort === 'customer') rows.sort((a, b) => (a.customer || '').localeCompare(b.customer || ''));

  return rows;
}

function appendCell(tr, text) {
  let td = document.createElement('td');
  td.textContent = text;
  tr.appendChild(td);
  return td;
}

function makeRowButtons(row) {
  let td = document.createElement('td');
  td.className = 'actions';

  let openBtn = document.createElement('button');
  openBtn.className = 'row-btn';
  openBtn.textContent = 'Open';
  openBtn.addEventListener('click', async () => {
    try {
      let file = await row.handle.getFile();
      let url = URL.createObjectURL(file);
      window.open(url, '_blank');
      // Revoke after short delay — browser needs a moment to start loading
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      console.log('[Apex] open file error:', err.message);
    }
  });

  td.append(openBtn);
  return td;
}

function render() {
  let rows = filtered();
  let tbody = document.getElementById('rows');
  tbody.textContent = '';

  for (let row of rows) {
    let tr = document.createElement('tr');
    appendCell(tr, new Date(row.lastModified).toLocaleString());
    appendCell(tr, row.name);
    appendCell(tr, row.customer);
    appendCell(tr, row.txnType);
    appendCell(tr, row.txnNum);
    tr.appendChild(makeRowButtons(row));
    tbody.appendChild(tr);
  }

  let emptyEl = document.getElementById('empty');
  if (!folderGranted) {
    emptyEl.textContent = 'Select a folder to view files.';
    emptyEl.style.display = 'block';
  } else {
    emptyEl.textContent = folderFiles.length ? 'No files match this search.' : 'Folder is empty.';
    emptyEl.style.display = rows.length ? 'none' : 'block';
  }
}

async function exportCsv() {
  let rows = filtered();
  if (!rows.length) return;

  let lines = ['filename,modified,customer,txn_type,txn_num'];
  for (let x of rows) {
    lines.push([
      csv(x.name),
      new Date(x.lastModified).toISOString(),
      csv(x.customer),
      csv(x.txnType),
      csv(x.txnNum)
    ].join(','));
  }

  let blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  let url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({
      url,
      filename: `apex-files-${Date.now()}.csv`,
      saveAs: true
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}

function csv(value = '') {
  let text = String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

// --- IndexedDB helpers (cached connection) ---

let dbReady = null;

function idbOpen() {
  if (!dbReady) {
    dbReady = new Promise((resolve, reject) => {
      let req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { dbReady = null; reject(req.error); };
    });
  }
  return dbReady;
}

async function idbGet(key) {
  let db = await idbOpen();
  return new Promise((resolve, reject) => {
    let tx = db.transaction(IDB_STORE, 'readonly');
    let req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  let db = await idbOpen();
  return new Promise((resolve, reject) => {
    let tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
