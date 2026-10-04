const express = require('express');
const cors = require('cors');
const multer = require('multer');
const XLSX = require('xlsx');
const { MongoClient, ObjectId, GridFSBucket } = require('mongodb');
const { hashPassword, verifyPassword, stripSensitiveFields, normalizeVerifiedStatus } = require('./auth-utils');

const app = express();
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'null'
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error('CORS policy violation'));
  },
  credentials: true
}));
app.use(express.json());
const path = require('path');
const { DEFAULT_PORTS, getPortCandidates } = require('./port-config');
const upload = multer({ storage: multer.memoryStorage() });

// Load environment variables from .env when present
require('dotenv').config();

// Serve the frontend (index.html, app.js, styles.css, etc.) from the project root
// Do not auto-serve `index.html` for the root so we can control the landing page.
app.use(express.static(path.join(__dirname, '/'), { index: false }));

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || process.env.DB || 'sample';
const AUTH_DB_NAME = process.env.AUTH_DB_NAME || process.env.AUTH_DB || 'accounts';
const ORDER_DB_NAME = process.env.RECORD_DB_NAME || process.env.RECORD_DB || DB_NAME;
const DEFAULT_COLLECTION_SET = {
  sample: { orders: ['orders_history', 'order_history'], recordin: ['recordin', 'recording', 'records'] },
  sample2: { orders: ['orders_history2'], recordin: ['recordin2'] },
  sample3: { orders: ['orders_history3'], recordin: ['orderin3'] }
};

function getCollectionCandidatesForDatabase(databaseName) {
  const value = String(databaseName || '').trim().toLowerCase();
  if (DEFAULT_COLLECTION_SET[value]) {
    return DEFAULT_COLLECTION_SET[value];
  }

  if (value.endsWith('2')) {
    return { orders: ['orders_history2'], recordin: ['recordin2'] };
  }

  if (value.endsWith('3')) {
    return { orders: ['orders_history3'], recordin: ['orderin3'] };
  }

  return DEFAULT_COLLECTION_SET.sample;
}

const ORDER_COLLECTION_CANDIDATES = getCollectionCandidatesForDatabase(DB_NAME).orders;
const ORDER_COLLECTION_NAME = ORDER_COLLECTION_CANDIDATES[0];
const RECORDING_COLLECTION_CANDIDATES = getCollectionCandidatesForDatabase(DB_NAME).recordin;
const RECORDING_COLLECTION_NAME = RECORDING_COLLECTION_CANDIDATES[0];
const envPort = process.env.PORT ? Number(process.env.PORT) : null;

let dbClient;
let db;
let gridFS;

function sanitizeDatabaseName(name) {
  const value = String(name || '').trim();
  if (!value) return '';
  return value.replace(/[^a-zA-Z0-9_\-]/g, '');
}

async function connect(databaseName = DB_NAME){
  dbClient = new MongoClient(MONGO_URI);
  await dbClient.connect();
  db = dbClient.db(databaseName);
  gridFS = new GridFSBucket(db, { bucketName: 'sample_format' });
  console.log('Server connected to', MONGO_URI, 'db:', databaseName);
}

async function ensureDatabaseForRequest(req) {
  if (!dbClient) {
    await connect();
  }

  const requestedName = sanitizeDatabaseName(req.query.db || req.headers['x-database-name'] || req.headers['x-db-name'] || DB_NAME);
  const targetDbName = requestedName || DB_NAME;

  if (!db || db.databaseName !== targetDbName) {
    db = dbClient.db(targetDbName);
    gridFS = new GridFSBucket(db, { bucketName: 'sample_format' });
    console.log('Switched server database to', targetDbName);
  }

  return db;
}

app.get('/api/collections', async (req, res) => {
  try{
    const targetDb = await ensureDatabaseForRequest(req);
    const cols = await targetDb.listCollections().toArray();
    res.json(cols.map(c => c.name));
  }catch(err){
    console.error('Error listing collections:', err);
    res.status(500).json({error: String(err)});
  }
});

