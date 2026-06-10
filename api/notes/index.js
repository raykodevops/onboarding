const { BlobServiceClient } = require('@azure/storage-blob');

const connectionString = process.env.NOTES_STORAGE_CONNECTION_STRING || process.env.AzureWebJobsStorage;
const containerName = process.env.NOTES_CONTAINER || 'onboarding-notes';

function parseClientPrincipal(req) {
  const header = req.headers['x-ms-client-principal'];
  if (!header) return null;
  try {
    return JSON.parse(Buffer.from(header, 'base64').toString('ascii'));
  } catch {
    return null;
  }
}

async function getBlobClient(userId) {
  if (!connectionString) {
    throw new Error('Storage connection string is not configured. Set NOTES_STORAGE_CONNECTION_STRING or AzureWebJobsStorage.');
  }
  const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
  const containerClient = blobServiceClient.getContainerClient(containerName);
  await containerClient.createIfNotExists({ access: 'container' });
  return containerClient.getBlockBlobClient(`${userId}.json`);
}

module.exports = async function (context, req) {
  const principal = parseClientPrincipal(req);
  if (!principal || !principal.userId) {
    context.res = {
      status: 401,
      body: { error: 'Not authenticated. Please sign in through Azure Static Web Apps.' },
    };
    return;
  }

  const blobClient = await getBlobClient(principal.userId);

  if (req.method === 'GET') {
    try {
      const downloadResponse = await blobClient.download(0);
      const downloaded = await streamToString(downloadResponse.readableStreamBody);
      const data = JSON.parse(downloaded || '{}');
      context.res = {
        status: 200,
        body: { notes: data.notes || [] },
      };
    } catch (err) {
      if (err.statusCode === 404) {
        context.res = { status: 200, body: { notes: [] } };
      } else {
        context.log.error(err);
        context.res = { status: 500, body: { error: 'Unable to read notes from storage.' } };
      }
    }
    return;
  }

  if (req.method === 'POST') {
    const notes = req.body && req.body.notes;
    if (!Array.isArray(notes)) {
      context.res = { status: 400, body: { error: 'Request body must include notes array.' } };
      return;
    }
    try {
      const content = JSON.stringify({ updatedAt: new Date().toISOString(), notes });
      await blobClient.upload(content, Buffer.byteLength(content));
      context.res = { status: 200, body: { success: true } };
    } catch (err) {
      context.log.error(err);
      context.res = { status: 500, body: { error: 'Unable to write notes to storage.' } };
    }
    return;
  }

  context.res = {
    status: 405,
    headers: { Allow: 'GET, POST' },
    body: { error: 'Method not allowed' },
  };
};

async function streamToString(readableStream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    readableStream.on('data', (data) => {
      chunks.push(data.toString());
    });
    readableStream.on('end', () => {
      resolve(chunks.join(''));
    });
    readableStream.on('error', reject);
  });
}
