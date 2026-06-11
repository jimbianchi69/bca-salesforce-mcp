import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import jsforce from "jsforce";
import express from "express";
import dotenv from "dotenv";

dotenv.config();

const conn = new jsforce.Connection({ loginUrl: process.env.SF_LOGIN_URL });
let isConnected = false;

async function getSalesforceConnection() {
  if (!isConnected) {
    await conn.login(
      process.env.SF_USERNAME,
      process.env.SF_PASSWORD + process.env.SF_SECURITY_TOKEN
    );
    isConnected = true;
  }
  return conn;
}

async function getSalesforceConnectionWithRetry() {
  try {
    return await getSalesforceConnection();
  } catch (err) {
    isConnected = false;
    await conn.login(
      process.env.SF_USERNAME,
      process.env.SF_PASSWORD + process.env.SF_SECURITY_TOKEN
    );
    isConnected = true;
    return conn;
  }
}

function buildServer() {
  const server = new Server(
    { name: "bca-salesforce", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "get_accounts",
        description: "Get BCA Financial Group client accounts from Salesforce",
        inputSchema: {
          type: "object",
          properties: {
            search: { type: "string" },
            limit: { type: "number" },
          },
        },
      },
      {
        name: "get_renewals",
        description: "Get upcoming client renewals from Salesforce",
        inputSchema: {
          type: "object",
          properties: {
            days_ahead: { type: "number" },
            stage: { type: "string" },
          },
        },
      },
      {
        name: "get_tasks",
        description: "Get open tasks from Salesforce",
        inputSchema: {
          type: "object",
          properties: {
            account_name: { type: "string" },
            status: { type: "string" },
            days_due: { type: "number" },
          },
        },
      },
      {
        name: "get_client_detail",
        description: "Get full detail for a specific client",
        inputSchema: {
          type: "object",
          properties: { account_name: { type: "string" } },
          required: ["account_name"],
        },
      },
      {
        name: "get_salesforce_objects",
        description: "List all custom objects in Salesforce",
        inputSchema: { type: "object", properties: {} },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const sf = await getSalesforceConnectionWithRetry();

      if (name === "get_accounts") {
        const { search, limit = 20 } = args || {};
        let q = `SELECT Id, Name, Phone, BillingCity, BillingState, Type, Industry, NumberOfEmployees, LastActivityDate FROM Account`;
        if (search) q += ` WHERE Name LIKE '%${search}%'`;
        q += ` ORDER BY LastActivityDate DESC NULLS LAST LIMIT ${limit}`;
        const r = await sf.query(q);
        return { content: [{ type: "text", text: JSON.stringify(r.records, null, 2) }] };
      }

      if (name === "get_renewals") {
        const { days_ahead = 90, stage } = args || {};
        const today = new Date().toISOString().split("T")[0];
        const future = new Date();
        future.setDate(future.getDate() + days_ahead);
        const futureStr = future.toISOString().split("T")[0];
        let q = `SELECT Id, Name, Account.Name, CloseDate, StageName, Amount, Probability, Owner.Name FROM Opportunity WHERE CloseDate >= ${today} AND CloseDate <= ${futureStr}`;
        if (stage) q += ` AND StageName = '${stage}'`;
        q += ` ORDER BY CloseDate ASC LIMIT 50`;
        const r = await sf.query(q);
        return { content: [{ type: "text", text: JSON.stringify(r.records, null, 2) }] };
      }

      if (name === "get_tasks") {
        const { account_name, status = "Open", days_due = 30 } = args || {};
        const today = new Date().toISOString().split("T")[0];
        const future = new Date();
        future.setDate(future.getDate() + days_due);
        const futureStr = future.toISOString().split("T")[0];
        let q = `SELECT Id, Subject, Status, Priority, ActivityDate, Who.Name, What.Name, Owner.Name FROM Task WHERE Status = '${status}' AND ActivityDate >= ${today} AND ActivityDate <= ${futureStr}`;
        if (account_name) q += ` AND What.Name LIKE '%${account_name}%'`;
        q += ` ORDER BY ActivityDate ASC LIMIT 50`;
        const r = await sf.query(q);
        return { content: [{ type: "text", text: JSON.stringify(r.records, null, 2) }] };
      }

      if (name === "get_client_detail") {
        const { account_name } = args || {};
        const ar = await sf.query(`SELECT Id, Name, Phone, BillingCity, BillingState, Type, Industry, NumberOfEmployees FROM Account WHERE Name LIKE '%${account_name}%' LIMIT 1`);
        if (!ar.records.length) return { content: [{ type: "text", text: `No account found: ${account_name}` }] };
        const account = ar.records[0];
        const [contacts, opps, tasks] = await Promise.all([
          sf.query(`SELECT Id, FirstName, LastName, Title, Email, Phone FROM Contact WHERE AccountId = '${account.Id}' LIMIT 10`),
          sf.query(`SELECT Id, Name, StageName, CloseDate, Amount FROM Opportunity WHERE AccountId = '${account.Id}' ORDER BY CloseDate DESC LIMIT 5`),
          sf.query(`SELECT Id, Subject, Status, ActivityDate FROM Task WHERE WhatId = '${account.Id}' ORDER BY ActivityDate DESC LIMIT 10`),
        ]);
        return { content: [{ type: "text", text: JSON.stringify({ account, contacts: contacts.records, opportunities: opps.records, tasks: tasks.records }, null, 2) }] };
      }

      if (name === "get_salesforce_objects") {
        const r = await sf.describeGlobal();
        const custom = r.sobjects.filter(o => o.custom).map(o => ({ name: o.name, label: o.label }));
        return { content: [{ type: "text", text: JSON.stringify(custom, null, 2) }] };
      }

      return { content: [{ type: "text", text: `Unknown tool: ${name}` }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }] };
    }
  });

  return server;
}

const app = express();
app.use("/mcp", express.raw({ type: "application/json" }));
app.use(express.json());

app.post("/mcp", async (req, res) => {
  try {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const server = buildServer();
    await server.connect(transport);
    const body = Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString()) : req.body;
await transport.handleRequest(req, res, body);
  } catch (err) {
    console.error("MCP error:", err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

app.get("/mcp", async (req, res) => {
  res.status(405).json({ error: "Use POST for MCP" });
});

app.get("/", (req, res) => {
  const baseUrl = process.env.RAILWAY_PUBLIC_DOMAIN
    ? "https://" + process.env.RAILWAY_PUBLIC_DOMAIN
    : "http://localhost:" + (process.env.PORT || 3000);
  res.json({ name: "bca-salesforce", version: "1.0.0", mcp_endpoint: baseUrl + "/mcp" });
});

// OAuth 2.0 metadata endpoint Claude requires
app.get("/.well-known/oauth-authorization-server", (req, res) => {
  const baseUrl = process.env.RAILWAY_PUBLIC_DOMAIN
    ? "https://" + process.env.RAILWAY_PUBLIC_DOMAIN
    : "http://localhost:" + (process.env.PORT || 3000);
  res.json({
    issuer: baseUrl,
    authorization_endpoint: baseUrl + "/authorize",
    token_endpoint: baseUrl + "/token",
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
  });
});

app.get("/authorize", (req, res) => {
  const { redirect_uri, state } = req.query;
  res.redirect(redirect_uri + "?code=bca-token&state=" + (state || ""));
});

app.post("/token", express.urlencoded({ extended: true }), (req, res) => {
  res.json({
    access_token: "bca-static-token",
    token_type: "bearer",
    expires_in: 86400,
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`BCA Salesforce MCP running on port ${PORT}`));
