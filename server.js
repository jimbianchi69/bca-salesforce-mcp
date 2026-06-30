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
    { name: "bca-salesforce", version: "2.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      // ── READ TOOLS ──────────────────────────────────────────────
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

      // ── WRITE TOOLS ─────────────────────────────────────────────
      {
        name: "create_account",
        description: "Create a new account (prospect or client) in Salesforce",
        inputSchema: {
          type: "object",
          properties: {
            name:               { type: "string", description: "Company name (required)" },
            phone:              { type: "string", description: "Main phone number" },
            billing_street:     { type: "string", description: "Street address" },
            billing_city:       { type: "string", description: "City" },
            billing_state:      { type: "string", description: "State (e.g. MA)" },
            billing_zip:        { type: "string", description: "ZIP code" },
            industry:           { type: "string", description: "Industry (e.g. Healthcare)" },
            number_of_employees:{ type: "number", description: "Employee count" },
            type:               { type: "string", description: "Account type (e.g. Prospect, Client)" },
            website:            { type: "string", description: "Company website URL" },
            description:        { type: "string", description: "Notes or description" },
          },
          required: ["name"],
        },
      },
      {
        name: "update_account",
        description: "Update fields on an existing Salesforce account",
        inputSchema: {
          type: "object",
          properties: {
            account_name:        { type: "string", description: "Name to look up the account (required)" },
            phone:               { type: "string" },
            billing_street:      { type: "string" },
            billing_city:        { type: "string" },
            billing_state:       { type: "string" },
            billing_zip:         { type: "string" },
            industry:            { type: "string" },
            number_of_employees: { type: "number" },
            type:                { type: "string" },
            website:             { type: "string" },
            description:         { type: "string" },
          },
          required: ["account_name"],
        },
      },
      {
        name: "create_contact",
        description: "Create a new contact linked to an existing account",
        inputSchema: {
          type: "object",
          properties: {
            account_name: { type: "string", description: "Account to link the contact to (required)" },
            first_name:   { type: "string", description: "First name" },
            last_name:    { type: "string", description: "Last name (required)" },
            title:        { type: "string", description: "Job title" },
            email:        { type: "string", description: "Email address" },
            phone:        { type: "string", description: "Direct phone" },
            mobile:       { type: "string", description: "Mobile phone" },
          },
          required: ["account_name", "last_name"],
        },
      },
      {
        name: "create_task",
        description: "Create a follow-up task linked to an account in Salesforce",
        inputSchema: {
          type: "object",
          properties: {
            account_name: { type: "string", description: "Account to link the task to (required)" },
            subject:      { type: "string", description: "Task subject/title (required)" },
            due_date:     { type: "string", description: "Due date in YYYY-MM-DD format" },
            priority:     { type: "string", description: "High, Normal, or Low (default: Normal)" },
            status:       { type: "string", description: "Not Started, In Progress, etc. (default: Not Started)" },
            description:  { type: "string", description: "Task notes or details" },
          },
          required: ["account_name", "subject"],
        },
      },
      {
        name: "complete_task",
        description: "Mark an existing task as Completed in Salesforce",
        inputSchema: {
          type: "object",
          properties: {
            task_id:      { type: "string", description: "Salesforce Task ID (required)" },
            comment:      { type: "string", description: "Optional completion note" },
          },
          required: ["task_id"],
        },
      },
      {
        name: "log_activity",
        description: "Log a completed call, meeting, or email activity note to an account",
        inputSchema: {
          type: "object",
          properties: {
            account_name:    { type: "string", description: "Account to log the activity against (required)" },
            subject:         { type: "string", description: "Activity subject (required)" },
            activity_type:   { type: "string", description: "Call, Meeting, Email, or Other (default: Call)" },
            activity_date:   { type: "string", description: "Date of activity in YYYY-MM-DD format (default: today)" },
            description:     { type: "string", description: "Notes from the call or meeting" },
          },
          required: ["account_name", "subject"],
        },
      },
      {
        name: "add_note",
        description: "Add a freeform note to an account record in Salesforce",
        inputSchema: {
          type: "object",
          properties: {
            account_name: { type: "string", description: "Account to attach the note to (required)" },
            title:        { type: "string", description: "Note title (required)" },
            body:         { type: "string", description: "Full text of the note (required)" },
          },
          required: ["account_name", "title", "body"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const sf = await getSalesforceConnectionWithRetry();

      // ── READ HANDLERS ────────────────────────────────────────────

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

      // ── WRITE HANDLERS ───────────────────────────────────────────

      if (name === "create_account") {
        const { name: acctName, phone, billing_street, billing_city, billing_state, billing_zip, industry, number_of_employees, type, website, description } = args || {};
        const payload = { Name: acctName };
        if (phone)               payload.Phone = phone;
        if (billing_street)      payload.BillingStreet = billing_street;
        if (billing_city)        payload.BillingCity = billing_city;
        if (billing_state)       payload.BillingState = billing_state;
        if (billing_zip)         payload.BillingPostalCode = billing_zip;
        if (industry)            payload.Industry = industry;
        if (number_of_employees) payload.NumberOfEmployees = number_of_employees;
        if (type)                payload.Type = type;
        if (website)             payload.Website = website;
        if (description)         payload.Description = description;
        const result = await sf.sobject("Account").create(payload);
        if (result.success) {
          return { content: [{ type: "text", text: `✅ Account created successfully. Salesforce ID: ${result.id}` }] };
        } else {
          return { content: [{ type: "text", text: `❌ Failed to create account: ${JSON.stringify(result.errors)}` }] };
        }
      }

      if (name === "update_account") {
        const { account_name, phone, billing_street, billing_city, billing_state, billing_zip, industry, number_of_employees, type, website, description } = args || {};
        const ar = await sf.query(`SELECT Id FROM Account WHERE Name LIKE '%${account_name}%' LIMIT 1`);
        if (!ar.records.length) return { content: [{ type: "text", text: `No account found matching: ${account_name}` }] };
        const accountId = ar.records[0].Id;
        const payload = { Id: accountId };
        if (phone !== undefined)               payload.Phone = phone;
        if (billing_street !== undefined)      payload.BillingStreet = billing_street;
        if (billing_city !== undefined)        payload.BillingCity = billing_city;
        if (billing_state !== undefined)       payload.BillingState = billing_state;
        if (billing_zip !== undefined)         payload.BillingPostalCode = billing_zip;
        if (industry !== undefined)            payload.Industry = industry;
        if (number_of_employees !== undefined) payload.NumberOfEmployees = number_of_employees;
        if (type !== undefined)                payload.Type = type;
        if (website !== undefined)             payload.Website = website;
        if (description !== undefined)         payload.Description = description;
        const result = await sf.sobject("Account").update(payload);
        if (result.success) {
          return { content: [{ type: "text", text: `✅ Account "${account_name}" updated successfully.` }] };
        } else {
          return { content: [{ type: "text", text: `❌ Failed to update account: ${JSON.stringify(result.errors)}` }] };
        }
      }

      if (name === "create_contact") {
        const { account_name, first_name, last_name, title, email, phone, mobile } = args || {};
        const ar = await sf.query(`SELECT Id FROM Account WHERE Name LIKE '%${account_name}%' LIMIT 1`);
        if (!ar.records.length) return { content: [{ type: "text", text: `No account found matching: ${account_name}` }] };
        const accountId = ar.records[0].Id;
        const payload = { AccountId: accountId, LastName: last_name };
        if (first_name) payload.FirstName = first_name;
        if (title)      payload.Title = title;
        if (email)      payload.Email = email;
        if (phone)      payload.Phone = phone;
        if (mobile)     payload.MobilePhone = mobile;
        const result = await sf.sobject("Contact").create(payload);
        if (result.success) {
          return { content: [{ type: "text", text: `✅ Contact ${first_name || ""} ${last_name} created under "${account_name}". ID: ${result.id}` }] };
        } else {
          return { content: [{ type: "text", text: `❌ Failed to create contact: ${JSON.stringify(result.errors)}` }] };
        }
      }

      if (name === "create_task") {
        const { account_name, subject, due_date, priority = "Normal", status = "Not Started", description } = args || {};
        const ar = await sf.query(`SELECT Id FROM Account WHERE Name LIKE '%${account_name}%' LIMIT 1`);
        if (!ar.records.length) return { content: [{ type: "text", text: `No account found matching: ${account_name}` }] };
        const accountId = ar.records[0].Id;
        const today = new Date().toISOString().split("T")[0];
        const payload = {
          WhatId: accountId,
          Subject: subject,
          Status: status,
          Priority: priority,
          ActivityDate: due_date || today,
        };
        if (description) payload.Description = description;
        const result = await sf.sobject("Task").create(payload);
        if (result.success) {
          return { content: [{ type: "text", text: `✅ Task "${subject}" created for "${account_name}" due ${due_date || today}. ID: ${result.id}` }] };
        } else {
          return { content: [{ type: "text", text: `❌ Failed to create task: ${JSON.stringify(result.errors)}` }] };
        }
      }

      if (name === "complete_task") {
        const { task_id, comment } = args || {};
        const payload = { Id: task_id, Status: "Completed" };
        if (comment) payload.Description = comment;
        const result = await sf.sobject("Task").update(payload);
        if (result.success) {
          return { content: [{ type: "text", text: `✅ Task ${task_id} marked as Completed.` }] };
        } else {
          return { content: [{ type: "text", text: `❌ Failed to complete task: ${JSON.stringify(result.errors)}` }] };
        }
      }

      if (name === "log_activity") {
        const { account_name, subject, activity_type = "Call", activity_date, description } = args || {};
        const ar = await sf.query(`SELECT Id FROM Account WHERE Name LIKE '%${account_name}%' LIMIT 1`);
        if (!ar.records.length) return { content: [{ type: "text", text: `No account found matching: ${account_name}` }] };
        const accountId = ar.records[0].Id;
        const today = new Date().toISOString().split("T")[0];
        const payload = {
          WhatId: accountId,
          Subject: subject,
          Status: "Completed",
          Priority: "Normal",
          TaskSubtype: activity_type === "Email" ? "Email" : "Call",
          ActivityDate: activity_date || today,
        };
        if (description) payload.Description = description;
        const result = await sf.sobject("Task").create(payload);
        if (result.success) {
          return { content: [{ type: "text", text: `✅ ${activity_type} activity "${subject}" logged for "${account_name}" on ${activity_date || today}.` }] };
        } else {
          return { content: [{ type: "text", text: `❌ Failed to log activity: ${JSON.stringify(result.errors)}` }] };
        }
      }

      if (name === "add_note") {
        const { account_name, title, body } = args || {};
        const ar = await sf.query(`SELECT Id FROM Account WHERE Name LIKE '%${account_name}%' LIMIT 1`);
        if (!ar.records.length) return { content: [{ type: "text", text: `No account found matching: ${account_name}` }] };
        const accountId = ar.records[0].Id;
        const result = await sf.sobject("Note").create({
          ParentId: accountId,
          Title: title,
          Body: body,
        });
        if (result.success) {
          return { content: [{ type: "text", text: `✅ Note "${title}" added to "${account_name}". ID: ${result.id}` }] };
        } else {
          return { content: [{ type: "text", text: `❌ Failed to add note: ${JSON.stringify(result.errors)}` }] };
        }
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
  res.json({ name: "bca-salesforce", version: "2.0.0", mcp_endpoint: baseUrl + "/mcp" });
});

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
