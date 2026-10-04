const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const { MongoClient } = require('mongodb');

const DIR = path.join(__dirname, '..', 'sample data');
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'sample_data_db';

function sanitizeName(name){
  return name
    .replace(/\.xlsx?$/i, '')
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/__+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase();
}

async function run(){
  if(!fs.existsSync(DIR)){
    console.error('Sample data folder not found:', DIR);
    process.exit(1);
  }

  const files = fs.readdirSync(DIR).filter(f=>f.toLowerCase().endsWith('.xlsx'));
  if(files.length===0){
    console.log('No .xlsx files found in', DIR);
    return;
  }

    let client;
    let memoryServer;
    let usedUri = MONGO_URI;
    try{
      client = new MongoClient(MONGO_URI);
      await client.connect();
      const db = client.db(DB_NAME);
      console.log('Connected to', MONGO_URI, 'database:', DB_NAME);

    for(const file of files){
      const filePath = path.join(DIR, file);
      const workbook = xlsx.readFile(filePath);
      // Use first sheet
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const data = xlsx.utils.sheet_to_json(sheet, {defval: ''});

      const collName = sanitizeName(file);
      if(data.length===0){
        console.log(`Skipping ${file} — no rows found.`);
        continue;
      }

      // Replace dots in keys (xlsx may produce keys with dots) — MongoDB doesn't allow dot in field names
      const cleanData = data.map(row => {
        const out = {};
        for(const k of Object.keys(row)){
          const cleanKey = k.replace(/\./g, '_');
          out[cleanKey] = row[k];
        }
        return out;
      });

      const coll = db.collection(collName);
      // Optional: replace existing collection
      await coll.deleteMany({});
      const res = await coll.insertMany(cleanData);
      console.log(`Imported ${res.insertedCount} rows into collection: ${collName}`);
    }

    console.log('Import complete.');
  }catch(err){
    // If connection failed, fall back to in-memory MongoDB so user doesn't need to install mongod.
    console.warn('Initial connection failed:', err.message || err);
    console.log('Starting in-memory MongoDB server (fallback)...');
    try{
      const { MongoMemoryServer } = require('mongodb-memory-server');
      memoryServer = await MongoMemoryServer.create();
      usedUri = memoryServer.getUri();
      client = new MongoClient(usedUri);
      await client.connect();
      const db = client.db(DB_NAME);
      console.log('Connected to in-memory MongoDB at', usedUri, 'database:', DB_NAME);

      // If the user wants to keep the in-memory server running so MongoDB Compass can connect,
      // set environment variable KEEP_MEMORY=true before running the importer. The script will
      // print the connection URI and wait for Enter to exit.
      const keepMemory = process.env.KEEP_MEMORY === 'true';

      for(const file of files){
        const filePath = path.join(DIR, file);
        const workbook = xlsx.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(sheet, {defval: ''});

        const collName = sanitizeName(file);
        if(data.length===0){
          console.log(`Skipping ${file} — no rows found.`);
          continue;
        }

        const cleanData = data.map(row => {
          const out = {};
          for(const k of Object.keys(row)){
            const cleanKey = k.replace(/\./g, '_');
            out[cleanKey] = row[k];
          }
          return out;
        });

        const coll = db.collection(collName);
        await coll.deleteMany({});
        const res = await coll.insertMany(cleanData);
        console.log(`Imported ${res.insertedCount} rows into collection: ${collName}`);
      }

      console.log('Import complete (in-memory). Note: in-memory DB will be lost when the process exits.');
      if(keepMemory){
        console.log('\n=== In-memory MongoDB is running ===');
        console.log('Connection URI (use this in MongoDB Compass):', usedUri);
        console.log('Press Enter in this terminal to stop the in-memory server and exit.');
        await new Promise(resolve=>{
          process.stdin.resume();
          process.stdin.once('data', ()=>{
            process.stdin.pause();
            resolve();
          });
        });
        console.log('Stopping in-memory server...');
      }
    }catch(innerErr){
      console.error('Fallback import failed:', innerErr);
    }finally{
      try{ if(client) await client.close(); }catch(e){}
      if(memoryServer) await memoryServer.stop();
    }
    return;
  }finally{
    try{ if(client) await client.close(); }catch(e){}
  }
}

run();
