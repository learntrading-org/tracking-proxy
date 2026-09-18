// Shared helpers for HubSpot renewal emails sent (or drafted) via Intercom.

export const INTERCOM_VERSION = "2.14";
export const CRYPTO_PAYMENT_URL = "https://bullmania.com/crypto-payment";
export const DEFAULT_ADMIN_EMAIL =
  process.env.INTERCOM_DEFAULT_ADMIN_EMAIL || "john@learntrading.com";
export const SENDER_EMAIL =
  process.env.INTERCOM_SENDER_EMAIL || "hello@bullmania.com";

export const ON_BEHALF_ADMINS = [
  { name: "John Pilla", email: "john@learntrading.com" },
  { name: "Jonathan Blackburn", email: "jonathan@learntrading.com" },
  { name: "Mauro Fabijanic", email: "mauro@bullmania.com" },
];

export const ALLOWED_ON_BEHALF_EMAILS = ON_BEHALF_ADMINS.map(
  (admin) => admin.email
);

const ADMIN_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
let adminCache = { admins: null, expiresAt: 0 };

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

function linkLabel(url) {
  return String(url || "")
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
}

function cryptoPayStepsText(includeHeading = true) {
  const lines = [
    "1. Send payment to an official wallet: " + CRYPTO_PAYMENT_URL,
    "2. Reply to this email with your transaction hash URL. We'll credit your account right away.",
  ];
  if (includeHeading) {
    return ["How to renew with crypto:", ...lines].join("\n");
  }
  return lines.join("\n");
}

function htmlP(inner) {
  // Intercom inbox strips <p> margins; <br><br> is what actually shows as a blank line.
  return `${inner}<br><br>`;
}

function htmlStrong(text) {
  return `<strong>${escapeHtml(text)}</strong>`;
}

function htmlLink(url) {
  const href = String(url || "").trim();
  if (!href) return "";
  return `<a href="${escapeHtml(href)}">${escapeHtml(linkLabel(href))}</a>`;
}

function htmlOl(items) {
  return items.map((item, index) => `${index + 1}. ${item}`).join("<br>") + "<br><br>";
}

function cryptoPayStepsHtml() {
  return (
    htmlP(htmlStrong("How to renew with crypto:")) +
    htmlOl([
      `Send payment to an official wallet: ${htmlLink(CRYPTO_PAYMENT_URL)}`,
      "Reply to this email with your transaction hash URL. We'll credit your account right away.",
    ])
  );
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
  const amountHtml = amount ? htmlStrong(amount) : "";
  const dateHtml = dateLabel ? htmlStrong(dateLabel) : "";

  let body = "";
  let html = "";

  if (template.id === "balance") {
    const intro = `Your remaining BullMania membership balance of ${amount} is due${dueOn}. Completing this keeps your membership active and your locked-in rate.`;
    const payLines = cardLink
      ? [
          "How to pay:",
          `1. Pay by card: ${cardLink}`,
          `2. Or send crypto to an official wallet: ${CRYPTO_PAYMENT_URL}`,
          "3. If you pay with crypto, reply with your transaction hash URL so we can credit your account.",
        ]
      : [
          "How to pay:",
          `1. Send crypto to an official wallet: ${CRYPTO_PAYMENT_URL}`,
          "2. Reply with your transaction hash URL so we can credit your account.",
        ];
    body = [
      `Hi ${name},`,
      "",
      intro,
      "",
      ...payLines,
      "",
      "Questions? Just reply to this email.",
      "",
      "Thanks for being part of the BullMania community.",
    ].join("\n");

    const payItems = cardLink
      ? [
          `Pay by card: ${htmlLink(cardLink)}`,
          `Or send crypto to an official wallet: ${htmlLink(CRYPTO_PAYMENT_URL)}`,
          "If you pay with crypto, reply with your transaction hash URL so we can credit your account.",
        ]
      : [
          `Send crypto to an official wallet: ${htmlLink(CRYPTO_PAYMENT_URL)}`,
          "Reply with your transaction hash URL so we can credit your account.",
        ];
    html = [
      htmlP(`Hi ${escapeHtml(name)},`),
      htmlP(
        `Your remaining BullMania membership balance of ${amountHtml} is due${
          dateHtml ? ` on ${dateHtml}` : " soon"
        }. Completing this keeps your membership active and your locked-in rate.`
      ),
      htmlP(htmlStrong("How to pay:")),
      htmlOl(payItems),
      htmlP("Questions? Just reply to this email."),
      htmlP("Thanks for being part of the BullMania community."),
    ].join("");
  } else if (template.id === "due") {
    body = [
      `Hi ${name},`,
      "",
      `Your BullMania subscription payment of ${amount} is due${dueOn}. Please complete your renewal soon so you keep your locked-in rate and access.`,
      "",
      cryptoPayStepsText(),
      "",
      "Need help? Just reply to this email.",
      "",
      "Thanks for being part of the BullMania community.",
    ].join("\n");
    html = [
      htmlP(`Hi ${escapeHtml(name)},`),
      htmlP(
        `Your BullMania subscription payment of ${amountHtml} is due${
          dateHtml ? ` on ${dateHtml}` : " soon"
        }. Please complete your renewal soon so you keep your locked-in rate and access.`
      ),
      cryptoPayStepsHtml(),
      htmlP("Need help? Just reply to this email."),
      htmlP("Thanks for being part of the BullMania community."),
    ].join("");
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
      cryptoPayStepsText(),
      "",
      "If your account expires, current (higher) standard rates apply.",
      "",
      "Questions? Just reply to this email.",
      "",
      "Thanks for being part of the BullMania community.",
    ].join("\n");
    html = [
      htmlP(`Hi ${escapeHtml(name)},`),
      htmlP(
        `Your BullMania subscription renews${
          dateHtml ? ` on ${dateHtml}` : " soon"
        } at your locked-in rate of ${amountHtml}.`
      ),
      htmlP(
        `Please complete your crypto payment${
          dateLabel ? ` before ${dateHtml}` : " soon"
        } so you keep this rate and uninterrupted access.`
      ),
      cryptoPayStepsHtml(),
      htmlP("If your account expires, current (higher) standard rates apply."),
      htmlP("Questions? Just reply to this email."),
      htmlP("Thanks for being part of the BullMania community."),
    ].join("");
  }

  return {
    templateId: template.id,
    subject: template.subject,
    body: body.trim(),
    html,
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

function formatInlineHtml(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(https?:\/\/[^\s<]+)/g, (url) => {
      const label = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
      return `<a href="${url}">${label}</a>`;
    });
}

