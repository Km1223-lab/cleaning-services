// KM Cleaning Services — Cloudflare Worker
//
// Handles two jobs behind one Worker:
//   1. POST /chat      -> proxies chat messages to Claude (keeps your Anthropic key secret)
//   2. POST /bookings   -> saves a booking request from the website (public, no key needed)
//      GET  /bookings   -> lists all booking requests (admin only, needs x-admin-key header)
//      PATCH /bookings?id=... -> updates a booking's status (admin only)
//
// SETUP (Cloudflare dashboard, no CLI needed):
// 1. Workers & Pages -> Create -> Create Worker -> name it e.g. "km-cleaning-chat-proxy" -> Deploy
// 2. Edit code -> delete the default code -> paste this whole file in -> Deploy
// 3. Create the storage for bookings:
//    Workers & Pages -> KV -> Create namespace -> name it e.g. "km_bookings"
//    Then on your Worker: Settings -> Bindings -> Add -> KV Namespace
//       Variable name: BOOKINGS_KV   Namespace: km_bookings
// 4. Add two secrets: Settings -> Variables and Secrets -> Add
//       ANTHROPIC_API_KEY  = your key from console.anthropic.com
//       ADMIN_KEY          = a password you make up, used to log into the admin dashboard
//    Mark both as "Secret", then Save + Deploy.
// 5. Add every origin that should be allowed to call this Worker to ALLOWED_ORIGINS below
//    (your live site, and your admin dashboard's URL if hosted separately), then Deploy again.
// 6. Copy the Worker's URL (e.g. https://km-cleaning-chat-proxy.yourname.workers.dev) into
//    WORKER_URL in your website's HTML file and in admin.html.

const ALLOWED_ORIGINS = [
  "https://your-site-domain.com" // TODO: add every origin allowed to call this Worker
];
const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 1000;
const MAX_MESSAGES = 40; // caps conversation length so one visitor can't run up a huge bill

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(request) });
    }

    if (url.pathname === "/chat" && request.method === "POST") {
      return handleChat(request, env);
    }
    if (url.pathname === "/bookings" && request.method === "POST") {
      return handleCreateBooking(request, env);
    }
    if (url.pathname === "/bookings" && request.method === "GET") {
      return handleListBookings(request, env);
    }
    if (url.pathname === "/bookings" && request.method === "PATCH") {
      return handleUpdateBooking(request, env);
    }

    return json(request, { error: "Not found" }, 404);
  }
};

async function handleChat(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json(request, { error: "Invalid JSON body" }, 400);
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > MAX_MESSAGES) {
    return json(request, { error: "Invalid or too-long message list" }, 400);
  }
  if (!env.ANTHROPIC_API_KEY) {
    return json(request, { error: "Server is missing ANTHROPIC_API_KEY" }, 500);
  }

  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: body.system || "",
      messages: body.messages
    })
  });

  const data = await anthropicRes.text();
  return new Response(data, {
    status: anthropicRes.status,
    headers: { ...corsHeaders(request), "Content-Type": "application/json" }
  });
}

async function handleCreateBooking(request, env) {
  if (!env.BOOKINGS_KV) {
    return json(request, { error: "Server is missing the BOOKINGS_KV binding" }, 500);
  }
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json(request, { error: "Invalid JSON body" }, 400);
  }

  const required = ["service", "area", "date", "name", "phone"];
  for (const field of required) {
    if (!body[field] || typeof body[field] !== "string") {
      return json(request, { error: `Missing field: ${field}` }, 400);
    }
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
    createdAt: new Date().toISOString()
  };

  await env.BOOKINGS_KV.put(`booking:${id}`, JSON.stringify(record));
  return json(request, { ok: true, id });
}

async function handleListBookings(request, env) {
  if (!checkAdmin(request, env)) return json(request, { error: "Unauthorized" }, 401);
  if (!env.BOOKINGS_KV) return json(request, { error: "Server is missing the BOOKINGS_KV binding" }, 500);

  const list = await env.BOOKINGS_KV.list({ prefix: "booking:" });
  const records = await Promise.all(
    list.keys.map(async (k) => {
      const raw = await env.BOOKINGS_KV.get(k.name);
      return raw ? JSON.parse(raw) : null;
    })
  );
  const bookings = records.filter(Boolean).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return json(request, { bookings });
}

async function handleUpdateBooking(request, env) {
  if (!checkAdmin(request, env)) return json(request, { error: "Unauthorized" }, 401);
  if (!env.BOOKINGS_KV) return json(request, { error: "Server is missing the BOOKINGS_KV binding" }, 500);

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) return json(request, { error: "Missing id" }, 400);

  const key = `booking:${id}`;
  const existing = await env.BOOKINGS_KV.get(key);
  if (!existing) return json(request, { error: "Not found" }, 404);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json(request, { error: "Invalid JSON body" }, 400);
  }

  const record = JSON.parse(existing);
  const allowedStatuses = ["new", "contacted", "scheduled", "completed", "cancelled"];
  if (body.status && allowedStatuses.includes(body.status)) {
    record.status = body.status;
  }

  await env.BOOKINGS_KV.put(key, JSON.stringify(record));
  return json(request, { ok: true });
}

function checkAdmin(request, env) {
  return !!env.ADMIN_KEY && request.headers.get("x-admin-key") === env.ADMIN_KEY;
}

function json(request, obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders(request), "Content-Type": "application/json" }
  });
}

function corsHeaders(request) {
  const origin = request.headers.get("Origin");
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-admin-key"
  };
}
