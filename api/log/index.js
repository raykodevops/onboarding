const { BlobServiceClient } = require('@azure/storage-blob');

const connectionString = process.env.NOTES_STORAGE_CONNECTION_STRING || process.env.AzureWebJobsStorage;
const containerName = process.env.NOTES_CONTAINER || 'onboarding-notes';
const LOG_BLOB_NAME = 'auth-logs.jsonl';

function parseClientPrincipal(req) {
  const header = req.headers['x-ms-client-principal'];
  if (!header) return null;
  try {
    return JSON.parse(Buffer.from(header, 'base64').toString('ascii'));
  } catch {
    return null;
  }
}

async function getLogBlobClient() {
  if (!connectionString) {
    throw new Error('Storage connection string is not configured.');
  }
  const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
  const containerClient = blobServiceClient.getContainerClient(containerName);
  await containerClient.createIfNotExists({ access: 'container' });
  return containerClient.getBlockBlobClient(LOG_BLOB_NAME);
}

async function appendLog(entry) {
  const blobClient = await getLogBlobClient();
  const line = JSON.stringify(entry) + '\n';

  try {
    // Simple append by downloading + reuploading (fine for low volume)
    let existing = '';
    try {
      const downloadResponse = await blobClient.download(0);
      existing = await streamToString(downloadResponse.readableStreamBody);
    } catch (e) {
      if (e.statusCode !== 404) throw e;
    }

    const newContent = existing + line;
    await blobClient.upload(newContent, Buffer.byteLength(newContent), {
      overwrite: true
    });
  } catch (err) {
    console.error('Failed to append auth log', err);
  }
}

async function streamToString(readableStream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    readableStream.on('data', (data) => chunks.push(data.toString()));
    readableStream.on('end', () => resolve(chunks.join('')));
    readableStream.on('error', reject);
  });
}

module.exports = async function (context, req) {
  const principal = parseClientPrincipal(req);

  if (!principal || !principal.userId) {
    context.res = { status: 401, body: { error: 'Not authenticated.' } };
    return;
  }

  if (req.method === 'POST') {
    const { action, details } = req.body || {};
    if (!action) {
      context.res = { status: 400, body: { error: 'action is required' } };
      return;
    }

    const logEntry = {
      timestamp: new Date().toISOString(),
      action: action, // 'login' | 'logout'
      userId: principal.userId,
      userDetails: principal.userDetails || null,
      tenantId: principal.tid || principal.tenantId || null,
      ip: req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
      details: details || {}
    };

    await appendLog(logEntry);

    context.res = { status: 200, body: { success: true } };
    return;
  }

  context.res = { status: 405, body: { error: 'Method not allowed. Use POST.' } };
};
