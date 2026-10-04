
const DigestFetch = require('digest-fetch');
const fetch = require('node-fetch');

// This script creates a MongoDB Atlas cluster using the Atlas Admin API.
// Required environment variables:
// - ATLAS_PUBLIC_KEY
// - ATLAS_PRIVATE_KEY
// - ATLAS_PROJECT_ID
// - ATLAS_CLUSTER_NAME (optional, default: sample-cluster)

const publicKey = process.env.ATLAS_PUBLIC_KEY;
const privateKey = process.env.ATLAS_PRIVATE_KEY;
const projectId = process.env.ATLAS_PROJECT_ID;
const clusterName = process.env.ATLAS_CLUSTER_NAME || 'sample-cluster';

if(!publicKey || !privateKey || !projectId){
  console.error('Missing required env vars. Set ATLAS_PUBLIC_KEY, ATLAS_PRIVATE_KEY, ATLAS_PROJECT_ID.');
  process.exit(1);
}

async function createCluster(){
  const url = `https://cloud.mongodb.com/api/atlas/v1.0/groups/${projectId}/clusters`;

  // Minimal M0-compatible config; adjust as needed for your project and provider
  const body = {
    name: clusterName,
    providerSettings: {
      providerName: 'AWS',
      instanceSizeName: 'M0',
      regionName: 'US_EAST_1'
    },
    backupEnabled: false
  };

  try{
    // Atlas requires HTTP Digest authentication. Use digest-fetch to attach the digest auth header.
    const client = new DigestFetch(publicKey, privateKey);
    const res = await client.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if(!res.ok){
      const txt = await res.text();
      console.error('Atlas API error:', res.status, txt);
      process.exit(1);
    }

    const data = await res.json();
    console.log('Cluster creation request sent. Response:');
    console.log(data);
  }catch(err){
    console.error('Request error:', err.message || err);
    process.exit(1);
  }
}

createCluster();
