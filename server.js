import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import jsforce from "jsforce";
import express from "express";
import dotenv from "dotenv";

dotenv.config();

const conn = new jsforce.Connection({
  loginUrl: process.env.SF_LOGIN_URL,
});

let isConnected = false;

async function getSalesforceConnection() {
  if (!isConnected) {
    try {
      await conn.login(
        process.env.SF_USERNAME,
        process.env.SF_PASSWORD + process.env.SF_SECURITY_TOKEN
      );
      isConnected = true;
    } catch (err) {
      isConnected = false;
      throw err;
    }
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

function getTools() {
  return [
    {
      name: "get_accounts",
      description: "Get BCA Financial Group client accounts from Salesforce",
      inputSchema: {
        type: "object",
        properties: {
          search: { type: "string", description: "Search by account name (optional)" },
          limit: { type: "number", description: "Max accounts to return (default 20)" },
        },
      },
    },
    {
      name: "get_renewals",
      description: "Get upcoming client renewals and opportunities from Salesforce",
      inputSchema: {
        type: "object",
        properties: {
          days_ahead: { type: "number", description: "Days ahead to look for renewals (default 90)" },
          stage: { type: "string", description: "Filter by opportunity stage (optional)" },
        },
      },
    },
    {
      name: "get_tasks",
      description: "Get open tasks and workflow items from Salesforce",
      inputSchema: {
        type: "object",
        properties: {
          account_name: { type: "string", description: "Filter by client name (optional)" },
          status: { type: "string", description: "Task status: Open, Completed (default: Open)" },
          days_due: { type: "number", description: "Tasks due within this many days (default 30)" },
        },
      },
    },
    {
      name: "get_client_detail",
      description: "Get full detail for a specific client including contacts, opportunities, and tasks",
      inputSchema: {
        type: "object",
        properties: {
          account_name: { type: "string", description: "Client/account name to look up" },
        },
        required: ["account_name"],
      },
    },
    {
      name: "get_salesforce_objects",
      description: "List all custom objects in your Salesforce org",
      inputSchema: { type: "object", properties: {} },
    },
  ];
}

async function handleToolCall(name, args) {
  const sf = await getSalesforceConnectionWithRetry();

  if (name === "get_accounts") {
    const { search, limit = 20 } = args || {};
    let query = `SELECT Id, Name, Phone, BillingCity, BillingState,
                 Type, Industry, NumberOfEmployees, LastActivityDate
                 FROM Account`;
    if (search) query += ` WHERE Name LIKE '%${search}%'`;
    query += ` ORDER BY LastActivityDate DESC NULLS LAST LIMIT ${limit}`;
    const result = await sf.query(query);
    return { content: [{ type: "text", text: JSON.stringify(result.records, null, 2) }] };
  }

  if (name === "get_renewals") {
    const { days_ahead = 90, stage } = args || {};
    const today = new Date().toISOString().split("T")[0];
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + days_ahead);
    const futureDateStr = futureDate.toISOString().split("T")[0];
    let query = `SELECT Id, Name, Account.Name, CloseDate, StageName,
                 Amount, Probability, Owner.Name, NextStep, Description
                 FROM Opportunity
                 WHERE CloseDate >= ${today} AND CloseDate <= ${futureDateStr}`;
    if (stage) query += ` AND StageName = '${stage}'`;
    query += ` ORDER BY CloseDate ASC LIMIT 50`;
    const result = await sf.query(query);
    return { content: [{ type: "text", text: JSON.stringify(result.records, null, 2) }] };
  }

  if (name === "get_tasks") {
    const { account_name, status = "Open", days_due = 30 } = args || {};
    const today = new Date().toISOString().split("T")[0];
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + days_due);
    const futureDateStr = futureDate.toISOString().split("T")[0];
    let query = `SELECT Id, Subject, Status, Priority, ActivityDate,
                 Who.Name, What.Name, Owner.Name, Description
                 FROM Task
                 WHERE Status = '${status}'
                 AND ActivityDate >= ${today}
                 AND ActivityDate <= ${futureDateStr}`;
    if (account_name) query += ` AND What.Name LIKE '%${account_name}%'`;
    query += ` ORDER BY ActivityDate ASC LIMIT 50`;
    const result = await sf.query(query);
    return { content: [{ type: "text", text: JSON.stringify(result.records, null, 2) }] };
  }

  if (name === "get_client_detail") {
    const { account_name } = args || {};
    const accountResult = await sf.query(
      `SELECT Id, Name, Phone, BillingCity, BillingState,
       Type, Industry, NumberOfEmployees, LastActivityDate
       FROM Account WHERE Name LIKE '%${account_name}%' LIMIT 1`
    );
    if (!accountResult.records.length) {
      return { content: [{ type: "text", text: `No account found matching: ${account_name}` }] };
    }
    const account = accountResult.records[0];
    const [contacts, opps, tasks] = await Promise.all([
      sf.query(`SELECT Id, FirstName, LastName, Title, Email, Phone FROM Contact WHERE AccountId = '${account.Id}' LIMIT 10`),
      sf.query(`SELECT Id, Name, StageName, CloseDate, Amount, Description FROM Opportunity WHERE AccountId = '${account.Id}' ORDER BY CloseDate DESC LIMIT 5`),
      sf.query(`SELECT Id, Subject, Status, ActivityDate, Description FROM Task WHERE WhatId = '${account.Id}' ORDER BY ActivityDate DESC LIMIT 10`),
    ]);
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ account, contacts: contacts.records, opportunities: opps.records, recent_tasks: tasks.records }, null, 2),
      }],
    };
  }

  if (name === "get_salesforce_objects") {
    const result = await sf.describeGlobal();
    const customObjects = result.sobjects
      .filter((obj) => obj.custom)
      .map((obj) => ({ name: obj.name, label: obj.label }));
    return { content: [{ type: "text", text: JSON.stringify(customObjects, null, 2) }] };
  }

  return { content: [{ type: "text", text: `Unknown tool: ${name}` }] };
}

const app = express();
app.use(express.json());

app.post("/mcp", async (req, res) => {
  const server = new Server(
    { name: "bca-salesforce", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: getTools() };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      return await handleToolCall(name, args);
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }] };
    }
  });

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  res.on("close", () => transport.close());
  await transport.handleRequest(req, res, req.body);
  await server.connect(transport);
});

app.get("/", (req, res) => {
  const baseUrl = process.env.RAILWAY_PUBLIC_DOMAIN
    ? "https://" + process.env.RAILWAY_PUBLIC_DOMAIN
    : "http://localhost:" + (process.env.PORT || 3000);
  res.json({
    name: "bca-salesforce",
    version: "1.0.0",
    oauth: {
      authorization_endpoint: baseUrl + "/authorize",
      token_endpoint: baseUrl + "/token",
      client_id: "bca-client",
      scope: "mcp"
    }
  });
});

app.get("/authorize", (req, res) => {
  const redirect = req.query.redirect_uri;
  res.redirect(`${redirect}?code=bca-auth&state=${req.query.state}`);
});

app.post("/token", (req, res) => {
  res.json({
    access_token: "bca-static-token",
    token_type: "bearer",
    expires_in: 86400
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`BCA Salesforce MCP server running on port ${PORT}`);
});