app.post('/api/collections', async (req, res) => {
  try {
    const targetDb = await ensureDatabaseForRequest(req);

    const { name } = req.body || {};
    if (name) {
      const collectionName = String(name || '').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
      if (!collectionName) {
        return res.status(400).json({ error: 'Collection name is required' });
      }

      const exists = await targetDb.listCollections({ name: collectionName }).hasNext();
      if (exists) {
        return res.status(409).json({ error: 'Collection already exists' });
      }

      await targetDb.createCollection(collectionName);
      return res.status(201).json({ name: collectionName });
    }

    return res.status(400).json({ error: 'Collection name is required' });
  } catch (err) {
    console.error('Error creating collection', err);
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/collections/:name', async (req, res) => {
  try {
    const collectionName = req.params.name;
    if (!collectionName) {
      return res.status(400).json({ error: 'Collection name is required' });
    }

    const isAuthCollection = ['account', 'accounts'].includes(String(collectionName).toLowerCase());
    const targetDb = isAuthCollection
      ? dbClient.db(AUTH_DB_NAME)
      : await ensureDatabaseForRequest(req);

    const payload = req.body || {};
    const sanitizedPayload = {
      ...payload,
      role: String(payload.role || 'user').toLowerCase()
    };

    if (typeof sanitizedPayload.password === 'string' && sanitizedPayload.password.trim() !== '') {
      sanitizedPayload.password = await hashPassword(sanitizedPayload.password);
    }

    const result = await targetDb.collection(collectionName).insertOne(sanitizedPayload);
    res.status(201).json({ insertedId: result.insertedId, db: targetDb.databaseName, collection: collectionName, role: sanitizedPayload.role });
  } catch (err) {
    console.error('Error creating row in collection', req.params.name, err);
    res.status(500).json({ error: String(err) });
  }
});

function normalizeKey(key) {
  return String(key || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function isReceiptHeaderRow(row) {
  if (!row || typeof row !== 'object') return false;
  const joined = Object.values(row)
    .map(v => String(v || '').trim().toLowerCase())
    .join(' ');

  return [
    'model', 'brand / made', 'brand made', 'part number', 'description', 'msl / date set',
    'maximum stock', 'minimum stock', 'total'
  ].some(label => joined.includes(label));
}

function normalizeReceiptRow(row) {
  if (!row || typeof row !== 'object') return null;

  const map = {};
  for (const [key, value] of Object.entries(row)) {
    map[normalizeKey(key)] = value;
  }

  const pick = (...candidates) => {
    for (const candidate of candidates) {
      const value = map[candidate];
      if (value !== undefined && value !== null && String(value).trim() !== '') {
        return String(value).trim();
      }
    }
    return '';
  };

  const normalized = {
    model: pick('model', 'empty', 'productname', 'product', 'name', 'itemname'),
    brand: pick('brand', 'brandmade', 'made', 'empty1'),
    made: pick('made', 'manufacturer', 'empty2'),
    partNo: pick('partno', 'partnumber', 'part', 'empty3'),
    description: pick('description', 'desc', 'empty4'),
    size: pick('size', 'dimension', 'dimensions', 'empty5'),
    price: pick('price', 'unitprice', 'cost', 'empty6'),
    stockOnHand: pick('stockonhand', 'stockinhand', 'stock', 'quantity', 'onhand', 'availablestock', 'empty7')
  };

  const hasValue = Object.values(normalized).some(v => String(v || '').trim() !== '');
  if (!hasValue) return null;

  return normalized;
}

app.post('/api/collections/:name/upload', upload.single('file'), async (req, res) => {
  try {
    const targetDb = await ensureDatabaseForRequest(req);

    const collectionName = req.params.name;
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const exists = await targetDb.listCollections({ name: collectionName }).hasNext();
    if (!exists) {
      await targetDb.createCollection(collectionName);
    }

    const targetGridFS = new GridFSBucket(targetDb, { bucketName: 'sample_format' });
    const uploadedFile = await new Promise((resolve, reject) => {
      const uploadStream = targetGridFS.openUploadStream(file.originalname || 'upload', {
        metadata: {
          originalName: file.originalname,
          mimeType: file.mimetype || 'application/octet-stream',
          uploadedAt: new Date(),
          collection: collectionName
        }
      });

      uploadStream.on('error', reject);
      uploadStream.on('finish', () => resolve(uploadStream.id));
      uploadStream.write(file.buffer);
      uploadStream.end();
    });

    const rawName = String(file.originalname || '').toLowerCase();
    const mimeType = String(file.mimetype || '').toLowerCase();
    const isSpreadsheet = /\.(xlsx|xls|csv)$/i.test(rawName) || mimeType.includes('sheet') || mimeType.includes('excel') || mimeType.includes('csv');
    const isJson = /\.(json)$/i.test(rawName) || mimeType.includes('json');

    if (isJson || isSpreadsheet) {
      try {
        let rows = [];

        if (isJson) {
          rows = JSON.parse(file.buffer.toString('utf8'));
          if (!Array.isArray(rows)) {
            rows = rows && Array.isArray(rows.rows) ? rows.rows : [rows];
          }
        } else {
          const workbook = XLSX.read(file.buffer, { type: 'array' });
          const sheetNames = workbook && workbook.SheetNames ? workbook.SheetNames : [];

          if (!sheetNames.length) {
            throw new Error('Could not find a valid worksheet in the uploaded file.');
          }

          const allRows = [];
          for (const sheetName of sheetNames) {
            const sheet = workbook.Sheets[sheetName];
            if (!sheet) continue;
            const sheetRows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false, blankrows: false });
            allRows.push(...sheetRows.map(row => ({ ...row, _sheetName: sheetName })));
          }

          rows = allRows;
        }

        const normalizedRows = rows
          .filter(row => !isReceiptHeaderRow(row))
          .map(row => {
            const normalized = normalizeReceiptRow(row);
            if (!normalized) return null;
            if (row && row._sheetName) {
              normalized.sourceSheet = row._sheetName;
            }
            return normalized;
          })
          .filter(Boolean);

        if (!normalizedRows.length) {
          return res.status(400).json({ error: 'No valid receipt rows found in the uploaded file.' });
        }

        const result = await db.collection(collectionName).insertMany(normalizedRows);
        return res.status(201).json({ inserted: result.insertedCount || normalizedRows.length, parsed: true });
      } catch (spreadsheetErr) {
        console.warn('Spreadsheet parsing failed, storing file as raw document instead:', spreadsheetErr.message || spreadsheetErr);
      }
    }

    // Non-table documents or invalid spreadsheet content: save the uploaded file as raw content in Mongo so it is still stored
    const storedDoc = {
      fileName: file.originalname,
      mimeType: file.mimetype || 'application/octet-stream',
      extension: rawName.includes('.') ? rawName.split('.').pop() : '',
      uploadedAt: new Date(),
      content: file.buffer.toString('base64'),
      size: file.size,
      type: 'document',
      gridFsId: uploadedFile
    };

    const result = await db.collection(collectionName).insertOne(storedDoc);
    return res.status(201).json({ inserted: 1, parsed: false, id: result.insertedId, fileName: file.originalname, gridFsId: uploadedFile });
  } catch (err) {
    console.error('Error uploading file to collection', req.params.name, err);
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/orders', async (req, res) => {
  try {
    const targetDb = await ensureDatabaseForRequest(req);
    const orderDb = targetDb;
    const candidates = getCollectionCandidatesForDatabase(targetDb.databaseName || DB_NAME).orders;
    const targetCollectionName = candidates.find(name => {
      return orderDb.listCollections({ name }).hasNext().then(Boolean).catch(() => false);
    }) || candidates[0] || ORDER_COLLECTION_NAME;

    const exists = await orderDb.listCollections({ name: targetCollectionName }).hasNext();
    if (!exists) {
      await orderDb.createCollection(targetCollectionName);
    }

    const payload = req.body || {};
    const recordList = Array.isArray(payload.records) ? payload.records : [payload];

    const normalizedRecords = recordList.map(record => {
      const invoiceNumberValue = record.invoiceNumber ?? record.invoiceNo ?? record.invoice ?? '';
      const rawDirection = record.direction ?? record.mode ?? '';
      const normalizedDirection = String(rawDirection || '').trim().toLowerCase();
      const finalDirection = normalizedDirection === 'restock' ? 'in' : normalizedDirection;

      return {
        clientName: record.clientName || record.customer || '',
        purchaseDate: record.purchaseDate || record.date || new Date().toISOString(),
        invoiceNumber: invoiceNumberValue,
        invoiceNo: invoiceNumberValue,
        invoice: invoiceNumberValue,
        collection: record.collection || record.item || '',
        item: record.item || record.collection || '',
        model: record.model || '',
        brand: record.brand || '',
        made: record.made || '',
        partNo: record.partNo || record.partNumber || '',
        description: record.description || '',
        price: record.price ?? '',
        unitCost: record.unitCost ?? record.price ?? '',
        stockBought: record.stockBought ?? record.stock ?? 0,
        direction: finalDirection,
        mode: finalDirection || 'out',
        savedAt: new Date(),
        schema: 'clientName,purchaseDate,invoiceNumber,invoiceNo,invoice,collection,item,model,brand,made,partNo,description,price,unitCost,stockBought,direction,mode',
        orderType: finalDirection || 'out'
      };
    });

    if (!normalizedRecords.length) {
      return res.status(400).json({ error: 'No order records were provided.' });
    }

    if (normalizedRecords.length === 1) {
      const result = await orderDb.collection(targetCollectionName).insertOne(normalizedRecords[0]);
      return res.status(201).json({ insertedId: result.insertedId, collection: targetCollectionName, database: ORDER_DB_NAME });
    }

    const result = await orderDb.collection(targetCollectionName).insertMany(normalizedRecords);
    return res.status(201).json({ insertedCount: result.insertedCount, collection: targetCollectionName, database: ORDER_DB_NAME });
  } catch (err) {
    console.error('Error creating order record', err);
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/recordin', async (req, res) => {
  try {
    const targetDb = await ensureDatabaseForRequest(req);
    const orderDb = targetDb;
    const candidates = getCollectionCandidatesForDatabase(targetDb.databaseName || DB_NAME).recordin;
    const targetCollectionName = candidates.find(name => {
      return orderDb.listCollections({ name }).hasNext().then(Boolean).catch(() => false);
    }) || candidates[0] || RECORDING_COLLECTION_NAME;

    const exists = await orderDb.listCollections({ name: targetCollectionName }).hasNext();
    if (!exists) {
      await orderDb.createCollection(targetCollectionName);
    }

    const payload = req.body || {};
    const recordList = Array.isArray(payload.records) ? payload.records : [payload];

    const normalizedRecords = recordList.map(record => {
      const unitCost = Number(record.unitCost ?? record.price ?? 0) || 0;
      const stockBought = Number(record.stockBought ?? record.stock ?? 0) || 0;
      const totalPrice = stockBought > 0 && unitCost > 0 ? unitCost * stockBought : Number(record.price ?? unitCost ?? 0) || 0;

      return {
        ...record,
        collection: record.collection || record.item || 'recordin',
        item: record.item || record.collection || 'recordin',
        price: totalPrice,
        unitCost: unitCost || record.unitCost || record.price || '',
        stockBought,
        stock: stockBought,
        direction: record.direction || 'in',
        mode: record.mode || 'in',
        savedAt: record.savedAt || new Date(),
        recordedIn: 'recordin'
      };
    });

    const result = await orderDb.collection(targetCollectionName).insertMany(normalizedRecords);
    return res.status(201).json({ insertedCount: result.insertedCount, collection: targetCollectionName, database: ORDER_DB_NAME });
  } catch (err) {
    console.error('Error saving to recordin collection:', err);
    return res.status(500).json({ error: String(err) });
  }
});

app.get('/api/recordin', async (req, res) => {
  try {
    const targetDb = await ensureDatabaseForRequest(req);
    const orderDb = targetDb;
    const candidates = getCollectionCandidatesForDatabase(targetDb.databaseName || DB_NAME).recordin;
    const targetCollectionName = candidates.find(name => {
      return orderDb.listCollections({ name }).hasNext().then(Boolean).catch(() => false);
    }) || candidates[0] || RECORDING_COLLECTION_NAME;

    const docs = await orderDb.collection(targetCollectionName).find({}).sort({ savedAt: -1, createdAt: -1 }).toArray();
    const normalized = (docs || []).map(doc => {
      const unitCost = Number(doc.unitCost ?? doc.price ?? 0) || 0;
      const stockBought = Number(doc.stockBought ?? doc.stock ?? 0) || 0;
      const explicitPrice = Number(doc.price ?? 0) || 0;
      const totalPrice = stockBought > 0 && unitCost > 0 && (explicitPrice === 0 || explicitPrice === unitCost || explicitPrice < unitCost)
        ? unitCost * stockBought
        : explicitPrice || (stockBought > 0 && unitCost > 0 ? unitCost * stockBought : 0);

      return {
        clientName: doc.clientName || doc.supplierName || '',
        purchaseDate: doc.purchaseDate || doc.createdAt || doc.savedAt || '',
        invoiceNumber: doc.invoiceNumber ?? doc.invoiceNo ?? doc.invoice ?? '',
        invoiceNo: doc.invoiceNumber ?? doc.invoiceNo ?? doc.invoice ?? '',
        invoice: doc.invoiceNumber ?? doc.invoiceNo ?? doc.invoice ?? '',
        collection: doc.collection || doc.item || targetCollectionName,
        item: doc.item || doc.collection || targetCollectionName,
        model: doc.model || '',
        brand: doc.brand || '',
        made: doc.made || '',
        partNo: doc.partNo || doc.partNumber || '',
        description: doc.description || '',
        price: totalPrice,
        unitCost: unitCost || doc.unitCost || doc.price || '',
        stockBought,
        direction: 'out',
        mode: 'recordin',
        recordedIn: 'recordin',
        savedAt: doc.savedAt || doc.createdAt || ''
      };
    });

    return res.json(normalized);
  } catch (err) {
    console.error('Error reading recordin data:', err);
    return res.json([]);
  }
});

app.get('/api/orders/history', async (req, res) => {
  try {
    const targetDb = await ensureDatabaseForRequest(req);
    const orderDb = targetDb;
    const collectionNames = getCollectionCandidatesForDatabase(targetDb.databaseName || DB_NAME).orders.filter(Boolean);
    const fetches = await Promise.all(collectionNames.map(async name => {
      try {
        return await orderDb.collection(name).find({}).sort({ savedAt: -1, createdAt: -1 }).toArray();
      } catch {
        return [];
      }
    }));

    const rawRecords = fetches.flat();

    const normalized = (rawRecords || []).flatMap(doc => {
      if (doc && (doc.clientName || doc.purchaseDate || doc.model || doc.collection)) {
        const stockBought = Number(doc.stockBought ?? doc.stock ?? 0) || 0;
        const unitCost = Number(doc.unitCost ?? doc.price ?? 0) || 0;
        const explicitPrice = Number(doc.price ?? 0) || 0;
        const totalPrice = stockBought > 0 && unitCost > 0 && (explicitPrice === 0 || explicitPrice === unitCost || explicitPrice < unitCost)
          ? unitCost * stockBought
          : explicitPrice || (stockBought > 0 && unitCost > 0 ? unitCost * stockBought : 0);

        const invoiceNumberValue = doc.invoiceNumber ?? doc.invoiceNo ?? doc.invoice ?? '';
        const directionValue = doc.direction ?? doc.mode ?? doc.orderType ?? '';
        const normalizedDirection = String(directionValue || '').trim().toLowerCase();
        const finalDirection = normalizedDirection === 'restock' ? 'in' : normalizedDirection;

        return [{
          clientName: doc.clientName || '',
          purchaseDate: doc.purchaseDate || doc.createdAt || doc.savedAt || '',
          invoiceNumber: invoiceNumberValue,
          invoiceNo: invoiceNumberValue,
          invoice: invoiceNumberValue,
          collection: doc.collection || doc.item || '',
          item: doc.item || doc.collection || '',
          model: doc.model || '',
          brand: doc.brand || '',
          made: doc.made || '',
          partNo: doc.partNo || doc.partNumber || '',
          description: doc.description || '',
          price: totalPrice,
          unitCost: unitCost || doc.unitCost || doc.price || '',
          stockBought,
          direction: finalDirection,
          mode: finalDirection || doc.orderType || ''
        }];
      }

      if (Array.isArray(doc.table) && doc.table.length) {
        return doc.table.map((row, index) => {
          const cells = Array.isArray(row) ? row : [];
          const stockBought = parseInt(cells[4] || 0, 10) || 0;
          const rawPrice = Number(cells[5] || 0) || 0;
          const totalPrice = stockBought > 0 ? rawPrice * stockBought : rawPrice;
          const invoiceNumberValue = doc.invoiceNumber ?? doc.invoiceNo ?? doc.invoice ?? '';
          return {
            clientName: doc.clientName || doc.customer || '',
            purchaseDate: doc.createdAt || doc.savedAt || '',
            invoiceNumber: invoiceNumberValue,
            invoiceNo: invoiceNumberValue,
            invoice: invoiceNumberValue,
            collection: doc.collection || '',
            item: doc.collection || '',
            model: cells[0] || '',
            brand: cells[1] || '',
            made: cells[1] || '',
            partNo: cells[2] || '',
            description: cells[3] || '',
            price: totalPrice,
            stockBought,
            direction: doc.direction || doc.mode || '',
            mode: doc.mode || doc.direction || ''
          };
        });
      }

      return [];
    });

    return res.json(normalized);
  } catch (err) {
    console.error('Error reading order history:', err);
    return res.json([]);
  }
});

// Login endpoint: checks accounts collection in the selected database
app.post('/api/login', async (req, res) => {
  try {
    const requestedDb = sanitizeDatabaseName(req.query.db || req.headers['x-database-name'] || req.headers['x-db-name'] || AUTH_DB_NAME);
    const candidateDbs = Array.from(new Set([
      requestedDb,
      AUTH_DB_NAME,
      'accounts',
      'sample',
      'sample2',
      'sample3'
    ].filter(Boolean)));
    const candidateCollections = ['account', 'accounts', 'accounts.account'];
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });

    let matchedUser = null;
    let matchedDbName = null;
    let matchedCollection = null;

    for (const dbName of candidateDbs) {
      if (!dbName) continue;

      try {
        const targetDb = dbClient ? dbClient.db(dbName) : await connect(dbName);

        for (const collectionName of candidateCollections) {
          try {
            const exists = await targetDb.listCollections({ name: collectionName }).hasNext();
            if (!exists) continue;

            const user = await targetDb.collection(collectionName).findOne({ username: String(username) });
            if (user && user.password && await verifyPassword(String(password), String(user.password))) {
              matchedUser = user;
              matchedDbName = dbName;
              matchedCollection = collectionName;
              break;
            }
          } catch (e) {
            // continue to the next collection
          }
        }

        if (matchedUser) break;
      } catch (e) {
        // continue to the next database
      }
    }

    if (!matchedUser) return res.status(401).json({ error: 'invalid credentials' });

    const safe = {
      _id: matchedUser._id,
      username: matchedUser.username,
      name: matchedUser.name,
      role: String(matchedUser.role || 'user').toLowerCase(),
      verified: normalizeVerifiedStatus(matchedUser.verified),
      db: matchedDbName,
      collection: matchedCollection
    };
    return res.json(stripSensitiveFields(safe));
  } catch (err) {
    console.error('Login error', err);
    return res.status(500).json({ error: String(err) });
  }
});

app.get('/api/accounts', async (req, res) => {
  try {
    const targetDbs = [AUTH_DB_NAME, 'sample', 'sample2', 'sample3'];
    const candidateCollections = ['account', 'accounts', 'accounts.account'];
    const seen = new Set();
    const allUsers = [];

    for (const dbName of targetDbs) {
      if (!dbName || seen.has(dbName)) continue;
      seen.add(dbName);

      let currentDb;
      try {
        currentDb = dbClient ? dbClient.db(dbName) : await connect(dbName);
      } catch (e) {
        continue;
      }

      for (const collectionName of candidateCollections) {
        try {
          const exists = await currentDb.listCollections({ name: collectionName }).hasNext();
          if (!exists) continue;

          const docs = await currentDb.collection(collectionName)
            .find({})
            .sort({ name: 1, username: 1 })
            .toArray();

          for (const user of docs) {
            const normalized = {
              _id: user._id,
              name: user.name || user.username || 'Unknown',
              username: user.username || '',
              role: String(user.role || 'staff').toLowerCase(),
              verified: normalizeVerifiedStatus(user.verified)
            };

            const duplicate = allUsers.some((entry) => String(entry.username || '').toLowerCase() === String(normalized.username || '').toLowerCase());
            if (!duplicate && normalized.username) {
              allUsers.push(normalized);
            }
          }
        } catch (e) {
          // ignore collection probe errors and continue
        }
      }
    }

    return res.json(allUsers);
  } catch (err) {
    console.error('Error fetching accounts:', err);
    return res.status(500).json({ error: String(err) });
  }
});

app.put('/api/accounts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { password, role, verified } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Account id required' });

    const targetDbs = [AUTH_DB_NAME, 'sample', 'sample2', 'sample3'];
    const candidateCollections = ['account', 'accounts', 'accounts.account'];
    let updated = false;

    for (const dbName of targetDbs) {
      if (!dbName) continue;

      try {
        const currentDb = dbClient ? dbClient.db(dbName) : await connect(dbName);

        for (const collectionName of candidateCollections) {
          try {
            const exists = await currentDb.listCollections({ name: collectionName }).hasNext();
            if (!exists) continue;

            const query = { _id: new ObjectId(String(id)) };
            const item = await currentDb.collection(collectionName).findOne(query);
            if (!item) continue;

            const update = {};
            if (typeof password === 'string' && password.trim() !== '') update.password = await hashPassword(password);
            if (role) update.role = String(role).toLowerCase();
            if (verified !== undefined) update.verified = normalizeVerifiedStatus(verified);

            if (Object.keys(update).length === 0) {
              return res.status(400).json({ error: 'No updates provided' });
            }

            const result = await currentDb.collection(collectionName).updateOne(query, { $set: update });
            updated = result.modifiedCount > 0 || result.matchedCount > 0;
            if (updated) {
              return res.json({ ok: true, updated: true, id, db: dbName, collection: collectionName });
            }
          } catch (e) {
            // continue checking other collections
          }
        }
      } catch (e) {
        // continue checking other databases
      }
    }

    if (!updated) {
      return res.status(404).json({ error: 'Account not found' });
    }
  } catch (err) {
    console.error('Error updating account:', err);
    return res.status(500).json({ error: String(err) });
  }
});

