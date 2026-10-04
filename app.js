let data = [];
let currentCollection = '';
let recordsCache = [];
let collectionLoadToken = 0;
let collectionsLoadToken = 0;
const PORTS_TO_TRY = [3000];
const API_BASE_CANDIDATES = PORTS_TO_TRY.map(p => `http://localhost:${p}`);
let API_BASE = API_BASE_CANDIDATES[0];
const LOCATION_DATABASES = {
  calamba: 'sample',
  bicol: 'sample2',
  quezon: 'sample3'
};
let selectedLocation = 'calamba';

function initializeSelectedLocationFromQuery() {
  try {
    const params = new URLSearchParams(window.location.search || '');
    const dbFromQuery = params.get('db');
    if (dbFromQuery) {
      const match = Object.entries(LOCATION_DATABASES).find(([, dbName]) => dbName === dbFromQuery);
      if (match) {
        selectedLocation = match[0];
        localStorage.setItem('inventorySelectedLocation', selectedLocation);
        return;
      }
    }

    const fallback = localStorage.getItem('inventorySelectedLocation');
    if (fallback && LOCATION_DATABASES[fallback]) {
      selectedLocation = fallback;
    }
  } catch (err) {
    console.warn('Could not resolve selected location from query:', err);
  }
}

function getSelectedDatabaseName() {
  return LOCATION_DATABASES[selectedLocation] || 'sample';
}

function updateActiveDatabaseBadge() {
  if (!activeDbBadge) return;
  const dbName = getSelectedDatabaseName();
  activeDbBadge.textContent = `DB: ${dbName}`;
}

function buildApiUrl(path, params = {}) {
  const normalizedPath = String(path || '/').replace(/^\/+/, '');
  const url = new URL(normalizedPath ? `/${normalizedPath}` : '/', `${API_BASE}/`);
  url.searchParams.set('db', getSelectedDatabaseName());
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    url.searchParams.set(key, String(value));
  });
  return url.toString();
}

async function resolveApiBase() {
  // If the UI was loaded from a specific port (e.g., via the packaged app), prefer that first
  const pageHost = (window && window.location && window.location.hostname) ? window.location.hostname : 'localhost';
  const pagePort = (window && window.location && window.location.port) ? Number(window.location.port) : null;

  const candidates = [];
  if (pagePort) {
    candidates.push(`${window.location.protocol}//${pageHost}:${pagePort}`);
  }
  for (const base of API_BASE_CANDIDATES) candidates.push(base);

  for (const base of candidates) {
    try {
      const res = await fetch(`${base}/api/collections?db=${encodeURIComponent(getSelectedDatabaseName())}`, { cache: 'no-store' });
      if (res.ok) {
        API_BASE = base;
        console.log('Using API base:', API_BASE, 'database:', getSelectedDatabaseName());
        return base;
      }
    } catch (err) {
      console.warn('API not available at', base, err);
    }
  }

  API_BASE = API_BASE_CANDIDATES[0];
  return API_BASE;
}

const collectionSelect = document.getElementById('collectionSelect');
const collectionSearch = document.getElementById('collectionSearch');
const tbody = document.querySelector('#inventory-table tbody');
const searchInput = document.getElementById('search');
const uploadBtn = document.getElementById('uploadBtn');
const uploadFileInput = document.getElementById('uploadFileInput');
const processOrderBtn = document.getElementById('processOrderBtn');
const lowStockBtn = document.getElementById('lowStockBtn');
const recordsBtn = document.getElementById('recordsBtn');
const profileBtn = document.getElementById('profileBtn');
const locationSwitchOptions = document.querySelectorAll('.location-switch-option');
const activeDbBadge = document.getElementById('activeDbBadge');
const addCollectionBtn = document.getElementById('addCollectionBtn');
const addRowBtn = document.getElementById('addRowBtn');
const addRowTopBtn = document.getElementById('addRowTopBtn');
const clientNameInput = document.getElementById('clientName');
const clientDateInput = document.getElementById('clientDate');
const invoiceNumberInput = document.getElementById('invoiceNumber');
const recordsCollectionFilter = document.getElementById('recordsCollectionFilter');
const recordsDateFilter = document.getElementById('recordsDateFilter');
const collectionPromptModal = document.getElementById('collectionPromptModal');
const collectionPromptInput = document.getElementById('collectionPromptInput');
const collectionPromptOk = document.getElementById('collectionPromptOk');
const collectionPromptCancel = document.getElementById('collectionPromptCancel');
const statusPromptModal = document.getElementById('statusPromptModal');
const statusPromptMessage = document.getElementById('statusPromptMessage');
const statusPromptOk = document.getElementById('statusPromptOk');
const recordsModeToggle = document.querySelector('.records-mode-toggle');
const recordsModeIn = document.getElementById('recordsModeIn');
const recordsModeOut = document.getElementById('recordsModeOut');
let recordsMode = 'order';

// Process order modal elements
const processModal = document.getElementById('processModal');
const processForm = document.getElementById('processForm');
const orderCustomer = document.getElementById('orderCustomer');
const orderNumber = document.getElementById('orderNumber');
const orderNotes = document.getElementById('orderNotes');
const cancelProcess = document.getElementById('cancelProcess');
const convertSampleToPdfBtn = document.getElementById('convertSampleToPdf');
const sampleTemplateTable = document.getElementById('sampleTemplateTable');
const addProcessRowBtn = document.getElementById('addProcessRowBtn');
const processCollectionSelect = document.getElementById('processCollectionSelect');
const processCollectionOptions = document.getElementById('processCollectionOptions');
const modelSuggestions = document.getElementById('modelSuggestions');
const processOrderModeToggle = document.querySelector('.process-order-mode-toggle');
const processOrderModeIn = document.getElementById('processOrderModeIn');
const processOrderModeOut = document.getElementById('processOrderModeOut');
const clientFieldLabel = document.getElementById('clientFieldLabel');
const processOrderTableHead = document.getElementById('processOrderTableHead');
let processOrderMode = 'in';

function getModelOptionValue(item) {
  if (!item) return '';
  const model = String(item.model || '').trim();
  const brand = String(item.brand || item.made || '').trim();
  const partNo = String(item.partNumber || item.partNo || item.size || '').trim();
  return `${model}::${brand}::${partNo}`;
}

function findInventoryItemFromSelection(selectionValue) {
  const value = String(selectionValue || '').trim();
  if (!value) return null;

  const directMatch = (data || []).find(item => getModelOptionValue(item) === value);
  if (directMatch) return directMatch;

  const candidateValue = value.toLowerCase();
  const parts = value.split('::');
  if (parts.length >= 3) {
    const [model, brand, partNoOrSize] = parts;
    const exactMatches = (data || []).filter(item => {
      const itemModel = String(item.model || '').trim().toLowerCase();
      const itemBrand = String(item.brand || item.made || '').trim().toLowerCase();
      const itemPart = String(item.partNumber || item.partNo || item.size || '').trim().toLowerCase();
      return itemModel === String(model || '').trim().toLowerCase()
        && itemBrand === String(brand || '').trim().toLowerCase()
        && itemPart === String(partNoOrSize || '').trim().toLowerCase();
    });
    if (exactMatches.length === 1) return exactMatches[0];

    const modelBrandMatches = (data || []).filter(item => {
      const itemModel = String(item.model || '').trim().toLowerCase();
      const itemBrand = String(item.brand || item.made || '').trim().toLowerCase();
      return itemModel === String(model || '').trim().toLowerCase()
        && itemBrand === String(brand || '').trim().toLowerCase();
    });
    if (modelBrandMatches.length === 1) return modelBrandMatches[0];

    return null;
  }

  const exactModelMatches = (data || []).filter(item => String(item.model || '').trim().toLowerCase() === candidateValue);
  if (exactModelMatches.length === 1) return exactModelMatches[0];

  const exactPartMatches = (data || []).filter(item => {
    const itemPart = String(item.partNumber || item.partNo || item.size || '').trim().toLowerCase();
    return itemPart === candidateValue;
  });
  if (exactPartMatches.length === 1) return exactPartMatches[0];

  return null;
}

function getProcessOrderRowTemplate() {
  if (processOrderMode === 'out') {
    return `
      <tr>
        <td><input class="sample-model-input" type="text" list="modelSuggestions" placeholder="Model" aria-label="Model blank input" /></td>
        <td><input type="text" aria-label="Part number blank input" /></td>
        <td><input type="text" aria-label="Description blank input" /></td>
        <td><input type="text" aria-label="Price blank input" /></td>
        <td><input type="text" aria-label="Restock blank input" class="total-input" /></td>
      </tr>
    `;
  }

  return `
    <tr>
      <td><input class="sample-model-input" type="text" list="modelSuggestions" placeholder="Model" aria-label="Model blank input" /></td>
      <td><input type="text" aria-label="Brand blank input" /></td>
      <td><input type="text" aria-label="Part number blank input" /></td>
      <td><input type="text" aria-label="Description blank input" /></td>
      <td><input type="text" aria-label="Price blank input" /></td>
      <td><input type="text" aria-label="Stock blank input" class="total-input" /></td>
    </tr>
  `;
}

