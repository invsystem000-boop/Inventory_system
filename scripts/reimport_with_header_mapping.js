const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const { MongoClient } = require('mongodb');

const TARGET_FIELDS = ['model', 'brand', 'made', 'partNumber', 'description', 'size', 'price', 'stock'];

function cleanHeader(h) {
  if (h === undefined || h === null) return '';
  return String(h || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ');
}

function detectHeaderRow(rows) {
  const keywords = ['model','brand','made','part','part no','partno','description','price','stock','item','name','msl'];
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const row = rows[i] || [];
    const joined = row.map(cell => String(cell || '').toLowerCase()).join(' ');
    let score = 0;
    for (const kw of keywords) if (joined.includes(kw)) score++;
    if (score >= 2) return i;
  }
  // fallback to first non-empty row
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const row = rows[i] || [];
    if (row.some(cell => String(cell || '').trim() !== '')) return i;
  }
  return 0;
}

function mapHeaderToField(header) {
  const h = cleanHeader(header);
  if (!h) return null;
  if (h.includes('model') || h.includes('item') || h.includes('product') || h.includes('name')) return 'model';
  if (h.includes('brand')) return 'brand';
  if (h.includes('made') || h.includes('manufacturer')) return 'made';
  if (h.includes('part') || h.includes('part no') || h.includes('partno')) return 'partNumber';
  if (h.includes('description') || h.includes('desc')) return 'description';
  if (h.includes('size') || h.includes('dimension')) return 'size';
  if (h.includes('price') || h.includes('cost') || h.includes('unitprice')) return 'price';
  if (h.includes('stock') || h.includes('quantity') || h.includes('onhand')) return 'stock';
  return null;
}

async function processFile(db, filePath) {
  const workbook = xlsx.readFile(filePath, { cellDates: true });
  const sheetName = workbook.SheetNames && workbook.SheetNames[0];
  if (!sheetName) {
    console.warn('No sheets in', filePath);
    return;
  }
  const sheet = workbook.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const headerRowIndex = detectHeaderRow(rows);
  const headerRow = rows[headerRowIndex] || [];

  // Build header mapping from column index -> field name
  const colField = headerRow.map(h => mapHeaderToField(h));

  // create a header array for sheet_to_json that uses original header strings
  const headerNames = headerRow.map(h => String(h || '').trim() || null);
  const docs = xlsx.utils.sheet_to_json(sheet, { header: headerNames, range: headerRowIndex, defval: '' });

  // Normalize and map documents
  const normalized = [];
  for (const doc of docs) {
    // skip rows that appear to be header rows
    const joined = Object.values(doc).map(v => String(v || '').toLowerCase()).join(' ');
    if (/model|brand|part|description|price|stock/.test(joined) && Object.values(doc).every(v => String(v || '').trim() !== '')) {
      continue;
    }

    const out = {};
    // map known fields
    for (let ci = 0; ci < headerRow.length; ci++) {
      const rawHeader = headerRow[ci];
      const field = colField[ci];
      const keyName = rawHeader && String(rawHeader).trim();
      const value = doc[keyName];
      if (field) {
        // normalize numbers where possible
        const valStr = String(value || '').trim();
        if (field === 'price') {
          const num = Number(valStr.replace(/[^0-9.\-]/g, ''));
          out[field] = Number.isFinite(num) ? num : valStr;
        } else if (field === 'stock') {
          const num = Number(valStr.replace(/[^0-9\-]/g, ''));
          out[field] = Number.isFinite(num) ? num : valStr;
        } else {
          out[field] = valStr;
        }
      } else if (keyName) {
        // store other columns under their cleaned key
        const safeKey = String(keyName).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
        out[safeKey] = String(value || '').trim();
      }
    }

    // ensure at least one of the main fields exists
    if (TARGET_FIELDS.some(f => out[f] !== undefined && out[f] !== '')) {
      normalized.push(out);
    }
  }

  const base = path.basename(filePath, path.extname(filePath));
  const collectionName = String(base || 'sheet').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

  // Replace collection
  const exists = (await db.listCollections({ name: collectionName }).toArray()).length > 0;
  if (exists) await db.collection(collectionName).drop();
  if (normalized.length === 0) {
    await db.createCollection(collectionName);
    console.log('Created empty collection', collectionName);
  } else {
    const res = await db.collection(collectionName).insertMany(normalized);
    console.log(`Inserted ${res.insertedCount} documents into ${collectionName}`);
  }
}

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.argv[2];
  const dbName = process.env.DB_NAME || process.env.DB || process.argv[3] || 'sample';
  if (!uri) { console.error('Missing MONGODB_URI'); process.exit(1); }

  const sampleDir = path.resolve(__dirname, '..', 'sample data');
  if (!fs.existsSync(sampleDir)) { console.error('sample data folder missing'); process.exit(1); }

  const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });
  try {
    await client.connect();
    const db = client.db(dbName);
    const files = fs.readdirSync(sampleDir).filter(f => /\.xlsx?$|\.csv$/i.test(f));
    for (const f of files) {
      try {
        await processFile(db, path.join(sampleDir, f));
      } catch (err) {
        console.error('Failed processing', f, err.message || err);
      }
    }
    console.log('Re-import complete');
  } finally {
    await client.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