app.get('/api/collections/:name', async (req, res) => {
  try{
    const targetDb = await ensureDatabaseForRequest(req);
    const name = req.params.name;
    const limit = parseInt(req.query.limit || '1000', 10);
    const docs = await targetDb.collection(name).find({}).limit(limit).toArray();
    res.json(docs);
  }catch(err){
    console.error('Error fetching collection', req.params.name, err);
    res.status(500).json({error: String(err)});
  }
});

app.put('/api/collections/:name/:id', async (req, res) => {
  try{
    const targetDb = await ensureDatabaseForRequest(req);

    const { name, id } = req.params;
    const update = req.body || {};
    if (!update || Object.keys(update).length === 0) {
      return res.status(400).json({error: 'No update payload provided'});
    }

    const objectId = ObjectId.isValid(id) ? new ObjectId(id) : id;
    const result = await targetDb.collection(name).updateOne(
      { _id: objectId },
      { $set: update }
    );

    res.json({ updated: result.modifiedCount || 0, ok: true });
  } catch (err) {
    console.error('Error updating collection document', req.params.name, err);
    res.status(500).json({error: String(err)});
  }
});

async function startServer() {
  const portsToTry = getPortCandidates(process.env.PORT);
  for (const p of portsToTry) {
    try {
      const server = await new Promise((resolve, reject) => {
        const s = app.listen(p, () => resolve(s));
        s.on('error', reject);
      });

      try {
        await connect();
      } catch (err) {
        console.error('Could not connect to MongoDB at', MONGO_URI, err);
      }

      console.log(`API server running on http://localhost:${p}`);

      server.on('error', (err) => {
        if (err && err.code === 'EADDRINUSE') {
          console.error(`Error: Port ${p} is already in use.`);
          process.exit(1);
        } else {
          console.error('Server error:', err);
        }
      });

      return;
    } catch (err) {
      if (err && err.code === 'EADDRINUSE') {
        console.warn(`Port ${p} is in use, trying next port...`);
        continue;
      } else {
        console.error(`Failed to listen on port ${p}:`, err);
      }
    }
  }

  console.error('No available ports found from list:', DEFAULT_PORTS.join(', '));
  process.exit(1);
}

startServer();

// Fallback: serve index.html for root (in case static middleware didn't pick it up)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});
