const KIT_BASE = "https://api.convertkit.com/v3";
const THRIVECART_CUSTOMER_URL = "https://thrivecart.com/api/external/customer";
const THRIVECART_STUDENTS_URL = "https://thrivecart.com/api/external/students";
export const THRIVECART_COURSE_ID = "187845";

function kitSecret() {
  const secret = process.env.CONVERTKIT_API_SECRET;
  if (!secret) throw new Error("CONVERTKIT_API_SECRET is not set");
  return secret;
}

function thriveCartKey() {
  const key = process.env.THRIVECART_API_KEY;
  if (!key) throw new Error("THRIVECART_API_KEY is not set");
  return key;
}

async function readBody(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function errorMessage(data, fallback) {
  if (!data) return fallback;
  if (typeof data.error === "string") return data.error;
  if (typeof data.message === "string") return data.message;
  if (Array.isArray(data.errors)) return data.errors.join(", ");
  return fallback;
}

async function kitGet(path) {
  const url = new URL(`${KIT_BASE}${path}`);
  url.searchParams.set("api_secret", kitSecret());
  const response = await fetch(url);
  const data = await readBody(response);
  if (!response.ok) {
    throw new Error(errorMessage(data, `Kit request failed (${response.status})`));
  }
  return data;
}

async function kitPost(path, body) {
  const response = await fetch(`${KIT_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ api_secret: kitSecret(), ...body }),
  });
  const data = await readBody(response);
  if (!response.ok) {
    throw new Error(errorMessage(data, `Kit request failed (${response.status})`));
  }
  return data;
}

function tagList(tags) {
  return (Array.isArray(tags) ? tags : [])
    .map((tag) => ({
      id: String(tag.id),
      name: String(tag.name || tag.id),
    }))
    .filter((tag) => tag.id)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadKit(email) {
  const listed = await kitGet(`/subscribers?email_address=${encodeURIComponent(email)}`);
  const subscriber = listed.subscribers?.[0] || null;
  const [assigned, account] = await Promise.all([
    subscriber ? kitGet(`/subscribers/${subscriber.id}/tags`) : Promise.resolve({ tags: [] }),
    kitGet("/tags"),
  ]);
  return {
    found: Boolean(subscriber),
    state: subscriber?.state || "",
    tags: tagList(assigned.tags),
    availableTags: tagList(account.tags),
  };
}

export async function addKitTag(email, tagId) {
  await kitPost(`/tags/${encodeURIComponent(tagId)}/subscribe`, { email });
}

export async function removeKitTag(email, tagId) {
  await kitPost(`/tags/${encodeURIComponent(tagId)}/unsubscribe`, { email });
}

function formatAmount(amount, currency) {
  const raw = String(amount ?? "").trim();
  if (!raw) return "";
  const num = Number(raw);
  if (!Number.isFinite(num)) return raw;
  const major = Number.isInteger(num) ? num / 100 : num;
  const money = major.toFixed(2);
  return currency ? `${money} ${currency}` : money;
}

function subscriptionLabel(item) {
  return (
    item.product_name ||
    item.name ||
    item.item_name ||
    item.subscription_reference ||
    item.subscription_id ||
    "Subscription"
  );
}

export function summarizeThriveCart(data) {
  const subscriptions = []
    .concat(data?.subscriptions || [])
    .concat(data?.customer?.subscriptions || []);
  const seen = new Set();
  const rows = [];
  for (const item of subscriptions) {
    if (!item || typeof item !== "object") continue;
    const id = String(item.subscription_id || item.subscription_reference || item.order_id || rows.length);
    if (seen.has(id)) continue;
    seen.add(id);
    const status = String(item.status || "").toLowerCase();
    rows.push({
      id,
      name: String(subscriptionLabel(item)),
      status: status || "unknown",
      frequency: String(item.frequency || ""),
      amount: formatAmount(item.amount, item.currency),
    });
  }
  const customer = data?.customer || data?.email ? data.customer || data : null;
  const found = Boolean(customer) || rows.length > 0;
  return {
    found,
    active: rows.some((row) => row.status === "active"),
    subscriptions: rows,
  };
}

export async function loadThriveCart(email) {
  const body = new URLSearchParams();
  body.set("email", email);
  const response = await fetch(THRIVECART_CUSTOMER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${thriveCartKey()}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const data = await readBody(response);
  if (!response.ok) {
    const message = errorMessage(data, `ThriveCart request failed (${response.status})`);
    if (response.status === 404 || /not found|no customer|no orders/i.test(message)) {
      return { found: false, active: false, subscriptions: [] };
    }
    throw new Error(message);
  }
  if (data?.error && !data.subscriptions && !data.customer) {
    if (/not found|no customer|no orders/i.test(String(data.error))) {
      return { found: false, active: false, subscriptions: [] };
    }
    throw new Error(String(data.error));
  }
  return summarizeThriveCart(data);
}

export async function createThriveCartStudent(email, name) {
  const body = new URLSearchParams();
  body.set("email", email);
  body.set("name", name || "");
  body.set("course_id", THRIVECART_COURSE_ID);
  body.set("trigger_emails", "true");
  body.append("tags[]", "");
  body.set("order_info[order_id]", "");
  body.set("order_info[purchase_type]", "");
  body.set("order_info[purchase_id]", "");

  const response = await fetch(THRIVECART_STUDENTS_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${thriveCartKey()}` },
    body,
  });
  const data = await readBody(response);
  if (!response.ok || data?.error || data?.success === false) {
    throw new Error(errorMessage(data, `ThriveCart student create failed (${response.status})`));
  }
  return data;
}
