#!/usr/bin/env node
/**
 * Lightweight MCP Server for the Azure Onboarding Knowledge Base
 * 
 * This is a simple stdio-based MCP server (compatible with many LLM clients).
 * It calls your deployed /api/kb endpoints.
 * 
 * Run locally: node mcp-onboarding-kb.js
 * 
 * Configure your MCP client (e.g. in Claude Desktop, Cursor, or custom Grok setup)
 * to use this script as an MCP server.
 * 
 * Required env (or hardcode):
 *   SWA_BASE_URL=https://your-site.azurestaticapps.net
 * 
 * For authenticated calls in a real MCP setup, you'd handle tokens.
 * For personal use, you can run it after logging into the SWA or use a dev token.
 */

const https = require('https');

const BASE_URL = process.env.SWA_BASE_URL || 'https://wonderful-tree-0b2afd30f.7.azurestaticapps.net';

function callApi(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
        // In production you'd forward the user's auth token here
      }
    };

    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ raw: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// MCP Tool definitions
const tools = [
  {
    name: "search_onboarding_kb",
    description: "Search the 90-day onboarding knowledge base for topics, discovery questions, or ideas.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search term e.g. 'networking private endpoints' or 'week 5'" }
      },
      required: ["query"]
    }
  },
  {
    name: "get_week_kb",
    description: "Get full details for a specific week: topic, discovery questions (with any saved user answers), checklist summary, and beneficial ideas.",
    inputSchema: {
      type: "object",
      properties: {
        week: { type: "number", description: "Week number 1-12" }
      },
      required: ["week"]
    }
  },
  {
    name: "save_discovery_answer",
    description: "Save or update your answer to a specific discovery question.",
    inputSchema: {
      type: "object",
      properties: {
        week: { type: "number" },
        questionId: { type: "string", description: "The id of the question e.g. 'vnet-list'" },
        answer: { type: "string" }
      },
      required: ["week", "questionId", "answer"]
    }
  }
];

// Very simple MCP stdio handler (for demo; real SDKs handle protocol better)
process.stdin.on('data', async (data) => {
  try {
    const msg = JSON.parse(data.toString().trim());
    if (msg.method === 'tools/list') {
      console.log(JSON.stringify({ tools }));
    } else if (msg.method === 'tools/call') {
      const { name, arguments: args } = msg.params;
      let result;
      if (name === 'search_onboarding_kb') {
        result = await callApi(`/api/kb?search=${encodeURIComponent(args.query)}`);
      } else if (name === 'get_week_kb') {
        result = await callApi(`/api/kb?week=${args.week}`);
      } else if (name === 'save_discovery_answer') {
        result = await callApi('/api/kb', 'POST', args);
      }
      console.log(JSON.stringify({ result }));
    }
  } catch (e) {
    console.error(e);
  }
});

console.error('MCP Onboarding KB server running. Connect your LLM client to this script.');