function updateProcessOrderTableHeaders() {
  if (!processOrderTableHead) return;

  if (processOrderMode === 'out') {
    processOrderTableHead.innerHTML = `
      <th>Model</th>
      <th>Part No</th>
      <th>Description</th>
      <th>Price</th>
      <th>Restock</th>
    `;
  } else {
    processOrderTableHead.innerHTML = `
      <th>Model</th>
      <th>Brand / Made</th>
      <th>Part Number</th>
      <th>Description</th>
      <th>Price</th>
      <th>Stock</th>
    `;
  }
}

function setProcessOrderMode(mode) {
  processOrderMode = mode === 'out' ? 'out' : 'in';

  if (processOrderModeIn) processOrderModeIn.classList.toggle('active', processOrderMode === 'in');
  if (processOrderModeOut) processOrderModeOut.classList.toggle('active', processOrderMode === 'out');
  if (processOrderModeToggle) processOrderModeToggle.setAttribute('aria-checked', String(processOrderMode === 'out'));
  if (clientFieldLabel) clientFieldLabel.textContent = processOrderMode === 'in' ? 'Client:' : 'Supplier:';
  if (clientNameInput) {
    clientNameInput.placeholder = processOrderMode === 'in' ? 'input client name' : 'input supplier name';
  }
  if (convertSampleToPdfBtn) {
    convertSampleToPdfBtn.textContent = 'Save Order';
    convertSampleToPdfBtn.style.display = 'inline-block';
  }

  updateProcessOrderTableHeaders();
  if (sampleTemplateTable) {
    const tbody = sampleTemplateTable.querySelector('tbody');
    if (tbody) {
      tbody.innerHTML = '';
      for (let i = 0; i < 3; i += 1) {
        tbody.insertAdjacentHTML('beforeend', getProcessOrderRowTemplate());
      }
    }
  }

  populateSampleModelDropdown();
  bindSampleModelAutofill();
}

function populateSampleModelDropdown() {
  const inputs = document.querySelectorAll('.sample-model-input');
  if (!inputs.length) return;

  const uniqueMap = new Map();
  (data || []).forEach(item => {
    const model = String(item.model || '').trim();
    if (!model) return;
    const key = getModelOptionValue(item);
    if (!key) return;
    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, item);
    }
  });

  const html = Array.from(uniqueMap.values()).map(item => {
    const model = String(item.model || '').trim();
    const brand = String(item.brand || item.made || '').trim();
    const partNo = String(item.partNumber || item.partNo || item.size || '').trim();
    const label = [model, brand, partNo].filter(Boolean).join(' • ');
    const optionValue = getModelOptionValue(item);
    return `<option value="${escapeHtml(optionValue)}" label="${escapeHtml(label)}">${escapeHtml(label)}</option>`;
  }).join('');

  if (modelSuggestions) {
    modelSuggestions.innerHTML = html;
  }

  inputs.forEach(input => {
    if (!input.hasAttribute('list')) {
      input.setAttribute('list', 'modelSuggestions');
    }
  });
}

function extractFirstNumericValue(value) {
  const str = String(value || '').trim();
  if (!str) return '';

  const parts = str
    .split(/[\s/]+/)
    .map(part => part.replace(/[^0-9.\-]/g, ''))
    .filter(part => part !== '' && part !== '-');

  return parts[0] || '';
}

function safeCellValue(value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  return String(value);
}

function getStockStatus(value) {
  const numericValue = parseStockAmount(value);

  if (numericValue <= 0) {
    return { tone: 'out' };
  }

  if (numericValue <= 5) {
    return { tone: 'low' };
  }

  return { tone: 'in' };
}

function applyStockStatus(td, value) {
  if (!td || !td.dataset || td.dataset.field !== 'stock') {
    return;
  }

  const status = getStockStatus(value);
  td.dataset.stockTone = status.tone;
  td.classList.remove('stock-in', 'stock-low', 'stock-out');
  td.classList.add(`stock-${status.tone}`);
}

