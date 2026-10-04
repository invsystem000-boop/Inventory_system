const { MongoClient } = require('mongodb');

async function main() {
  const uri = process.env.MONGODB_URI || process.argv[2];
  const dbName = process.env.DB_NAME || process.argv[3] || 'sample';

  if (!uri) {
    console.error('Usage: set MONGODB_URI or pass it as first arg');
    process.exit(1);
  }

  const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });
  try {
    await client.connect();
    const db = client.db(dbName);

    const collections = [
      'sample_format.files',
      'sample_format.chunks',
      'sampledata.files',
      'sampledata.chunks',
      'upload'
    ];

    for (const name of collections) {
      const exists = (await db.listCollections({ name }).toArray()).length > 0;
      if (!exists) {
        await db.createCollection(name);
        console.log('Created collection', name);
      } else {
        console.log('Already exists:', name);
      }
    }

    // Create GridFS-style index on chunks: { files_id: 1, n: 1 }
    try {
      await db.collection('sample_format.chunks').createIndex({ files_id: 1, n: 1 }, { unique: true });
      await db.collection('sampledata.chunks').createIndex({ files_id: 1, n: 1 }, { unique: true });
      console.log('Created GridFS chunk indexes');
    } catch (err) {
      console.warn('Could not create indexes (maybe they already exist):', err.message);
    }

    console.log(`Done — collections ready in database: ${dbName}`);
  } finally {
    await client.close();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
