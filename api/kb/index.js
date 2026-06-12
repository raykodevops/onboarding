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
// Kept in code for now to stay 100% free (no extra DBs). 
// In future you could move this to a blob or Cosmos free tier.
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
        "Document your laptop setup steps for future reference",
        "Ask for a 'buddy' or mentor if not already assigned"
      ]
    },
    {
      week: 2,
      title: "Company Fundamentals",
      topic: "Company & Role Fundamentals",
      discovery: [
        { id: "mission-values", q: "What is the company mission, values, and current strategic priorities?" },
        { id: "org-structure", q: "Draw or list the org chart for your team and key stakeholders (who reports to whom)?" },
        { id: "azure-usage", q: "At a high level, how does the company use Azure today (workloads, regions, critical apps)?" },
        { id: "compliance", q: "What compliance frameworks apply (SOC2, ISO, industry specific)? Where is evidence stored?" }
      ],
      ideas: [
        "Read the latest company news and investor updates",
        "Request a 30-min 1:1 with your manager specifically on 'how success is measured here'",
        "Identify 3-4 key stakeholders outside your immediate team",
        "Review any existing Azure governance / tagging policies"
      ]
    },
    {
      week: 3,
      title: "Azure Environment Discovery",
      topic: "Azure Environment Discovery",
      discovery: [
        { id: "subscriptions", q: "List all subscriptions + their purposes, owners, and billing contacts." },
        { id: "resource-groups", q: "What are the main resource groups? Any naming conventions or ownership?" },
        { id: "architecture", q: "Can you draw a high-level current-state architecture (even rough)?" },
        { id: "naming-conventions", q: "What are the current naming conventions for resources, RGs, VNets?" },
        { id: "cost-baseline", q: "What does the current monthly spend look like and who owns the budget?" }
      ],
      ideas: [
        "Run: az account list, az group list, az resource list",
        "Use Azure Resource Graph Explorer for cross-subscription queries",
        "Export a subscription summary and save it to your inventory doc",
        "Ask: 'What are the most critical production workloads right now?'"
      ]
    },
    {
      week: 4,
      title: "Deep-Dive Planning & First Tasks",
      topic: "Planning & 30-Day Review",
      discovery: [
        { id: "critical-systems", q: "List the top 5-7 most critical systems/applications and who depends on them." },
        { id: "recent-issues", q: "What recent incidents or concerns have the team dealt with?" },
        { id: "runbooks", q: "Where are existing runbooks and documentation stored? How up-to-date are they?" },
        { id: "metrics", q: "What metrics or reports does leadership actually care about?" }
      ],
      ideas: [
        "Create your own 'Azure Inventory' document (spreadsheet or wiki)",
        "Start a running 'Questions for Manager' doc",
        "Identify 1-2 areas that feel unclear and document why",
        "Prepare for your 30-day check-in with specific examples of what you've learned"
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
    {
      week: 6,
      title: "Deep Dive - Compute & Storage",
      topic: "Compute & Storage",
      discovery: [
        { id: "vm-inventory", q: "List all VMs (or other compute), their OS, size, purpose, and backup status." },
        { id: "storage-accounts", q: "What storage accounts exist? What data do they hold and what access patterns?" },
        { id: "backup-dr", q: "What are the backup strategies and RPO/RTO targets? When was the last DR test?" },
        { id: "databases", q: "Which database services are in use (SQL, Cosmos, PostgreSQL, etc.) and who owns them?" },
        { id: "scaling", q: "How is auto-scaling or performance handled for key workloads?" }
      ],
      ideas: [
        "Run: az vm list, az storage account list, az sql server list, etc.",
        "Document backup schedules and last successful restore test dates",
        "Ask: 'What would happen if we lost a region tomorrow — how would we recover?'",
        "Look at any large or unusual storage accounts (potential cost or data issues)"
      ]
    },
    {
      week: 7,
      title: "Deep Dive - Security & Compliance",
      topic: "Security & Compliance",
      discovery: [
        { id: "rbac", q: "What are the key RBAC assignments? Any privileged roles or PIM usage?" },
        { id: "keyvaults", q: "Where are secrets, keys, and certificates stored? Rotation policy?" },
        { id: "policies", q: "What Azure Policy initiatives are assigned? Any custom policies?" },
        { id: "defender", q: "What is the current Microsoft Defender for Cloud posture and critical recommendations?" },
        { id: "audit-logs", q: "Where do security logs and audit events go? Who reviews them?" },
        { id: "compliance", q: "What evidence is required for current compliance frameworks and where is it stored?" }
      ],
      ideas: [
        "Review PIM eligible roles and break-glass accounts",
        "List all Key Vaults and their access policies",
        "Ask Security team: 'What keeps you up at night regarding Azure?'",
        "Check for any custom RBAC roles and why they exist"
      ]
    },
    {
      week: 8,
      title: "Integration & Planning",
      topic: "Integration & 60-Day Planning",
      discovery: [
        { id: "current-state", q: "Can you produce a concise 'Current State' architecture summary?" },
        { id: "gaps-risks", q: "What gaps or risks have you identified so far? Prioritize them." },
        { id: "improvements", q: "What are the top 3-5 improvement opportunities (low risk, high value)?" },
        { id: "automation", q: "What IaC / pipeline tooling is in use (Bicep, Terraform, Azure DevOps, GitHub)?" }
      ],
      ideas: [
        "Produce your first architecture diagram and get feedback from the team",
        "Create a prioritized 'Opportunities' list with rough effort and risk",
        "Shadow at least one real change or incident window",
        "Begin drafting your 60-day check-in summary early"
      ]
    },
    {
      week: 9,
      title: "First Improvement Project",
      topic: "First Improvement Project",
      discovery: [
        { id: "project-scope", q: "What is the exact scope of your first improvement? What is success?" },
        { id: "dependencies", q: "Who else needs to be involved or informed?" },
        { id: "rollback", q: "What is the rollback plan and how will you test it?" }
      ],
      ideas: [
        "Document the 'before' state with metrics/screenshots",
        "Create a simple runbook for the change itself",
        "Practice the change in a non-prod environment first if possible",
        "Schedule a short post-implementation review with your manager"
      ]
    },
    {
      week: 10,
      title: "Second Improvement Project + Mentoring",
      topic: "Second Project & Knowledge Sharing",
      discovery: [
        { id: "lessons-learned", q: "What went well / poorly on the first project? How will you apply it?" },
        { id: "team-knowledge", q: "What knowledge is only in one person's head that should be documented?" }
      ],
      ideas: [
        "Start contributing to team runbooks or wiki",
        "Offer to review someone else's work or document a process",
        "Begin thinking about a short 'how we do X' training for the team"
      ]
    },
    {
      week: 11,
      title: "Advanced Topics & Knowledge Transfer",
      topic: "Advanced Topics & Knowledge Transfer",
      discovery: [
        { id: "advanced-topics", q: "What advanced or custom Azure topics are relevant but not yet covered?" },
        { id: "training-material", q: "What training or documentation would have helped you most in the first 60 days?" }
      ],
      ideas: [
        "Prepare and deliver a short (15-30 min) knowledge share session",
        "Update or create at least one runbook that others can follow",
        "Collect feedback on what the team wishes was better documented"
      ]
    },
    {
      week: 12,
      title: "90-Day Review & Future Planning",
      topic: "90-Day Review & Future Planning",
      discovery: [
        { id: "accomplishments", q: "What are you most proud of from the last 90 days?" },
        { id: "gaps", q: "What do you still want to learn or improve in the next 90 days?" },
        { id: "feedback", q: "What feedback have you received (formal or informal)?" }
      ],
      ideas: [
        "Prepare a concise 90-day retrospective (wins, challenges, recommendations)",
        "Draft your personal development plan and 6-month roadmap",
        "Celebrate — you have come a long way in 90 days"
      ]
    }
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