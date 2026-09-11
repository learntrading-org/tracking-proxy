// Shared helpers for HubSpot renewal emails sent (or drafted) via Intercom.

export const INTERCOM_VERSION = "2.14";
export const CRYPTO_PAYMENT_URL = "https://bullmania.com/crypto-payment";
export const DEFAULT_ADMIN_EMAIL =
  process.env.INTERCOM_DEFAULT_ADMIN_EMAIL || "hello@bullmania.com";
export const SENDER_EMAIL =
  process.env.INTERCOM_SENDER_EMAIL || DEFAULT_ADMIN_EMAIL;

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

export function intercomHeaders(token, version = INTERCOM_VERSION) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "Intercom-Version": version,
  };
}

export const TEMPLATES = [
  {
    id: "crypto",
    label: "Crypto renewal",
    description: "Locked-in rate. Crypto wallet + transaction hash.",
    subject: "Your BullMania renewal is coming up",
    extraFields: [],
  },
  {
    id: "balance",
    label: "Remaining balance",
    description: "Outstanding balance. Card checkout and/or crypto.",
    subject: "Your remaining BullMania balance is due",
    extraFields: ["checkoutLink"],
  },
  {
    id: "due",
    label: "Payment due",
    description: "Short reminder that payment is due (crypto).",
    subject: "Your BullMania payment is due",
    extraFields: [],
  },
];

export function getTemplate(templateId) {
  return TEMPLATES.find((t) => t.id === templateId) || TEMPLATES[0];
}

export function getInputValue(payload, key) {
  if (!payload || typeof payload !== "object") return undefined;

  const buckets = [
    payload.fields,
    payload.inputFields,
    payload.properties,
    payload,
  ];

  for (const bucket of buckets) {
    if (!bucket || typeof bucket !== "object") continue;
    const value = bucket[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }

  const typed = payload.typedInputs?.[key]?.value;
  if (typed !== undefined && typed !== null && String(typed).trim() !== "") {
    return typed;
  }

  return undefined;
}

export function isWorkflowPayload(payload) {
  return Boolean(payload?.origin || payload?.callbackId || payload?.inputFields);
}

export function parseAmount(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }
  const numeric = Number(String(value).replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(numeric)) return null;
  return numeric;
}

export function formatAmount(value) {
  const numeric = parseAmount(value);
  if (numeric === null) return "";
  const hasCents = Math.round(numeric * 100) % 100 !== 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: hasCents ? 2 : 0,
  }).format(numeric);
}