export function textToHtml(text) {
  const lines = String(text || "").replace(/\r\n/g, "\n").trim().split("\n");
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    if (!lines[i].trim()) {
      i += 1;
      continue;
    }

    if (/^\s*\d+\.\s+/.test(lines[i])) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(formatInlineHtml(lines[i].replace(/^\s*\d+\.\s+/, "")));
        i += 1;
      }
      blocks.push(items.map((item, index) => `${index + 1}. ${item}`).join("<br>"));
      continue;
    }

    if (/^\s*[-*]\s+/.test(lines[i])) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(formatInlineHtml(lines[i].replace(/^\s*[-*]\s+/, "")));
        i += 1;
      }
      blocks.push(items.map((item) => `• ${item}`).join("<br>"));
      continue;
    }

    const paragraph = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i])
    ) {
      paragraph.push(formatInlineHtml(lines[i]));
      i += 1;
    }
    blocks.push(paragraph.join("<br>"));
  }

  return blocks.join("<br><br>");
}

export function listOnBehalfAdmins() {
  return ON_BEHALF_ADMINS.map((admin) => ({
    id: admin.email,
    name: admin.name,
    email: admin.email,
    firstName: firstNameFromAdmin(admin),
    away: false,
    hasInboxSeat: true,
  }));
}

export async function listIntercomAdmins(token) {
  if (adminCache.admins && Date.now() < adminCache.expiresAt) {
    return adminCache.admins;
  }

  const res = await fetch("https://api.intercom.io/admins", {
    method: "GET",
    headers: intercomHeaders(token),
  });
  if (!res.ok) {
    throw new Error(`Intercom List Admins Failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  const allowed = new Map(
    ALLOWED_ON_BEHALF_EMAILS.map((email, index) => [email.toLowerCase(), index])
  );
  const admins = Array.isArray(data.admins) ? data.admins : [];
  const filtered = admins
    .filter((admin) => admin && admin.id && admin.email && admin.type !== "bot")
    .filter((admin) => allowed.has(String(admin.email).toLowerCase()))
    .map((admin) => ({
      id: String(admin.id),
      name: admin.name || admin.email,
      email: admin.email,
      firstName: firstNameFromAdmin(admin),
      away: Boolean(admin.away_mode_enabled),
      hasInboxSeat: admin.has_inbox_seat !== false,
    }))
    .sort(
      (a, b) =>
        allowed.get(a.email.toLowerCase()) - allowed.get(b.email.toLowerCase())
    );

  adminCache = { admins: filtered, expiresAt: Date.now() + ADMIN_CACHE_TTL_MS };
  return filtered;
}

export function resolveAdmin(admins, { adminId, senderEmail } = {}) {
  if (!admins?.length) return null;
  if (adminId) {
    const needle = String(adminId).toLowerCase();
    return (
      admins.find(
        (admin) =>
          String(admin.id).toLowerCase() === needle ||
          String(admin.email).toLowerCase() === needle
      ) || null
    );
  }
  const email = String(senderEmail || DEFAULT_ADMIN_EMAIL).trim().toLowerCase();
  const match = admins.find((admin) => admin.email.toLowerCase() === email);
  if (match) return match;
  if (senderEmail) return null;
  return admins[0] || null;
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