function parseStockAmount(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return 0;

  const cleaned = raw.replace(/[^0-9.\-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.') return 0;

  const numeric = Number(cleaned);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
}

function clampOrderQuantity(orderValue, availableStock) {
  const requested = parseStockAmount(orderValue);
  const available = parseStockAmount(availableStock);
  return Math.min(Math.max(requested, 0), Math.max(available, 0));
}

function getAvailableStockForModel(modelName) {
  if (!modelName) return 0;

  const matchingItem = findInventoryItemFromSelection(modelName);
  if (!matchingItem) return 0;

  return parseStockAmount(matchingItem.stock || matchingItem.msl || 0);
}

function validateProcessOrderRows(rows) {
  const issues = [];
  const stockIndex = processOrderMode === 'out' ? 4 : 5;

  rows.forEach((row, index) => {
    if (!Array.isArray(row) || row.length < 6) return;

    const selectionValue = String(row[0] || '').trim();
    const matchingItem = findInventoryItemFromSelection(selectionValue);
    const modelName = matchingItem ? String(matchingItem.model || '').trim() : selectionValue;
    const stockValue = parseStockAmount(row[stockIndex]);

    if (!modelName || !matchingItem) return;

    const availableStock = getAvailableStockForModel(selectionValue);

    if (stockValue <= 0) {
      issues.push(`Row ${index + 1}: stock must be greater than 0 for ${modelName}.`);
      return;
    }

    if (availableStock <= 0) {
      issues.push(`Row ${index + 1}: ${modelName} is sold out and cannot be ordered.`);
      return;
    }

    if (stockValue > availableStock) {
      issues.push(`Row ${index + 1}: stock for ${modelName} cannot exceed ${availableStock} on hand.`);
    }
  });

  if (issues.length) {
    alert(issues.join('\n'));
    return false;
  }

  return true;
}

async function applyOrderStockReduction(orderRows) {
  if (!currentCollection || !Array.isArray(orderRows) || !orderRows.length) {
    return orderRows;
  }

  const totalsByItem = new Map();
  const stockIndex = processOrderMode === 'out' ? 4 : 5;

  for (const row of orderRows) {
    if (!Array.isArray(row) || row.length < 6) continue;

    const selectionValue = String(row[0] || '').trim();
    const matchingItem = findInventoryItemFromSelection(selectionValue);
    if (!matchingItem || !matchingItem._id) continue;

    const available = parseStockAmount(matchingItem.stock || matchingItem.msl || 0);
    const requested = clampOrderQuantity(row[stockIndex], available);
    const currentTotal = totalsByItem.get(String(matchingItem._id)) || 0;
    const remainingAvailable = Math.max(available - currentTotal, 0);
    const allowed = Math.min(requested, remainingAvailable);

    totalsByItem.set(String(matchingItem._id), currentTotal + allowed);
    row[stockIndex] = String(allowed);
  }

  for (const [itemId, totalOrdered] of totalsByItem.entries()) {
    const matchingItem = data.find(item => String(item._id) === itemId);
    if (!matchingItem) continue;

    const currentStock = parseStockAmount(matchingItem.stock || matchingItem.msl || 0);
    const updatedStock = Math.max(currentStock - totalOrdered, 0);

    try {
      const response = await fetch(buildApiUrl(`api/collections/${encodeURIComponent(currentCollection)}/${encodeURIComponent(itemId)}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stock: updatedStock, __EMPTY_7: updatedStock })
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || 'Stock update failed');
      }
    } catch (err) {
      console.error('Failed to update stock after processing order:', err);
    }
  }

  if (totalsByItem.size) {
    await loadCollection(currentCollection);
  }

  return orderRows;
}

function applySampleModelAutoFill(selectedModel, row) {
  if (!selectedModel || !row) return;

  const selectedValue = String(selectedModel).trim();
  const item = findInventoryItemFromSelection(selectedValue);
  if (!item) return;

  const cells = row.querySelectorAll('td');
  if (cells.length >= 6) {
    const modelInput = cells[0].querySelector('.sample-model-input');
    const partInput = processOrderMode === 'out' ? cells[1].querySelector('input') : cells[2].querySelector('input');
    const descriptionInput = processOrderMode === 'out' ? cells[2].querySelector('input') : cells[3].querySelector('input');
    const priceInput = processOrderMode === 'out' ? cells[3].querySelector('input') : cells[4].querySelector('input');
    const stockInput = processOrderMode === 'out' ? cells[4].querySelector('input') : cells[5].querySelector('input');
    const extraInput = processOrderMode === 'out' ? cells[4].querySelector('input') : null;
    const brandInput = processOrderMode === 'in' ? cells[1].querySelector('input') : null;

    if (modelInput) {
      modelInput.dataset.inventoryKey = getModelOptionValue(item);
      modelInput.value = String(item.model || '').trim();
    }
    if (brandInput) brandInput.value = item.brand || item.made || '';
    if (partInput) partInput.value = item.partNumber || item.partNo || item.size || '';
    if (descriptionInput) descriptionInput.value = item.description || '';
    if (priceInput) {
      const priceValue = item.price !== undefined && item.price !== null ? String(item.price) : '';
      priceInput.value = priceValue;
    }
    if (stockInput) {
      stockInput.value = '';
    }
    if (extraInput) {
      extraInput.value = '';
    }
  }

  const totalInput = row.querySelector('.total-input');
  if (totalInput) {
    totalInput.value = '';
  }
}

function bindSampleModelAutofill() {
  const inputs = document.querySelectorAll('.sample-model-input');
  inputs.forEach(input => {
    input.onchange = () => {
      const row = input.closest('tr');
      applySampleModelAutoFill(input.value, row);
    };
    input.oninput = () => {
      const row = input.closest('tr');
      if (!row) return;
      const inputsInRow = row.querySelectorAll('input');
      const brandInput = processOrderMode === 'in' ? inputsInRow[1] : null;
      const partInput = inputsInRow[processOrderMode === 'out' ? 1 : 2];
      const totalInput = row.querySelector('.total-input');
      const descriptionInput = inputsInRow[processOrderMode === 'out' ? 2 : 3];
      const priceInput = inputsInRow[processOrderMode === 'out' ? 3 : 4];
      const stockInput = inputsInRow[processOrderMode === 'out' ? 4 : 5];

      if (!input.value.trim()) {
        if (brandInput) brandInput.value = '';
        if (partInput) partInput.value = '';
        if (descriptionInput) descriptionInput.value = '';
        if (priceInput) priceInput.value = '';
        if (totalInput) totalInput.value = '';
      }
    };
  });
}

function populateProcessCollectionDropdown() {
  if (!processCollectionSelect || !processCollectionOptions) return;

  const collections = Array.isArray(window.availableCollections) ? window.availableCollections : [];

  processCollectionOptions.innerHTML = collections
    .map(name => `<option value="${escapeHtml(name)}"></option>`)
    .join('');

  if (!processCollectionSelect.value && currentCollection) {
    processCollectionSelect.value = '';
  }
}

function resetProcessOrderTable() {
  if (!sampleTemplateTable) return;

  const tbody = sampleTemplateTable.querySelector('tbody');
  if (!tbody) return;

  tbody.innerHTML = '';
  for (let i = 0; i < 3; i += 1) {
    tbody.insertAdjacentHTML('beforeend', getProcessOrderRowTemplate());
  }

  updateProcessOrderTableHeaders();
  populateSampleModelDropdown();
  bindSampleModelAutofill();
}

async function refreshProcessOrderCollectionData() {
  if (!processCollectionSelect || !processCollectionSelect.value) return;

  const selectedCollection = processCollectionSelect.value;
  currentCollection = selectedCollection;
  setActiveCollectionItem(selectedCollection);
  await loadCollection(selectedCollection);
  resetProcessOrderTable();
  populateSampleModelDropdown();
  bindSampleModelAutofill();
}

function formatCollectionName(name) {
  if (!name) return name;
  return name
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, ch => ch.toUpperCase());
}

function setActiveCollectionItem(name) {
  const items = collectionSelect.querySelectorAll('li[data-name]');
  items.forEach(item => {
    const isActive = item.dataset.name === name;
    item.classList.toggle('active', isActive);
    item.setAttribute('aria-selected', String(isActive));
  });
}

function safeSheetName(name) {
  return String(name || 'Sheet')
    .replace(/[\\/\*\?\[\]:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 31) || 'Sheet';
}

function isHeaderRow(doc) {
  if (!doc || typeof doc !== 'object') return false;

  const headerWords = new Set([
    'model', 'brand', 'made', 'part', 'partno', 'partnumber', 'part no', 'part number',
    'description', 'size', 'price', 'stock', 'stock on hand', 'quantity', 'location',
    'item', 'item name', 'product', 'product name'
  ]);

  const values = Object.values(doc)
    .map(v => String(v ?? '').trim().toLowerCase())
    .filter(Boolean);

  if (!values.length) return false;

  let labelMatches = 0;
  for (const value of values) {
    const normalized = value.replace(/[^a-z0-9]+/g, ' ').trim();
    if (!normalized) continue;

    // Only treat exact header labels as headers. Real data like "Universal" or "No Brand" must not match.
    if (headerWords.has(normalized)) {
      labelMatches++;
    }
  }

  // Real rows often contain size strings like "1/2", "3/8", or product names like "Universal".
  // The row is only a header if it contains multiple actual column-label values.
  return labelMatches >= 3;
}

function normalizeDoc(doc) {
  if (!doc || typeof doc !== 'object') return {};

  const map = {};
  for (const [key, value] of Object.entries(doc)) {
    const cleaned = String(key || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    map[cleaned] = value;
  }

  const fieldMap = {
    model: '__EMPTY',
    brand: '__EMPTY_1',
    partNumber: '__EMPTY_2',
    description: '__EMPTY_3',
    location: '__EMPTY_4',
    msl: '__EMPTY_5',
    stock: '__EMPTY_6'
  };

  const pick = (...candidates) => {
    for (const candidate of candidates) {
      if (map[candidate] !== undefined && map[candidate] !== null && map[candidate] !== '') {
        return map[candidate];
      }
    }
    return '';
  };

  return {
    _id: doc._id,
    rawFieldMap: fieldMap,
    model: pick('empty', 'model', 'productname', 'product', 'name', 'itemname'),
    brand: pick('empty1', 'brand', 'brandmade'),
    made: pick('empty2', 'made', 'manufacturer'),
    partNumber: pick('empty3', 'partno', 'partnumber', 'partno', 'part'),
    description: pick('empty4', 'description', 'desc'),
    size: pick('empty5', 'size', 'dimension', 'dimensions'),
    price: pick('empty6', 'price', 'unitprice', 'cost'),
    stock: pick('empty7', 'stockonhand', 'stockinhand', 'stock', 'quantity', 'onhand', 'availablestock')
  };
}

function applyFilters() {
  const q = (searchInput && searchInput.value) ? searchInput.value.trim().toLowerCase() : '';
  const rows = data.filter(d => {
    if (!q) return true;
    const values = [d.model, d.brand, d.made, d.partNumber, d.description, d.size, d.price, d.stock];
    return values.some(v => String(v || '').toLowerCase().includes(q));
  });

  tbody.innerHTML = '';
  rows.forEach((r, idx) => {
    const tr = document.createElement('tr');
    if (r._id) tr.dataset.id = r._id;

    // Row number cell to match the first header column
    const numTd = document.createElement('td');
    numTd.className = 'row-number-col';
    numTd.textContent = String(idx + 1);
    numTd.setAttribute('aria-hidden', 'true');
    tr.appendChild(numTd);

    const makeCell = (field, raw) => {
      const td = document.createElement('td');
      td.setAttribute('data-field', field);
      if (raw) td.dataset.rawField = raw;
      td.contentEditable = 'true';
      td.tabIndex = 0;
      td.setAttribute('aria-readonly', 'false');
      td.textContent = safeCellValue(r[field]);
      if (field === 'stock') {
        applyStockStatus(td, r[field]);
      }
      return td;
    };

    tr.appendChild(makeCell('model', '__EMPTY'));
    tr.appendChild(makeCell('brand', '__EMPTY_1'));
    tr.appendChild(makeCell('made', '__EMPTY_2'));
    tr.appendChild(makeCell('partNumber', '__EMPTY_3'));
    tr.appendChild(makeCell('description', '__EMPTY_4'));
    tr.appendChild(makeCell('size', '__EMPTY_5'));
    tr.appendChild(makeCell('price', '__EMPTY_6'));
    tr.appendChild(makeCell('stock', '__EMPTY_7'));

    // no trailing cell — columns now match header (add button on left)

    tbody.appendChild(tr);
  });
}

if (searchInput) {
  searchInput.addEventListener('input', () => applyFilters());
}

async function ensureCollectionExists(name, options = {}) {
  const safeName = String(name || '').trim();
  if (!safeName) return '';

  const { allowReuse = false } = options;

  const normalizeCollectionName = (value) => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\s-]+/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  const uniqueCollectionName = (base, existing) => {
    const normalizedBase = normalizeCollectionName(base);
    if (!normalizedBase) return '';
    const set = new Set((existing || []).map(item => normalizeCollectionName(item)));
    if (!set.has(normalizedBase)) {
      return normalizedBase;
    }

    let suffix = 2;
    let candidate = `${normalizedBase}_${suffix}`;
    while (set.has(candidate)) {
      suffix += 1;
      candidate = `${normalizedBase}_${suffix}`;
    }
    return candidate;
  };

  const normalizedName = normalizeCollectionName(safeName);
  if (!normalizedName) return '';

  try {
    const listRes = await fetch(buildApiUrl('api/collections'), { cache: 'no-store' });
    const existingCollections = listRes.ok ? await listRes.json().catch(() => []) : [];
    const normalizedExisting = Array.isArray(existingCollections) ? existingCollections.map(item => normalizeCollectionName(item)) : [];

    if (allowReuse && normalizedExisting.includes(normalizedName)) {
      return normalizedName;
    }

    const targetCollection = uniqueCollectionName(normalizedName, normalizedExisting);

    if (normalizedExisting.includes(targetCollection)) {
      return targetCollection;
    }

    const createRes = await fetch(buildApiUrl('api/collections'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: targetCollection })
    });

    if (createRes.status === 409) {
      const retry = uniqueCollectionName(`${normalizedName}_${Date.now()}`, normalizedExisting);
      const retryRes = await fetch(buildApiUrl('api/collections'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: retry })
      });

      if (!retryRes.ok) {
        const result = await retryRes.json().catch(() => ({}));
        throw new Error(result.error || 'Could not create collection');
      }
      return retry;
    }

    if (!createRes.ok) {
      const result = await createRes.json().catch(() => ({}));
      throw new Error(result.error || 'Could not create collection');
    }

    return targetCollection;
  } catch (err) {
    if (String(err.message || '').includes('already exists')) {
      return normalizedName;
    }
    throw err;
  }
}

if (uploadBtn && uploadFileInput) {
  const triggerUpload = (buttonEl) => {
    if (buttonEl) {
      buttonEl.disabled = true;
      buttonEl.textContent = 'Uploading...';
    }
    uploadFileInput.value = '';
    uploadFileInput.click();
  };

  uploadBtn.addEventListener('click', () => {
    if (!canUseStaffFeatures()) {
      alert('Only verified users can upload files.');
      return;
    }
    if (!currentCollection) {
      alert('Please select a collection first.');
      return;
    }
    triggerUpload(uploadBtn);
  });

  uploadFileInput.addEventListener('change', async () => {
    const file = uploadFileInput.files && uploadFileInput.files[0];
    if (!file) {
      uploadBtn.disabled = false;
      uploadBtn.textContent = 'Upload File';
      return;
    }

    const collectionName = String(file.name || 'uploaded_excel')
      .replace(/\.[^/.]+$/, '')
      .trim()
      .replace(/[^a-zA-Z0-9_\-\s]+/g, '')
      .replace(/\s+/g, '_') || 'uploaded_excel';

    const formData = new FormData();
    formData.append('file', file);

    uploadBtn.disabled = true;
    uploadBtn.textContent = 'Uploading...';

    try {
      const targetCollection = await ensureCollectionExists(collectionName, { allowReuse: false });
      if (!targetCollection) {
        throw new Error('Could not generate a valid collection name from the uploaded file.');
      }

      const res = await fetch(buildApiUrl(`api/collections/${encodeURIComponent(targetCollection)}/upload`), {
        method: 'POST',
        body: formData
      });

      const result = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(result.error || 'Upload failed');
      }

      await loadCollections();
      currentCollection = targetCollection;
      setActiveCollectionItem(currentCollection);
      await loadCollection(currentCollection);
      showStatusPrompt(`Imported ${file.name} into collection "${targetCollection}".`);
    } catch (err) {
      console.error('File upload failed', err);
      alert(err.message || 'Could not upload file.');
    } finally {
      uploadBtn.disabled = false;
      uploadBtn.textContent = 'Upload File';
      uploadFileInput.value = '';
    }
  });
}

function getCurrentUser() {
  try {
    const savedUser = JSON.parse(localStorage.getItem('inventoryUser') || 'null');
    return savedUser || null;
  } catch (err) {
    return null;
  }
}

function isVerifiedUser() {
  const user = getCurrentUser();
  if (!user) return false;
  return String(user.role || '').toLowerCase() === 'admin' || user.verified === true;
}

function canUseStaffFeatures() {
  return isAdminUser() || isVerifiedUser();
}

function applyUserAccessState() {
  const staffOnlyControls = [
    processOrderBtn,
    lowStockBtn,
    recordsBtn,
    uploadBtn,
    addCollectionBtn,
    addRowBtn,
    addRowTopBtn,
    collectionSearch,
    collectionSelect
  ].filter(Boolean);

  const canUseFeatures = canUseStaffFeatures();

  staffOnlyControls.forEach((control) => {
    if (!control) return;
    if (control.tagName === 'BUTTON') {
      control.disabled = !canUseFeatures;
      control.style.opacity = canUseFeatures ? '1' : '0.45';
      control.style.cursor = canUseFeatures ? 'pointer' : 'not-allowed';
    }
    if (control === collectionSearch || control === collectionSelect) {
      control.setAttribute('aria-disabled', String(!canUseFeatures));
    }
  });

  if (tbody) {
    const cells = tbody.querySelectorAll('td[data-field]');
    cells.forEach((cell) => {
      const allowEdit = canUseStaffFeatures();
      cell.contentEditable = allowEdit ? 'true' : 'false';
      if (!allowEdit) {
        cell.setAttribute('title', 'Verification required to edit inventory');
      } else {
        cell.removeAttribute('title');
      }
    });
  }
}

function render(rows) {
  tbody.innerHTML = '';
  rows.forEach((r, idx) => {
    const tr = document.createElement('tr');
    if (r._id) tr.dataset.id = r._id;

    const numTd = document.createElement('td');
    numTd.className = 'row-number-col';
    numTd.textContent = String(idx + 1);
    numTd.setAttribute('aria-hidden', 'true');
    tr.appendChild(numTd);

    const makeCell = (field, raw = '') => {
      const td = document.createElement('td');
      td.setAttribute('data-field', field);
      if (raw) td.dataset.rawField = raw;
      const isEditable = canUseStaffFeatures();
      td.contentEditable = isEditable ? 'true' : 'false';
      if (!isEditable) {
        td.setAttribute('title', 'Verification required to edit inventory');
      }
      td.textContent = safeCellValue(r[field]);
      if (field === 'stock') {
        applyStockStatus(td, r[field]);
      }
      return td;
    };

    tr.appendChild(makeCell('model', '__EMPTY'));
    tr.appendChild(makeCell('brand', '__EMPTY_1'));
    tr.appendChild(makeCell('made', '__EMPTY_2'));
    tr.appendChild(makeCell('partNumber', '__EMPTY_3'));
    tr.appendChild(makeCell('description', '__EMPTY_4'));
    tr.appendChild(makeCell('size', '__EMPTY_5'));
    tr.appendChild(makeCell('price', '__EMPTY_6'));
    tr.appendChild(makeCell('stock', '__EMPTY_7'));

    tbody.appendChild(tr);
  });
}

applyUserAccessState();

const sampleTemplateContainer = document.getElementById('sampleTemplateContainer');

if (processOrderBtn) {
  processOrderBtn.disabled = false;
  processOrderBtn.title = 'Open sample template';
  processOrderBtn.style.opacity = '1';
  processOrderBtn.style.cursor = 'pointer';
  processOrderBtn.addEventListener('click', async () => {
    if (!canUseStaffFeatures()) {
      alert('Only verified users can access this feature.');
      return;
    }

    if (!currentCollection) {
      alert('Please select a collection first.');
      return;
    }

    const collections = await fetchCollections();
    window.availableCollections = collections || [];
    populateProcessCollectionDropdown();

    if (processCollectionSelect) {
      processCollectionSelect.value = '';
    }

    resetProcessOrderTable();

    if (processModal) {
      processModal.setAttribute('aria-hidden', 'false');
    }
    if (processForm) {
      processForm.hidden = true;
    }
    if (sampleTemplateContainer) {
      sampleTemplateContainer.hidden = false;
    }
  });
}

if (cancelProcess) {
  cancelProcess.addEventListener('click', () => {
    if (processModal) {
      processModal.setAttribute('aria-hidden', 'true');
    }
    if (sampleTemplateContainer) {
      sampleTemplateContainer.hidden = true;
    }
    if (processForm) {
      processForm.hidden = true;
    }
  });
}

if (addProcessRowBtn && sampleTemplateTable) {
  addProcessRowBtn.addEventListener('click', () => {
    const tbody = sampleTemplateTable.querySelector('tbody');
    if (!tbody) return;

    const row = document.createElement('tr');
    row.innerHTML = getProcessOrderRowTemplate();

    tbody.appendChild(row);
    populateSampleModelDropdown();
    bindSampleModelAutofill();
  });
}

if (processCollectionSelect) {
  processCollectionSelect.addEventListener('change', async () => {
    const selectedCollection = processCollectionSelect.value;
    if (!selectedCollection) return;

    await refreshProcessOrderCollectionData();
  });

  processCollectionSelect.addEventListener('input', () => {
    const typedValue = processCollectionSelect.value.trim();
    if (!typedValue) {
      currentCollection = '';
    }
  });
}

if (processOrderModeIn) {
  processOrderModeIn.addEventListener('click', () => setProcessOrderMode('in'));
}
if (processOrderModeOut) {
  processOrderModeOut.addEventListener('click', () => setProcessOrderMode('out'));
}
if (processOrderModeToggle) {
  processOrderModeToggle.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setProcessOrderMode(processOrderMode === 'in' ? 'out' : 'in');
    }
  });
}

if (convertSampleToPdfBtn) {
  convertSampleToPdfBtn.addEventListener('click', async () => {
    if (!sampleTemplateTable) return;

    const rows = Array.from(sampleTemplateTable.querySelectorAll('tbody tr')).map(tr => {
      return Array.from(tr.querySelectorAll('input')).map(control => {
        if (control.classList.contains('sample-model-input')) {
          return control.dataset.inventoryKey || control.value || '';
        }
        return control.value || '';
      });
    }).filter(row => row.some(cell => String(cell).trim()));

    if (processOrderMode === 'out') {
      if (!currentCollection) {
        alert('Please select a collection first.');
        return;
      }

      const restockRecords = [];
      const stockUpdates = new Map();

      rows.forEach(row => {
        const modelValue = String(row[0] || '').trim();
        const partNo = String(row[1] || '').trim();
        const description = String(row[2] || '').trim();
        const price = String(row[3] || '').trim();
        const restockQty = parseStockAmount(row[4]);

        if (!modelValue || restockQty <= 0) return;

        const matchedItem = findInventoryItemFromSelection(modelValue) || data.find(item => {
          const itemModel = String(item.model || '').trim();
          const itemPart = String(item.partNumber || item.partNo || item.size || '').trim();
          return itemModel === modelValue || itemPart === partNo || (!partNo && itemModel === modelValue);
        });

        const unitCost = Number(price || (matchedItem && matchedItem.price !== undefined && matchedItem.price !== null ? String(matchedItem.price) : '')) || 0;
        const totalRestockPrice = restockQty > 0 && unitCost > 0 ? unitCost * restockQty : unitCost;
        const normalizedRecord = {
          supplierName: (clientNameInput && clientNameInput.value ? clientNameInput.value.trim() : ''),
          purchaseDate: (clientDateInput && clientDateInput.value ? clientDateInput.value.trim() : new Date().toISOString().slice(0, 10)),
          invoiceNumber: (invoiceNumberInput && invoiceNumberInput.value ? invoiceNumberInput.value.trim() : ''),
          invoiceNo: (invoiceNumberInput && invoiceNumberInput.value ? invoiceNumberInput.value.trim() : ''),
          invoice: (invoiceNumberInput && invoiceNumberInput.value ? invoiceNumberInput.value.trim() : ''),
          collection: currentCollection || 'unknown',
          item: currentCollection || 'unknown',
          model: matchedItem ? String(matchedItem.model || '').trim() || modelValue : modelValue,
          partNo: matchedItem ? String(matchedItem.partNumber || matchedItem.partNo || '').trim() || partNo : partNo,
          description: matchedItem ? String(matchedItem.description || '').trim() || description : description,
          price: totalRestockPrice,
          unitCost,
          stockBought: restockQty,
          stock: restockQty,
          direction: 'in',
          mode: 'restock',
          savedAt: new Date()
        };

        restockRecords.push(normalizedRecord);

        if (matchedItem && matchedItem._id) {
          const currentStock = parseStockAmount(matchedItem.stock || matchedItem.msl || 0);
          stockUpdates.set(String(matchedItem._id), (stockUpdates.get(String(matchedItem._id)) || currentStock) + restockQty);
        }
      });

      if (!restockRecords.length) {
        alert('Please add at least one valid restock item.');
        return;
      }

      try {
        const recordInRes = await fetch(buildApiUrl('api/recordin'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ records: restockRecords })
        });

        if (!recordInRes.ok) {
          const errText = await recordInRes.text();
          throw new Error(errText || 'Could not save restock in recordin');
        }
      } catch (err) {
        console.error('Restock save failed:', err);
        alert(err.message || 'Could not save restock details.');
        return;
      }

      for (const [itemId, updatedStock] of stockUpdates.entries()) {
        const matchingItem = data.find(item => String(item._id) === itemId);
        if (!matchingItem) continue;

        try {
          const updateRes = await fetch(buildApiUrl(`api/collections/${encodeURIComponent(currentCollection)}/${encodeURIComponent(itemId)}`), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ stock: updatedStock, __EMPTY_7: updatedStock })
          });

          if (!updateRes.ok) {
            console.warn('Restock stock update failed for item', itemId, updateRes.status);
          }
        } catch (err) {
          console.warn('Restock stock update exception:', err);
        }
      }

      await loadCollection(currentCollection);
      alert('Restock saved successfully.');
      if (processModal) {
        processModal.setAttribute('aria-hidden', 'true');
      }
      return;
    }

    const rowsForPdf = Array.from(sampleTemplateTable.querySelectorAll('tbody tr')).map(tr => {
      return Array.from(tr.querySelectorAll('input, select')).map(control => {
        if (control.classList.contains('sample-model-input')) {
          return control.dataset.inventoryKey || control.value || '';
        }
        return control.value || '';
      });
    });

    if (!validateProcessOrderRows(rowsForPdf)) {
      return;
    }

    const processedRows = await applyOrderStockReduction(rowsForPdf);
    const orderClientName = (clientNameInput && clientNameInput.value ? clientNameInput.value.trim() : '');
    const orderPurchaseDate = (clientDateInput && clientDateInput.value ? clientDateInput.value.trim() : new Date().toLocaleDateString());
    const orderInvoiceNumber = (invoiceNumberInput && invoiceNumberInput.value ? invoiceNumberInput.value.trim() : '');

    const orderRecords = processedRows
      .filter(row => Array.isArray(row) && row.length >= 6 && String(row[0] || '').trim())
      .map(row => {
        const selectionValue = String(row[0] || '').trim();
        const matchedItem = findInventoryItemFromSelection(selectionValue);
        const model = matchedItem ? String(matchedItem.model || '').trim() : String(row[0] || '').trim();
        const brand = matchedItem ? String(matchedItem.brand || '').trim() : String(row[1] || '').trim();
        const partNo = matchedItem ? String(matchedItem.partNumber || matchedItem.partNo || '').trim() : String(row[2] || '').trim();
        const stockIndex = processOrderMode === 'out' ? 4 : 5;
        const priceIndex = processOrderMode === 'out' ? 3 : 4;
        const descriptionIndex = processOrderMode === 'out' ? 2 : 3;
        const stockBought = parseStockAmount(row[stockIndex]);
        const parsedPrice = Number(String(row[priceIndex] || '').replace(/[^0-9.-]/g, '')) || 0;
        const unitPrice = matchedItem && matchedItem.price !== undefined && matchedItem.price !== null ? Number(matchedItem.price) || parsedPrice || 0 : parsedPrice;
        const description = matchedItem ? String(matchedItem.description || '').trim() : String(row[descriptionIndex] || '').trim();
        const totalPrice = stockBought > 0 ? unitPrice * stockBought : unitPrice;

        const persistedInvoiceNumber = orderInvoiceNumber || '';

        return {
          clientName: orderClientName,
          purchaseDate: orderPurchaseDate,
          invoiceNumber: persistedInvoiceNumber,
          invoiceNo: persistedInvoiceNumber,
          invoice: persistedInvoiceNumber,
          collection: currentCollection || 'unknown',
          item: currentCollection || 'unknown',
          model,
          brand,
          made: brand,
          partNo,
          description,
          price: totalPrice,
          unitCost: unitPrice,
          stockBought,
          stock: stockBought,
          brandMade: brand,
          direction: 'out',
          mode: 'order'
        };
      });

    try {
      const orderRes = await fetch(buildApiUrl('api/orders'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: orderRecords })
      });

      if (!orderRes.ok) {
        const errText = await orderRes.text();
        throw new Error(errText || 'Could not save order');
      }
    } catch (err) {
      console.error('Order save failed:', err);
      alert(err.message || 'Could not save order.');
      return;
    }

    await loadCollection(currentCollection);
    alert('Order saved successfully.');
    if (processModal) {
      processModal.setAttribute('aria-hidden', 'true');
    }
  });
}

if (processForm) {
  processForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (processModal) {
      processModal.setAttribute('aria-hidden', 'true');
    }
  });
}

if (processModal) {
  processModal.setAttribute('aria-hidden', 'true');
}

function getRecordDirection(record) {
  if (!record) return '';
  if (record.recordedIn === 'recordin') return 'restock';
  const rawValue = record.direction ?? record.mode ?? record.orderType ?? record.type ?? '';
  const normalized = String(rawValue || '').trim().toLowerCase();
  if (!normalized) return '';
  if (normalized.includes('restock') || normalized === 'in' || normalized === 'purchase') return 'restock';
  if (normalized === 'out' || normalized.includes('order') || normalized === 'sale') return 'order';
  return normalized;
}

async function loadRecordsForMode(mode = recordsMode) {
  const normalizedMode = mode === 'restock' ? 'restock' : 'order';
  const endpoint = normalizedMode === 'restock' ? buildApiUrl('api/recordin') : buildApiUrl('api/orders/history');
  try {
    const response = await fetch(endpoint);
    const records = response.ok ? await response.json().catch(() => []) : [];
    recordsCache = Array.isArray(records) ? records : [];
    renderRecordsTable(recordsCache);
    return recordsCache;
  } catch (err) {
    console.warn('Could not load records for mode', normalizedMode, err);
    recordsCache = [];
    renderRecordsTable(recordsCache);
    return [];
  }
}

function setRecordsMode(mode) {
  recordsMode = mode === 'restock' ? 'restock' : 'order';
  if (recordsModeIn) recordsModeIn.classList.toggle('active', recordsMode === 'order');
  if (recordsModeOut) recordsModeOut.classList.toggle('active', recordsMode === 'restock');
  if (recordsModeToggle) recordsModeToggle.setAttribute('aria-checked', String(recordsMode === 'restock'));
  loadRecordsForMode(recordsMode);
}

function getRecordsExportEndpointForMode(mode = recordsMode) {
  const normalizedMode = mode === 'restock' ? 'restock' : 'order';
  return normalizedMode === 'restock' ? buildApiUrl('api/recordin') : buildApiUrl('api/orders/history');
}

function normalizeDateValue(value) {
  if (value === null || value === undefined) return '';

  const raw = String(value).trim();
  if (!raw) return '';

  const isoMatch = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${String(isoMatch[2]).padStart(2, '0')}-${String(isoMatch[3]).padStart(2, '0')}`;
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
  }

  return raw.slice(0, 10);
}

function calculateRecordTotalPrice(record) {
  const unitCost = Number(record?.unitCost ?? record?.price ?? 0) || 0;
  const stockBought = Number(record?.stockBought ?? record?.stock ?? 0) || 0;
  const explicitPrice = Number(record?.price ?? 0) || 0;

  if (stockBought > 0 && unitCost > 0) {
    const expectedTotal = unitCost * stockBought;
    if (explicitPrice === 0 || explicitPrice === unitCost || explicitPrice === expectedTotal || explicitPrice < unitCost) {
      return expectedTotal;
    }
    return explicitPrice;
  }

  if (explicitPrice > 0) {
    return explicitPrice;
  }

  return unitCost;
}

function renderRecordsTable(records) {
  const tableBody = document.getElementById('recordsTableBody');
  const emptyState = document.getElementById('recordsEmptyState');
  const filterValue = recordsCollectionFilter ? recordsCollectionFilter.value.trim().toLowerCase() : '';
  const dateFilterValue = recordsDateFilter ? recordsDateFilter.value : '';

  if (!tableBody || !emptyState) return;

  const filteredRecords = (records || []).filter(record => {
    const direction = getRecordDirection(record);
    const matchesDirection = !direction || direction === recordsMode;
    if (!matchesDirection) return false;

    const recordDate = normalizeDateValue(record.purchaseDate || record.createdAt || record.savedAt || '');
    if (dateFilterValue && recordDate !== dateFilterValue) return false;
    if (!filterValue) return true;

    const searchableValues = [
      record.clientName,
      record.supplierName,
      record.collection,
      record.item,
      record.model,
      record.brand,
      record.made,
      record.partNo,
      record.partNumber,
      record.description,
      record.invoiceNumber,
      record.invoiceNo,
      record.invoice,
      record.purchaseDate,
      recordDate
    ];

    return searchableValues.some(value =>
      String(value ?? '').toLowerCase().includes(filterValue)
    );
  });

  tableBody.innerHTML = filteredRecords.map(record => {
    const invoiceValue = record.invoiceNumber ?? record.invoiceNo ?? record.invoice ?? '';
    const unitCostValue = record.unitCost ?? record.price ?? '';
    const totalPriceValue = calculateRecordTotalPrice(record);
    return `
      <tr>
        <td>${escapeHtml(record.clientName || '')}</td>
        <td>${escapeHtml(record.purchaseDate || '')}</td>
        <td>${escapeHtml(record.collection || '')}</td>
        <td>${escapeHtml(invoiceValue)}</td>
        <td>${escapeHtml(record.model || '')}</td>
        <td>${escapeHtml(record.brand || '')}</td>
        <td>${escapeHtml(record.made || '')}</td>
        <td>${escapeHtml(record.partNo || '')}</td>
        <td>${escapeHtml(record.description || '')}</td>
        <td>${escapeHtml(totalPriceValue)}</td>
        <td>${escapeHtml(unitCostValue)}</td>
        <td>${escapeHtml(record.stockBought ?? '')}</td>
      </tr>
    `;
  }).join('');

  emptyState.hidden = filteredRecords.length > 0;
}

async function openRecordsModal() {
  const modal = document.getElementById('recordsModal');
  const tableBody = document.getElementById('recordsTableBody');
  const emptyState = document.getElementById('recordsEmptyState');

  if (!modal || !tableBody) return;

  tableBody.innerHTML = '';
  emptyState.hidden = false;
  modal.setAttribute('aria-hidden', 'false');

  const headers = ['Client', 'Date', 'Parts', 'Invoice Number', 'Model', 'Brand', 'Made', 'Part No', 'Description', 'Price', 'Unit Cost', 'Stock Bought'];
  const tableHead = document.getElementById('recordsTableHead');
  if (tableHead) {
    tableHead.innerHTML = headers.map(header => `<th>${header}</th>`).join('');
  }

  await loadRecordsForMode(recordsMode);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getLowStockRows() {
  const rows = Array.isArray(data) ? data : [];

  return rows
    .map(item => {
      const rawStock = item.stock ?? item.stockOnHand ?? item.quantity ?? item.qty ?? item['stock on hand'] ?? item['Stock on Hand'];
      const stockValue = Number(String(rawStock ?? '').replace(/[^0-9.-]/g, ''));
      return {
        collectionName: currentCollection || 'Current Parts',
        model: String(item.model || item.product || item.name || '').trim(),
        partNo: String(item.partNumber || item.partNo || item.size || '').trim(),
        stock: Number.isFinite(stockValue) ? stockValue : null
      };
    })
    .filter(item => item.stock !== null && item.stock >= 0 && item.stock <= 2)
    .sort((a, b) => (a.stock ?? 99) - (b.stock ?? 99));
}

function renderLowStockTable() {
  const tableBody = document.getElementById('lowStockTableBody');
  const emptyState = document.getElementById('lowStockEmptyState');
  if (!tableBody) return;

  const rows = getLowStockRows();
  tableBody.innerHTML = rows.map(row => `
    <tr>
      <td>${escapeHtml(row.collectionName || 'Current Parts')}</td>
      <td>${escapeHtml(row.model || '')}</td>
      <td>${escapeHtml(row.partNo || '')}</td>
      <td>${escapeHtml(String(row.stock))}</td>
    </tr>
  `).join('');

  if (emptyState) {
    emptyState.hidden = rows.length > 0;
  }
}

if (lowStockBtn) {
  lowStockBtn.addEventListener('click', () => {
    if (!canUseStaffFeatures()) {
      alert('Only verified users can access this feature.');
      return;
    }

    renderLowStockTable();
    const modal = document.getElementById('lowStockModal');
    if (modal) modal.setAttribute('aria-hidden', 'false');
  });
}

const closeLowStockModal = document.getElementById('closeLowStockModal');
if (closeLowStockModal) {
  closeLowStockModal.addEventListener('click', () => {
    const modal = document.getElementById('lowStockModal');
    if (modal) modal.setAttribute('aria-hidden', 'true');
  });
}

async function loadUserAccounts() {
  const modal = document.getElementById('accountListModal');
  const tableBody = document.getElementById('accountListTableBody');
  const emptyState = document.getElementById('accountListEmptyState');
  if (!modal || !tableBody) return;

  tableBody.innerHTML = '<tr><td colspan="4">Loading...</td></tr>';
  if (emptyState) emptyState.hidden = true;

  try {
    const response = await fetch(`${API_BASE}/api/accounts`, { cache: 'no-store' });
    const accounts = response.ok ? await response.json() : [];
    const rows = Array.isArray(accounts) ? accounts : [];

    if (!rows.length) {
      tableBody.innerHTML = '';
      if (emptyState) emptyState.hidden = false;
      return;
    }

    tableBody.innerHTML = rows.map(account => `
      <tr data-account-id="${escapeHtml(String(account._id || ''))}">
        <td>${escapeHtml(account.name || account.username || 'Unknown')}</td>
        <td>${escapeHtml(account.username || '')}</td>
        <td>
          <select class="account-role-select" data-account-id="${escapeHtml(String(account._id || ''))}">
            <option value="admin" ${String(account.role || 'staff').toLowerCase() === 'admin' ? 'selected' : ''}>admin</option>
            <option value="staff" ${String(account.role || 'staff').toLowerCase() === 'staff' ? 'selected' : ''}>staff</option>
          </select>
        </td>
        <td>
          <select class="account-verified-select" data-account-id="${escapeHtml(String(account._id || ''))}">
            <option value="true" ${String(account.verified ?? false) === 'true' ? 'selected' : ''}>Verified</option>
            <option value="false" ${String(account.verified ?? false) === 'false' ? 'selected' : ''}>Not Verified</option>
          </select>
        </td>
        <td><input type="text" class="account-password-input" data-account-id="${escapeHtml(String(account._id || ''))}" value="" placeholder="Set new password" /></td>
      </tr>
    `).join('');

    tableBody.querySelectorAll('.account-role-select, .account-verified-select, .account-password-input').forEach((input) => {
      input.addEventListener('change', async () => {
        const accountId = input.getAttribute('data-account-id');
        const row = input.closest('tr');
        if (!row || !accountId) return;

        const roleSelect = row.querySelector('.account-role-select');
        const verifiedSelect = row.querySelector('.account-verified-select');
        const passwordInput = row.querySelector('.account-password-input');
        const newRole = roleSelect ? roleSelect.value : 'staff';
        const newVerified = verifiedSelect ? verifiedSelect.value === 'true' : false;
        const newPassword = passwordInput ? passwordInput.value.trim() : '';

        try {
          const payload = { role: newRole, verified: newVerified };
          if (newPassword) payload.password = newPassword;

          const response = await fetch(`${API_BASE}/api/accounts/${encodeURIComponent(accountId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });

          const result = response.ok ? await response.json() : null;
          if (!response.ok) {
            throw new Error((result && result.error) || 'Failed to update account');
          }

          if (passwordInput) passwordInput.value = '';
        } catch (err) {
          console.error('Could not save account:', err);
          alert(err.message || 'Unable to save account');
        }
      });
    });

    if (emptyState) emptyState.hidden = true;
  } catch (err) {
    tableBody.innerHTML = '';
    if (emptyState) emptyState.hidden = false;
    console.warn('Could not load user accounts:', err);
  }
}

const closeAccountListModal = document.getElementById('closeAccountListModal');
if (closeAccountListModal) {
  closeAccountListModal.addEventListener('click', () => {
    const modal = document.getElementById('accountListModal');
    if (modal) {
      modal.classList.add('hidden');
      modal.setAttribute('aria-hidden', 'true');
    }
  });
}

if (profileBtn) {
  profileBtn.addEventListener('click', async () => {
    const modal = document.getElementById('accountListModal');
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    await loadUserAccounts();
  });
}

if (recordsBtn) {
  recordsBtn.addEventListener('click', async () => {
    if (!canUseStaffFeatures()) {
      alert('Only verified users can access this feature.');
      return;
    }

    await openRecordsModal();
  });
}

const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('inventoryUser');
    localStorage.removeItem('inventoryLoggedIn');
    window.location.replace('/');
  });
}

enforceAuthGuard();

function isAdminUser() {
  try {
    const savedUser = JSON.parse(localStorage.getItem('inventoryUser') || 'null');
    return String(savedUser && savedUser.role ? savedUser.role : '').toLowerCase() === 'admin';
  } catch (err) {
    return false;
  }
}

function applyLocationVisibility() {
  const locationSwitch = document.querySelector('.location-switch');
  const isAdmin = isAdminUser();

  if (locationSwitch) {
    locationSwitch.classList.toggle('hidden', !isAdmin);
  }

  if (profileBtn) {
    profileBtn.classList.toggle('hidden', !isAdmin);
  }

  locationSwitchOptions.forEach((option) => {
    option.hidden = !isAdmin;
    option.setAttribute('aria-hidden', String(!isAdmin));
  });

  updateActiveDatabaseBadge();
  applyUserAccessState();
}

function enforceAuthGuard() {
  const loggedIn = localStorage.getItem('inventoryLoggedIn') === 'true';
  const savedUser = localStorage.getItem('inventoryUser');
  if (!loggedIn || !savedUser) {
    localStorage.removeItem('inventoryUser');
    localStorage.removeItem('inventoryLoggedIn');
    window.location.replace('/');
    return;
  }

  window.history.pushState(null, '', window.location.href);
  window.addEventListener('popstate', () => {
    window.history.pushState(null, '', window.location.href);
  });
}

if (locationSwitchOptions.length) {
  initializeSelectedLocationFromQuery();
  applyLocationVisibility();

  const updateLocationSelection = (button) => {
    selectedLocation = button.dataset.location || 'calamba';
    localStorage.setItem('inventorySelectedLocation', selectedLocation);
    locationSwitchOptions.forEach((option) => {
      const isActive = option === button;
      option.classList.toggle('active', isActive);
      option.setAttribute('aria-selected', String(isActive));
      option.tabIndex = isActive ? 0 : -1;
    });
    updateActiveDatabaseBadge();
    loadCollections().catch((err) => console.error('Failed to refresh collections for location', selectedLocation, err));
  };

  const currentActiveButton = Array.from(locationSwitchOptions).find((option) => option.dataset.location === selectedLocation);
  if (currentActiveButton) {
    updateLocationSelection(currentActiveButton);
  }

  locationSwitchOptions.forEach((button) => {
    button.addEventListener('click', () => {
      if (!isAdminUser()) return;
      updateLocationSelection(button);
    });
  });
}

if (recordsCollectionFilter) {
  recordsCollectionFilter.addEventListener('input', () => {
    renderRecordsTable(recordsCache);
  });
}

if (recordsDateFilter) {
  recordsDateFilter.addEventListener('input', () => {
    renderRecordsTable(recordsCache);
  });
}

if (recordsModeIn) {
  recordsModeIn.addEventListener('click', () => setRecordsMode('order'));
}
if (recordsModeOut) {
  recordsModeOut.addEventListener('click', () => setRecordsMode('restock'));
}
if (recordsModeToggle) {
  recordsModeToggle.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setRecordsMode(recordsMode === 'order' ? 'restock' : 'order');
    }
  });
}

const closeRecordsModal = document.getElementById('closeRecordsModal');
if (closeRecordsModal) {
  closeRecordsModal.addEventListener('click', () => {
    const modal = document.getElementById('recordsModal');
    if (modal) modal.setAttribute('aria-hidden', 'true');
  });
}

const exportRecordsBtn = document.getElementById('exportRecordsBtn');
if (exportRecordsBtn) {
  exportRecordsBtn.addEventListener('click', async () => {
    try {
      const endpoint = getRecordsExportEndpointForMode(recordsMode);
      const response = await fetch(endpoint);
      if (!response.ok) {
        throw new Error('Could not load records');
      }

      const records = await response.json();
      if (!Array.isArray(records) || !records.length) {
        alert(`No ${recordsMode === 'restock' ? 'restock' : 'order'} records to export.`);
        return;
      }

      const filePrefix = recordsMode === 'restock' ? 'restock-export' : 'order-export';

      const rows = (records || []).map(record => ({
        Date: safeCellValue(record.purchaseDate),
        Parts: safeCellValue(record.collection),
        Client: safeCellValue(record.clientName),
        'Invoice Number': safeCellValue(record.invoiceNumber),
        Model: safeCellValue(record.model),
        Brand: safeCellValue(record.brand),
        Made: safeCellValue(record.made),
        'Part No': safeCellValue(record.partNo),
        Description: safeCellValue(record.description),
        Price: safeCellValue(calculateRecordTotalPrice(record)),
        'Unit Cost': safeCellValue(record.unitCost ?? record.price),
        'Stock Bought': safeCellValue(record.stockBought)
      }));

      const normalizedRows = (rows || []).map((row, index) => {
        const previousRow = index > 0 ? (rows || [])[index - 1] : null;
        const isSameDate = previousRow && String(previousRow.Date || '').trim() && String(previousRow.Date || '').trim() === String(row.Date || '').trim();
        return {
          ...row,
          Date: isSameDate ? '' : row.Date
        };
      });

      const workbook = XLSX.utils.book_new();
      const headerOrder = ['Date', 'Parts', 'Client', 'Invoice Number', 'Model', 'Brand', 'Made', 'Part No', 'Description', 'Price', 'Unit Cost', 'Stock Bought'];
      const sheet = XLSX.utils.json_to_sheet(normalizedRows, { skipHeader: false });
      const columnWidths = headerOrder.map(header => {
        const maxCellLength = Math.max(
          header.length,
          ...(normalizedRows || []).map(row => String(row[header] ?? '').length)
        );
        return { wch: Math.min(Math.max(maxCellLength + 2, 10), 30) };
      });
      sheet['!cols'] = columnWidths;

      const headerRange = XLSX.utils.decode_range(sheet['!ref']);
      for (let C = headerRange.s.c; C <= headerRange.e.c; C += 1) {
        const cellRef = XLSX.utils.encode_cell({ r: headerRange.s.r, c: C });
        if (!sheet[cellRef]) continue;
        sheet[cellRef].s = {
          fill: {
            patternType: 'solid',
            fgColor: { rgb: 'D9D9D9' },
            bgColor: { rgb: 'D9D9D9' }
          },
          font: { bold: true, color: { rgb: '000000' } },
          alignment: { horizontal: 'center', vertical: 'center' }
        };
      }

      XLSX.utils.book_append_sheet(workbook, sheet, recordsMode === 'restock' ? 'Restock' : 'Order');

      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      XLSX.writeFile(workbook, `${filePrefix}-${stamp}.xlsx`);
    } catch (err) {
      console.error('Export records failed:', err);
      alert(`Could not export ${recordsMode === 'restock' ? 'restock' : 'order'} records.`);
    }
  });
}

if (addRowBtn) {
  addRowBtn.addEventListener('click', async () => {
    if (!currentCollection) return alert('Please select a collection first.');
    const rowPayload = {
      __EMPTY: 'NEW ITEM',
      __EMPTY_1: '',
      __EMPTY_2: '',
      __EMPTY_3: '',
      __EMPTY_4: '',
      __EMPTY_5: '',
      __EMPTY_6: ''
    };

    try {
      const res = await fetch(buildApiUrl(`api/collections/${encodeURIComponent(currentCollection)}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rowPayload)
      });

      const result = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(result.error || 'Could not add row');
      }

      await loadCollection(currentCollection);
    } catch (err) {
      console.error('Add row failed:', err);
      alert(err.message || 'Could not add row');
    }
  });
}

// top add-row button (same behaviour as left-side add)
if (addRowTopBtn) {
  addRowTopBtn.addEventListener('click', async () => {
    if (!currentCollection) return alert('Please select a collection first.');
    const rowPayload = {
      __EMPTY: 'NEW ITEM',
      __EMPTY_1: '',
      __EMPTY_2: '',
      __EMPTY_3: '',
      __EMPTY_4: '',
      __EMPTY_5: '',
      __EMPTY_6: ''
    };

    try {
      const res = await fetch(buildApiUrl(`api/collections/${encodeURIComponent(currentCollection)}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rowPayload)
      });

      const result = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(result.error || 'Could not add row');
      }

      await loadCollection(currentCollection);
    } catch (err) {
      console.error('Add row failed:', err);
      alert(err.message || 'Could not add row');
    }
  });
}

// populate client date with today's date
if (clientDateInput) {
  const now = new Date();
  clientDateInput.value = now.toISOString().slice(0, 10);
}

function openCollectionPrompt() {
  if (!collectionPromptModal || !collectionPromptInput) return;
  collectionPromptModal.setAttribute('aria-hidden', 'false');
  collectionPromptInput.value = '';
  setTimeout(() => collectionPromptInput.focus(), 50);
}

function closeCollectionPrompt() {
  if (!collectionPromptModal || !collectionPromptInput) return;
  collectionPromptModal.setAttribute('aria-hidden', 'true');
  collectionPromptInput.value = '';
}

function showStatusPrompt(message) {
  if (!statusPromptModal || !statusPromptMessage) return;
  statusPromptMessage.textContent = String(message || '');
  statusPromptModal.setAttribute('aria-hidden', 'false');
}

function closeStatusPrompt() {
  if (!statusPromptModal) return;
  statusPromptModal.setAttribute('aria-hidden', 'true');
}

if (statusPromptOk) {
  statusPromptOk.addEventListener('click', closeStatusPrompt);
}

if (statusPromptModal) {
  statusPromptModal.addEventListener('click', (event) => {
    if (event.target === statusPromptModal) {
      closeStatusPrompt();
    }
  });
}

if (addCollectionBtn) {
  addCollectionBtn.addEventListener('click', () => {
    openCollectionPrompt();
  });
}

if (collectionPromptCancel) {
  collectionPromptCancel.addEventListener('click', () => {
    closeCollectionPrompt();
  });
}

if (collectionPromptOk) {
  collectionPromptOk.addEventListener('click', async () => {
    const name = collectionPromptInput ? collectionPromptInput.value.trim() : '';
    if (!name) {
      if (collectionPromptInput) collectionPromptInput.focus();
      return;
    }
    closeCollectionPrompt();

    const payload = { name };
    try {
      const res = await fetch(buildApiUrl('api/collections'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(result.error || 'Could not create collection');
      await loadCollections();
      showStatusPrompt(`Collection created: ${result.name || name}`);
    } catch (err) {
      console.error('Create collection failed:', err);
      alert(err.message || 'Could not create collection');
    }
  });
}

if (collectionPromptModal && collectionPromptInput) {
  collectionPromptInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      collectionPromptOk?.click();
    }
    if (event.key === 'Escape') {
      closeCollectionPrompt();
    }
  });
  collectionPromptModal.addEventListener('click', (event) => {
    if (event.target === collectionPromptModal) {
      closeCollectionPrompt();
    }
  });
}

collectionSelect.addEventListener('click', async e => {
  const item = e.target.closest('li[data-name]');
  if (!item) return;
  const name = item.dataset.name;
  if (!name) return;
  currentCollection = name;
  setActiveCollectionItem(name);
  await loadCollection(name);
});

async function fetchCollections(requestToken = collectionsLoadToken) {
  const base = await resolveApiBase();
  const dbName = getSelectedDatabaseName();
  try {
    const res = await fetch(`${base}/api/collections?db=${encodeURIComponent(dbName)}`, { cache: 'no-store' });
    if (requestToken !== collectionsLoadToken) {
      return null;
    }
    if (res.ok) {
      console.log('Using API base:', base, 'database:', dbName);
      return await res.json();
    }
    console.warn('API not available at', base, res.status);
  } catch (e) {
    console.warn('API not available at', base, e);
  }
  return null;
}

function isHiddenCollectionName(name) {
  return /^(sample_format|sampledata|upload)$/i.test(name)
    || /\.files$|\.chunks$/i.test(name)
    || /sample[_-]?format/i.test(name)
    || /^upload$/i.test(name)
    || /^orders?[_\s-]?history$/i.test(name)
    || /^orders?[_\s-]?history[23]$/i.test(name)
    || /^recordin$/i.test(name)
    || /^recordin[23]$/i.test(name)
    || /^recording$/i.test(name)
    || /^orderin[23]$/i.test(name);
}

async function loadCollections() {
  const requestToken = ++collectionsLoadToken;
  collectionSelect.innerHTML = '<li class="loading-item">Loading Parts…</li>';
  data = [];
  currentCollection = '';
  if (typeof applyFilters === 'function') {
    applyFilters();
  }

  const cols = await fetchCollections(requestToken);
  if (requestToken !== collectionsLoadToken) {
    return;
  }

  collectionSelect.innerHTML = '';
  if (!cols) {
    const item = document.createElement('li');
    item.className = 'loading-item';
    item.textContent = 'Unable to reach API (see console)';
    collectionSelect.appendChild(item);
    console.error('Could not reach any API endpoints.');
    return;
  }

  const renderCollections = (items) => {
    collectionSelect.innerHTML = '';

    // hide internal/system collections and sort alphabetically
    const visible = (items || []).filter(name => !isHiddenCollectionName(name));
    visible.sort((a, b) => formatCollectionName(a).localeCompare(formatCollectionName(b), undefined, { sensitivity: 'base' }));

    visible.forEach(c => {
      const item = document.createElement('li');
      item.dataset.name = c;
      item.textContent = formatCollectionName(c);
      item.setAttribute('role', 'button');
      item.setAttribute('tabindex', '0');
      item.addEventListener('keydown', async ev => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          const name = item.dataset.name;
          if (!name) return;
          currentCollection = name;
          setActiveCollectionItem(name);
          await loadCollection(name);
        }
      });
      item.addEventListener('click', async () => {
        const name = item.dataset.name;
        if (!name) return;
        currentCollection = name;
        setActiveCollectionItem(name);
        await loadCollection(name);
      });
      collectionSelect.appendChild(item);
    });
  };

  const applyCollectionSearch = () => {
    const value = (collectionSearch && collectionSearch.value || '').trim().toLowerCase();
    const filtered = !value ? cols : cols.filter(c => c.toLowerCase().includes(value));
    renderCollections(filtered);

    // pick first visible collection (skip files/chunks and upload) and choose alphabetically first
    const visibleFiltered = (filtered || []).filter(name => !isHiddenCollectionName(name))
      .sort((a, b) => formatCollectionName(a).localeCompare(formatCollectionName(b), undefined, { sensitivity: 'base' }));
    if (visibleFiltered.length > 0 && !visibleFiltered.some(c => c === currentCollection)) {
      currentCollection = visibleFiltered[0];
      setActiveCollectionItem(currentCollection);
      loadCollection(currentCollection);
    }
  };

  if (collectionSearch) {
    collectionSearch.addEventListener('input', applyCollectionSearch);
  }

  renderCollections(cols);

  // select first visible collection (alphabetical)
  const firstVisible = (cols || []).filter(name => !isHiddenCollectionName(name))
    .sort((a, b) => formatCollectionName(a).localeCompare(formatCollectionName(b), undefined, { sensitivity: 'base' }))[0];
  if (firstVisible) {
    currentCollection = firstVisible;
    setActiveCollectionItem(firstVisible);
    await loadCollection(firstVisible);
  }
}

async function loadCollection(name) {
  const targetName = String(name || '').trim();
  if (!targetName) return;

  const requestToken = ++collectionLoadToken;

  try {
    const res = await fetch(buildApiUrl(`api/collections/${encodeURIComponent(targetName)}`, { limit: 1000 }));
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const docs = await res.json();

    if (requestToken !== collectionLoadToken) {
      return;
    }

    const cleanedDocs = Array.isArray(docs) ? docs.filter(doc => !isHeaderRow(doc)) : [];
    data = cleanedDocs.map(d => normalizeDoc(d));
    applyFilters();
  } catch (err) {
    if (requestToken !== collectionLoadToken) {
      return;
    }
    console.error('Failed to load collection', targetName, err);
  }
}

tbody.addEventListener('focusout', async (event) => {
  const cell = event.target.closest('[contenteditable="true"]');
  if (!cell) return;

  const row = cell.closest('tr');
  const rowId = row?.dataset?.id;
  if (!rowId || !currentCollection) return;

  const payload = {};
  const cells = row.querySelectorAll('[data-field]');
  cells.forEach(item => {
    const rawField = item.dataset.rawField;
    if (!rawField) return;
    payload[rawField] = item.textContent.trim();
  });

  try {
    const response = await fetch(buildApiUrl(`api/collections/${encodeURIComponent(currentCollection)}/${encodeURIComponent(rowId)}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || 'Update failed');
    }

    cell.style.borderColor = '#10b981';
    setTimeout(() => { cell.style.borderColor = ''; }, 600);
  } catch (err) {
    console.error('Failed to auto-save row', err);
    cell.style.borderColor = '#ef4444';
    setTimeout(() => { cell.style.borderColor = ''; }, 800);
  }
});

loadCollections();
