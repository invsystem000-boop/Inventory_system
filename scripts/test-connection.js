const { MongoClient } = require('mongodb');

const uri = process.env.MONGO_URI;
if(!uri){
  console.error('Usage: set MONGO_URI=<uri> && node scripts/test-connection.js');
  process.exit(1);
}

(async ()=>{
  const client = new MongoClient(uri, { connectTimeoutMS: 5000 });
  try{
    await client.connect();
    const admin = client.db().admin();
    const dbs = await admin.listDatabases();
    console.log('Connected. Databases:');
    dbs.databases.forEach(d=> console.log('-', d.name));
  }catch(err){
    console.error('Connection failed:', err.message || err);
    process.exitCode = 1;
  }finally{
    try{ await client.close(); }catch(e){}
  }
})();
