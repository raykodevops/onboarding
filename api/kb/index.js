const { BlobServiceClient } = require('@azure/storage-blob');

const connectionString = process.env.NOTES_STORAGE_CONNECTION_STRING || process.env.AzureWebJobsStorage;
const containerName = process.env.NOTES_CONTAINER || 'onboarding-notes';

// Same auth helper as notes
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
    throw new Error('Storage connection string is not configured.');
  }
  const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
  const containerClient = blobServiceClient.getContainerClient(containerName);
  await containerClient.createIfNotExists({ access: 'container' });
  return containerClient.getBlockBlobClient(`${userId}.json`);
}

// Structured Knowledge Base definition (source of truth for global onboarding content)
// This can later be moved to its own blob or Cosmos DB for easier editing/versioning.
const KNOWLEDGE_BASE = {
  weeks: [
    {
      week: 1,
      title: "Welcome & Systems Setup",
      topic: "Onboarding & Systems Setup",
      discovery: [
        { id: "hr-contacts", q: "Who are the key HR, IT, and manager contacts? What are their preferred communication methods?" },
        { id: "accounts-list", q: "List every account, portal, and MFA method you now have. Any missing access?" },
        { id: "emergency-procedures", q: "What are the company emergency procedures and who to contact in an incident?" },
        { id: "vpn-azure-access", q: "Is VPN + Azure access fully working? Any delays or issues during setup?" }
      ],
      ideas: [
        "Bookmark all important portals (Azure, Entra, DevOps, etc.)",
        "Set up a personal 'Onboarding Notes' folder or OneNote section immediately",
        "Join all relevant Teams channels and distribution lists",
        "Document your laptop setup steps for future reference"
      ]
    },
    {
      week: 5,
      title: "Deep Dive - Networking",
      topic: "Networking",
      discovery: [
        { id: "vnet-list", q: "List all VNets, their address spaces, regions, and primary purpose (prod, dev, shared, etc.)." },
        { id: "nsg-firewall", q: "What are the key NSG / Azure Firewall / third-party firewall rules and their business justification?" },
        { id: "connectivity", q: "Describe hybrid connectivity (VPN, ExpressRoute, SD-WAN). Any single points of failure?" },
        { id: "dns-routing", q: "How is DNS handled? Any custom resolvers, split-brain, or on-prem integration?" },
        { id: "private-link", q: "Which services use Private Endpoints / Private Link? List them and their purpose." },
        { id: "topology", q: "What is the overall topology (hub-spoke, mesh, Virtual WAN)? Any plans to change it?" },
        { id: "ownership", q: "Who owns each major network component and who approves changes?" }
      ],
      ideas: [
        "Run these: az network vnet list -o table && az network vnet peering list",
        "Export NSG rules for the top 3 VNets into your inventory",
        "Create (even a simple) network diagram — update it as you learn",
        "Ask the network team: 'What are the top 3 network risks or debt items right now?'",
        "Check for any ExpressRoute circuits, VPN gateways, and their redundancy"
      ]
    },
    // ... (other weeks abbreviated for the function; full data lives in frontend WEEK_DATA for now)
    {
      week: 6,
      title: "Deep Dive - Compute & Storage",
      topic: "Compute & Storage",
      discovery: [
        { id: "vm-inventory", q: "List all VMs (or other compute), their OS, size, purpose, and backup status." },
        { id: "storage-accounts", q: "What storage accounts exist? What data do they hold and what access patterns?" },
        { id: "backup-dr", q: "What are the backup strategies and RPO/RTO targets? When was the last DR test?" }
      ],
      ideas: [
        "Run: az vm list, az storage account list",
        "Document backup schedules and last successful restore test dates",
        "Ask: 'What would happen if we lost a region tomorrow — how would we recover?'"
      ]
    }
    // Add more weeks as needed. In production this would come from a managed document.
  ]
};

async function getUserData(userId) {
  const blobClient = await getBlobClient(userId);
  try {
    const downloadResponse = await blobClient.download(0);
    const downloaded = await streamToString(downloadResponse.readableStreamBody);
    return JSON.parse(downloaded || '{}');
  } catch (err) {
    if (err.statusCode === 404) return {};
    throw err;
  }
}

async function saveUserData(userId, data) {
  const blobClient = await getBlobClient(userId);
  const content = JSON.stringify({ ...data, updatedAt: new Date().toISOString() });
  await blobClient.upload(content, Buffer.byteLength(content));
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

  const userId = principal.userId;
  const userData = await getUserData(userId);

  const { method, url } = req;

  // Simple routing inside the function
  if (method === 'GET' && (req.query.week || url.includes('/week/'))) {
    const weekNum = parseInt(req.query.week || url.split('/').pop(), 10);
    const week = KNOWLEDGE_BASE.weeks.find(w => w.week === weekNum) || null;

    // Merge any user answers for this week
    const kbAnswers = userData.kbAnswers || {};
    if (week) {
      week.discovery = week.discovery.map(d => ({
        ...d,
        answer: kbAnswers[`week${weekNum}-${d.id}`] || ''
      }));
    }

    context.res = { status: 200, body: { week } };
    return;
  }

  if (method === 'GET' && req.query.search) {
    const q = (req.query.search || '').toLowerCase();
    const results = KNOWLEDGE_BASE.weeks.filter(w =>
      w.topic.toLowerCase().includes(q) ||
      w.discovery.some(d => d.q.toLowerCase().includes(q)) ||
      w.ideas.some(i => i.toLowerCase().includes(q))
    );
    context.res = { status: 200, body: { results } };
    return;
  }

  if (method === 'GET') {
    // Return full KB (lightweight)
    const kb = JSON.parse(JSON.stringify(KNOWLEDGE_BASE)); // deep clone

    // Attach user's answers
    const kbAnswers = userData.kbAnswers || {};
    kb.weeks.forEach(w => {
      w.discovery = w.discovery.map(d => ({
        ...d,
        answer: kbAnswers[`week${w.week}-${d.id}`] || ''
      }));
    });

    context.res = { status: 200, body: kb };
    return;
  }

  if (method === 'POST' && req.body && req.body.week && req.body.questionId && req.body.answer !== undefined) {
    const { week, questionId, answer } = req.body;
    const key = `week${week}-${questionId}`;

    userData.kbAnswers = userData.kbAnswers || {};
    userData.kbAnswers[key] = answer;

    try {
      await saveUserData(userId, userData);
      context.res = { status: 200, body: { success: true } };
    } catch (err) {
      context.res = { status: 500, body: { error: 'Failed to save answer.' } };
    }
    return;
  }

  context.res = { status: 404, body: { error: 'Not found. Use /api/kb, /api/kb?search=..., or POST answer.' } };
};