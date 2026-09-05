// KM Cleaning Services — local chat & bookings server
// Replicates the Cloudflare Worker (km-chat-worker.js) so the site works in preview.
// Runs with plain Node (no npm install). Handles:
//   POST /chat       -> proxies to Anthropic Claude API
//   POST /bookings   -> saves a booking (in-memory + JSON file for persistence)
//   GET  /bookings   -> lists bookings (admin, needs x-admin-key header)
//   PATCH /bookings?id=... -> updates a booking's status (admin)

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 8787;
const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 1000;
const MAX_MESSAGES = 40;
const ADMIN_KEY = process.env.ADMIN_KEY || "km-admin-dev";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const BOOKINGS_FILE = path.join(__dirname, "bookings.json");

// --- In-memory booking store, backed by a JSON file ---
let bookings = [];
try {
  bookings = JSON.parse(fs.readFileSync(BOOKINGS_FILE, "utf8"));
} catch (_) { /* no file yet */ }

function persist() {
  try { fs.writeFileSync(BOOKINGS_FILE, JSON.stringify(bookings, null, 2)); } catch (_) {}
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-admin-key",
  };
}

function sendJson(res, obj, status = 200) {
  res.writeHead(status, { ...cors(), "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => { data += c; });
    req.on("end", () => {
      try { resolve(JSON.parse(data)); }
      catch (_) { resolve(null); }
    });
  });
}

function checkAdmin(req) {
  return !!ADMIN_KEY && req.headers["x-admin-key"] === ADMIN_KEY;
}

// --- Chat: proxy to Anthropic ---
async function handleChat(req, res) {
  const body = await readBody(req);
  if (!body || !Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > MAX_MESSAGES) {
    return sendJson(res, { error: "Invalid or too-long message list" }, 400);
  }
  if (!ANTHROPIC_API_KEY) {
    return sendJson(res, { error: "Server is missing ANTHROPIC_API_KEY" }, 500);
  }

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: body.system || "",
        messages: body.messages,
      }),
    });
    const text = await resp.text();
    res.writeHead(resp.status, { ...cors(), "Content-Type": "application/json" });
    res.end(text);
  } catch (e) {
    sendJson(res, { error: "Failed to reach Anthropic" }, 502);
  }
}

// --- Bookings CRUD ---
async function handleCreateBooking(req, res) {
  const body = await readBody(req);
  if (!body) return sendJson(res, { error: "Invalid JSON body" }, 400);
  const required = ["service", "area", "date", "name", "phone"];
  for (const f of required) {
    if (!body[f] || typeof body[f] !== "string") return sendJson(res, { error: `Missing field: ${f}` }, 400);
  }
  const id = crypto.randomUUID();
  const record = {
    id,
    service: body.service.slice(0, 200),
    area: body.area.slice(0, 200),
    date: body.date.slice(0, 200),
    name: body.name.slice(0, 200),
    phone: body.phone.slice(0, 50),
    source: (body.source || "website").slice(0, 50),
    status: "new",
    createdAt: new Date().toISOString(),
  };
  bookings.push(record);
  persist();
  sendJson(res, { ok: true, id });
}

function handleListBookings(req, res) {
  if (!checkAdmin(req)) return sendJson(res, { error: "Unauthorized" }, 401);
  const sorted = [...bookings].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  sendJson(res, { bookings: sorted });
}

async function handleUpdateBooking(req, res) {
  if (!checkAdmin(req)) return sendJson(res, { error: "Unauthorized" }, 401);
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const id = url.searchParams.get("id");
  if (!id) return sendJson(res, { error: "Missing id" }, 400);
  const record = bookings.find((b) => b.id === id);
  if (!record) return sendJson(res, { error: "Not found" }, 404);
  const body = await readBody(req);
  if (!body) return sendJson(res, { error: "Invalid JSON body" }, 400);
  const allowed = ["new", "contacted", "scheduled", "completed", "cancelled"];
  if (body.status && allowed.includes(body.status)) record.status = body.status;
  persist();
  sendJson(res, { ok: true });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors());
    return res.end();
  }
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (url.pathname === "/chat" && req.method === "POST") return await handleChat(req, res);
    if (url.pathname === "/bookings" && req.method === "POST") return await handleCreateBooking(req, res);
    if (url.pathname === "/bookings" && req.method === "GET") return handleListBookings(req, res);
    if (url.pathname === "/bookings" && req.method === "PATCH") return await handleUpdateBooking(req, res);
    sendJson(res, { error: "Not found" }, 404);
  } catch (e) {
    sendJson(res, { error: "Internal server error" }, 500);
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`KM chat/bookings server listening on :${PORT}`);
  console.log(`Anthropic key: ${ANTHROPIC_API_KEY ? "present" : "MISSING — chat will not work"}`);
});