export function parseDate(value) {
  if (value === undefined || value === null || value === "") return null;

  if (typeof value === "object" && value.year) {
    const month = Number(value.month);
    const date = new Date(Date.UTC(Number(value.year), month, Number(value.date)));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const raw = String(value).trim();
  if (!raw) return null;

  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    const ms = n < 1e12 ? n * 1000 : n;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(value) {
  const date = parseDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function displayFirstName(value) {
  const name = String(value || "").trim();
  return name || "there";
}

export function firstNameFromAdmin(admin) {
  if (!admin) return "";
  const name = String(admin.name || "").trim();
  if (name) return name.split(/\s+/)[0];
  const email = String(admin.email || "");
  return email.split("@")[0] || "";
}

function cryptoPayBlock() {
  return [
    "Send payment to an official wallet listed here:",
    CRYPTO_PAYMENT_URL,
    "",
    "Then reply to this email with your transaction hash URL. We'll credit your account right away.",
  ].join("\n");
}

export function renderRenewalEmail({
  templateId = "crypto",
  firstName,
  price,
  renewalDate,
  checkoutLink,
} = {}) {
  const template = getTemplate(templateId);
  const name = displayFirstName(firstName);
  const amount = formatAmount(price) || String(price || "").trim();
  const dateLabel = formatDate(renewalDate);
  const dueOn = dateLabel ? ` on ${dateLabel}` : " soon";
  const cardLink = String(checkoutLink || "").trim();

  let body = "";

  if (template.id === "balance") {
    const cardBlock = cardLink
      ? `Pay by card:\n${cardLink}\n\nOr pay with crypto:\n`
      : "Pay with crypto:\n";
    body = [
      `Hi ${name},`,
      "",
      `A reminder that your remaining BullMania membership balance of ${amount} is due${dueOn}. Completing this keeps your membership active and your locked-in rate.`,
      "",
      `${cardBlock}${cryptoPayBlock()}`,
      "",
      "Questions? Just reply.",
    ].join("\n");
  } else if (template.id === "due") {
    body = [
      `Hi ${name},`,
      "",
      `Your BullMania subscription payment of ${amount} is due${dueOn}. Please complete your renewal soon so you keep your locked-in rate and access.`,
      "",
      cryptoPayBlock(),
      "",
      "Need help? Just reply.",
    ].join("\n");
  } else {
    const renews = dateLabel ? ` on ${dateLabel}` : " soon";
    const completeBy = dateLabel ? ` before ${dateLabel}` : " soon";
    body = [
      `Hi ${name},`,
      "",
      `Your BullMania subscription renews${renews} at your locked-in rate of ${amount}.`,
      "",
      `Please complete your crypto payment${completeBy} so you keep this rate and uninterrupted access.`,
      "",
      cryptoPayBlock(),
      "",
      "If your account expires, current (higher) standard rates apply.",
      "",
      "Questions? Just reply.",
    ].join("\n");
  }

  return {
    templateId: template.id,
    subject: template.subject,
    body: body.trim(),
    html: textToHtml(body),
    amount,
    renewalDateLabel: dateLabel,
  };
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function textToHtml(text) {
  const withLinks = escapeHtml(String(text || "").trim()).replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1">$1</a>'
  );
  return withLinks
    .split(/\n\n+/)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

export async function listIntercomAdmins(token) {
  const res = await fetch("https://api.intercom.io/admins", {
    method: "GET",
    headers: intercomHeaders(token),
  });
  if (!res.ok) {
    throw new Error(`Intercom List Admins Failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  const admins = Array.isArray(data.admins) ? data.admins : [];
  return admins
    .filter((admin) => admin && admin.id && admin.email && admin.type !== "bot")
    .map((admin) => ({
      id: String(admin.id),
      name: admin.name || admin.email,
      email: admin.email,
      firstName: firstNameFromAdmin(admin),
      away: Boolean(admin.away_mode_enabled),
      hasInboxSeat: admin.has_inbox_seat !== false,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function resolveAdmin(admins, { adminId, senderEmail } = {}) {
  if (!admins?.length) return null;
  if (adminId) {
    const match = admins.find((admin) => String(admin.id) === String(adminId));
    if (match) return match;
  }
  const email = String(senderEmail || DEFAULT_ADMIN_EMAIL).trim().toLowerCase();
  if (email) {
    const match = admins.find((admin) => admin.email.toLowerCase() === email);
    if (match) return match;
  }
  const fallback = admins.find(
    (admin) => admin.email.toLowerCase() === DEFAULT_ADMIN_EMAIL.toLowerCase()
  );
  return fallback || admins[0] || null;
}

export async function findOrCreateIntercomContact(token, { email, firstName }) {
  const headers = intercomHeaders(token);
  const searchRes = await fetch("https://api.intercom.io/contacts/search", {
    method: "POST",
    headers,
    body: JSON.stringify({
      query: { field: "email", operator: "=", value: email },
    }),
  });
  if (!searchRes.ok) {
    throw new Error(
      `Intercom Search Failed: ${searchRes.status} ${await searchRes.text()}`
    );
  }
  const searchData = await searchRes.json();
  let contact = searchData.data?.[0];
  if (contact) return contact;

  const createBody = { role: "user", email };
  if (firstName && firstName !== "there") {
    createBody.name = firstName;
  }
  const createRes = await fetch("https://api.intercom.io/contacts", {
    method: "POST",
    headers,
    body: JSON.stringify(createBody),
  });
  if (!createRes.ok) {
    throw new Error(
      `Intercom Create Failed: ${createRes.status} ${await createRes.text()}`
    );
  }
  return createRes.json();
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

// Proven Intercom send path:
// 1. POST /conversations as the contact with message_type email (opens an email thread).
// 2. POST /conversations/{id}/reply as the teammate. That reply is the email the
//    customer receives, from the workspace inbound address (hello@bullmania.com).
// Do not start the thread with POST /messages from an admin — that path does not
// send reliably from the shared address.
const SEND_INTERCOM_VERSION = "2.11";

export async function sendIntercomEmail(token, { admin, contact, subject, html }) {
  const headers = intercomHeaders(token, SEND_INTERCOM_VERSION);
  const created = await postIntercomWithRetry(
    "https://api.intercom.io/conversations",
    headers,
    {
      from: { type: "user", id: contact.id },
      body: "Incoming request",
      subject,
      message_type: "email",
    },
    "Intercom Create Conversation Failed"
  );

  const conversationId = created.conversation_id || created.id;
  if (!conversationId) {
    throw new Error("Intercom Create Conversation Failed: missing conversation id");
  }

  const reply = await postIntercomWithRetry(
    `https://api.intercom.io/conversations/${conversationId}/reply`,
    headers,
    {
      message_type: "comment",
      type: "admin",
      admin_id: String(admin.id),
      body: html,
    },
    "Intercom Reply Failed"
  );

  return {
    ...reply,
    conversation_id: conversationId,
    id: reply.id || conversationId,
  };
}

async function postIntercomWithRetry(url, headers, payload, errorLabel) {
  let lastError = "";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    if (res.ok) return res.json();
    lastError = await res.text();
    if ((res.status === 404 || res.status === 409) && attempt < 3) {
      await sleep(1000 * attempt);
      continue;
    }
    throw new Error(`${errorLabel}: ${res.status} ${lastError}`);
  }
  throw new Error(`${errorLabel}: ${lastError}`);
}

export async function draftIntercomNote(token, { admin, contact, subject, body }) {
  const headers = intercomHeaders(token);
  const noteBody = [
    "<p><strong>DRAFT — Renewal email (not sent to the customer)</strong></p>",
    `<p>From: ${escapeHtml(admin.name)} (${escapeHtml(admin.email)})<br>`,
    `To: ${escapeHtml(contact.email || "")}<br>`,
    `Subject: ${escapeHtml(subject)}</p>`,
    "<hr>",
    textToHtml(body),
    "<p><em>Review this draft, then send from the HubSpot Renewal Email card or Intercom inbox.</em></p>",
  ].join("");

  const res = await fetch(
    `https://api.intercom.io/contacts/${contact.id}/notes`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        body: noteBody,
        admin_id: String(admin.id),
      }),
    }
  );
  if (!res.ok) {
    throw new Error(
      `Intercom Draft Note Failed: ${res.status} ${await res.text()}`
    );
  }
  return res.json();
}

export async function addHubSpotNote(token, contactId, body) {
  if (!token || !contactId) return null;
  const res = await fetch("https://api.hubapi.com/crm/v3/objects/notes", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      properties: {
        hs_timestamp: new Date().toISOString(),
        hs_note_body: body,
      },
      associations: [
        {
          to: { id: String(contactId) },
          types: [
            {
              associationCategory: "HUBSPOT_DEFINED",
              associationTypeId: 202,
            },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    console.error("HubSpot note create failed:", await res.text());
    return null;
  }
  return res.json();
}
