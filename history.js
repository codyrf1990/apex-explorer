const HISTORY_KEY = 'renameHistory';

let all = [];

document.getElementById('search').addEventListener('input', render);
document.getElementById('sort').addEventListener('change', render);
document.getElementById('exportCsv').addEventListener('click', exportCsv);
document.getElementById('clearAll').addEventListener('click', clearAll);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[HISTORY_KEY]) return;
  all = changes[HISTORY_KEY].newValue || [];
  render();
});

load();

async function load() {
  let stored = await chrome.storage.local.get(HISTORY_KEY);
  all = stored[HISTORY_KEY] || [];
  render();
}

function filtered() {
  let search = document.getElementById('search').value.trim().toLowerCase();
  let rows = all.filter((x) => {
    if (!search) return true;
    let hay = [x.renamedTo, x.originalName, x.customer, x.txnType, x.txnNum].join(' ').toLowerCase();
    return hay.includes(search);
  });

  let sort = document.getElementById('sort').value;
  if (sort === 'newest') rows.sort((a, b) => b.timestamp - a.timestamp);
  if (sort === 'oldest') rows.sort((a, b) => a.timestamp - b.timestamp);
  if (sort === 'name') rows.sort((a, b) => (a.renamedTo || '').localeCompare(b.renamedTo || ''));
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
  openBtn.addEventListener('click', () => {
    if (typeof row.downloadId === 'number') chrome.downloads.open(row.downloadId);
  });

  let delBtn = document.createElement('button');
  delBtn.className = 'row-btn';
  delBtn.textContent = 'Delete';
  delBtn.addEventListener('click', () => deleteOne(row.id));

  td.append(openBtn, delBtn);
  return td;
}

function render() {
  let rows = filtered();
  let tbody = document.getElementById('rows');
  tbody.textContent = '';

  for (let row of rows) {
    let tr = document.createElement('tr');
    appendCell(tr, new Date(row.timestamp).toLocaleString());
    appendCell(tr, (row.folder || '') + (row.renamedTo || ''));
    appendCell(tr, row.originalName || '');
    appendCell(tr, row.customer || '');
    appendCell(tr, row.txnType || '');
    appendCell(tr, row.txnNum || '');
    tr.appendChild(makeRowButtons(row));
    tbody.appendChild(tr);
  }

  document.getElementById('empty').style.display = rows.length ? 'none' : 'block';
}

async function deleteOne(id) {
  all = all.filter((x) => x.id !== id);
  await chrome.storage.local.set({ [HISTORY_KEY]: all });
  render();
}

async function clearAll() {
  all = [];
  await chrome.storage.local.set({ [HISTORY_KEY]: all });
  render();
}

async function exportCsv() {
  if (!all.length) return;

  let lines = ['timestamp,renamed_to,original_name,folder,download_id,txn_type,txn_num,customer'];
  for (let x of all) {
    lines.push([
      new Date(x.timestamp).toISOString(),
      csv(x.renamedTo),
      csv(x.originalName),
      csv(x.folder),
      csv(String(x.downloadId ?? '')),
      csv(x.txnType),
      csv(x.txnNum),
      csv(x.customer)
    ].join(','));
  }

  let blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  let url = URL.createObjectURL(blob);
  await chrome.downloads.download({
    url,
    filename: `apex-history-${Date.now()}.csv`,
    saveAs: true
  });
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function csv(value = '') {
  let text = String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}
