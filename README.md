# Tracking Proxy — API Automations

Next.js app that powers Bullmania’s integration automations. Most endpoints under `app/api` are called by **HubSpot workflows**, **iClosed webhooks**, **DocuSeal webhooks**, **payment providers**, or frontend tracking scripts. They glue together HubSpot, ConvertKit (Kit), Intercom, DocuSeal, ThriveCart, Slack, Wistia, Stripe, and Whop.

---

## Overview

| Area | Purpose |
|------|---------|
| **HubSpot** | Workflow custom actions, contact/ticket updates, tagging, agreements, utility math |
| **iClosed** | Call booking → ConvertKit tags, Intercom AI interaction tags, HubSpot contact sync |
| **ConvertKit** | Generic add/remove tag helpers (also used by frontends) |
| **Payments** | Stripe & Whop webhooks → Slack payment alerts |
| **Wistia** | Proxy for video stats (auth token stays server-side) |

Typical callers:

- HubSpot **Workflows** (webhook / custom code actions)
- **iClosed** booking webhooks
- **DocuSeal** signing event webhooks
- **Stripe** / **Whop** payment webhooks
- Landing pages / VSL embeds (CORS enabled on many routes)

---

## Environment variables

| Variable | Used by |
|----------|---------|
| `HUBSPOT_ACCESS_TOKEN` | HubSpot CRM read/write (contacts, tickets) |
| `CONVERTKIT_API_SECRET` | ConvertKit subscribe / tag / unsubscribe |
| `INTERCOM_ACCESS_TOKEN` | Intercom contacts, tags, events, conversations |
| `DOCUSEAL_API_TOKEN` | Create DocuSeal submissions |
| `SLACK_DOCUSEAL_WEBHOOK` | Slack alerts for agreement signing events |
| `THRIVECART_API_KEY` | Grant course access after agreement signed |
| `WISTIA_API_TOKEN` | Wistia media stats proxy |
| `STRIPE_SECRET_KEY` | Stripe SDK (webhook signature verification) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `WHOP_API_KEY` | Whop SDK |
| `WHOP_WEBHOOK_SECRET` | Whop webhook verification |
| `SLACK_PAYMENT_ALERTS_WEBHOOK_URL` | Slack channel for Stripe/Whop payment alerts |

---

## Endpoint reference

All paths are relative to the deployed app origin (e.g. `https://your-domain.com`).

---

### ConvertKit

#### `POST /api/convertkit/tag`

Add a ConvertKit tag to a subscriber (creates/subscribes if needed). Supports optional UTM custom fields.

**Conditions / gates**

| Step | Condition | Result |
|------|-----------|--------|
| 1 | Missing `email` or `tagId` | `400` |
| 2 | Invalid email format | `400` |
| 3 | Missing `CONVERTKIT_API_SECRET` | `500` |
| 4 | UTM present (object or root keys) | Included as ConvertKit custom fields |
| 5 | Empty / blank UTM values | Skipped (not written) |

**Body**

```json
{
  "email": "user@example.com",
  "tagId": "123456",
  "utm": {
    "utm_campaign": "...",
    "utm_content": "...",
    "utm_medium": "...",
    "utm_source": "..."
  }
}
```

UTM values may also be sent at the root of the body. Mapped into ConvertKit fields: `utm_campaign`, `utm_content`, `utm_medium`, `utm_source`.

---

#### `POST /api/convertkit/tag/remove`

Remove a ConvertKit tag from a subscriber.

**Conditions / gates**

| Step | Condition | Result |
|------|-----------|--------|
| 1 | Missing `email` or `tagId` | `400` |
| 2 | Invalid email format | `400` |
| 3 | Missing `CONVERTKIT_API_SECRET` | `500` |

**Body**

```json
{
  "email": "user@example.com",
  "tagId": "123456"
}
```

---

### iClosed

#### `POST /api/iclosed/webhook`

iClosed booking webhook. Runs several automations when an invitee books.

##### Entry conditions

| Condition | Action |
|-----------|--------|
| Payload empty / missing `payload[0]` | Return `200` success, no work |
| No `invitee.email` | Return `200` success, no work |
| `INTERCOM_ACCESS_TOKEN` missing | Skip Intercom AI check (log warning) |
| `CONVERTKIT_API_SECRET` missing | Skip all ConvertKit tagging; return `200` |

Always returns `200` to iClosed when possible (failures are logged so iClosed does not retry endlessly).

##### Pipeline (runs in order)

```text
Webhook received (payload[0])
│
├─ No invitee email? ──────────────────────────► stop (200)
│
├─ [A] Intercom AI interaction check  (if token set)
│
├─ No ConvertKit secret? ──────────────────────► stop (200)
│
├─ [B] Strategy / quiz-review ConvertKit tag  (by event slug)
│
└─ [C] Assignee ConvertKit tags
       ├─ [C1] Mechanical Rules / Strategy Call / Quiz Review assignees
       └─ [C2] Discovery call assignees
```

---

##### [A] Intercom AI interaction check

**When it runs:** Always (if Intercom token is set), for any booked event that has an invitee email.

**How it decides to tag**

```text
Look up Intercom contact by email and/or phone
│
├─ No contacts found ──────────────────────────► stop
│
└─ For each contact (up to 5 recent conversations):
     Walk conversation timeline (source + parts)
     │
     ├─ Did a bot speak, then a user reply after?
     │     NO  ──────────────────────────────► no tag for this conversation
     │     YES
     │      │
     │      ├─ channel === "whatsapp"
     │      │     → Intercom tag 13115759  (Call Booked WA)
     │      │
     │      └─ channel in:
     │           "email" | "customer_initiated" | "chat" | "admin_initiated"
     │           → Intercom tag 13115760  (Call Booked Email)
     │
     └─ Stops tagging once both WA + Email tags applied for that contact
```

| Condition | Tag | Meaning |
|-----------|-----|---------|
| User replied after bot **and** channel is `whatsapp` | `13115759` | Call Booked WA |
| User replied after bot **and** channel is email/chat-like | `13115760` | Call Booked Email |
| No bot → user reply sequence found | — | No Intercom tag |

Phone sources (first available): `invitee.text_notification_phone` → `invitee.phone` → `invitee.mobile`.

---

##### [B] Strategy / quiz-review ConvertKit tag (event slug)

**Field monitored:** `event_type.slug`

| Condition | Action |
|-----------|--------|
| slug **includes** `mechanical-rules-strategy` | ConvertKit tag `11470881` |
| slug **includes** `strategy-call` | ConvertKit tag `11470881` |
| slug **includes** `quiz-review` | ConvertKit tag `11470881` |
| None of the above | Skip this block |

```text
slug includes "mechanical-rules-strategy"
  OR "strategy-call"
  OR "quiz-review"
  YES → tag 11470881
  NO  → no strategy/quiz-review tag
```

---

##### [C] Assignee-based ConvertKit tags

**Fields monitored:**

| Field | Role |
|-------|------|
| `event.extended_assigned_to` | Object of assigned users; first user with an `email` is used |
| `event_type.name` | Event name string (lowercased for matching) |

If no assignee email can be resolved → skip all assignee logic.

---

##### [C1] Mechanical Rules / Strategy Call / Quiz Review assignees

**Event name filter (`event_type.name`, case-insensitive):**

```text
(
  name includes "mechanical rules"
  AND name does NOT include "review"
)
OR
(
  name includes "strategy call"
)
OR
(
  name includes "quiz review"
)
```

| Passes filter? | Assignee email | ConvertKit tag |
|----------------|----------------|----------------|
| Yes | `james@bullmania.com` | `11873105` |
| Yes | `phil@bullmania.com` | `11873106` |
| Yes | `cailum@bullmania.com` | `12824071` |
| Yes | Any other email | No tag |
| No (e.g. “Mechanical Rules Review”) | — | Skip this block |

Examples:

| Event name | Tagging runs? | Why |
|------------|---------------|-----|
| Mechanical Rules Strategy | Yes | includes “mechanical rules”, not “review” |
| Mechanical Rules Review | No | includes “mechanical rules” **and** “review” → excluded |
| Strategy Call with James | Yes | includes “strategy call” |
| Quiz Review | Yes | includes “quiz review” (explicit allow) |
| Discovery Call | No (for C1) | handled in C2 only |

> **Note:** “Mechanical Rules Review” is still excluded by the `mechanical rules` + `not review` rule. “Quiz Review” is allowed via its own `quiz review` branch.

---

##### [C2] Discovery call assignees

**Event name filter:** `event_type.name` (lowercased) **includes** `"discovery"`.

| Passes filter? | Assignee email | ConvertKit tag |
|----------------|----------------|----------------|
| Yes | `jeremy@bullmania.com` | `20825718` |
| Yes | Any other email | No tag |
| No | — | Skip this block |

C1 and C2 are independent: a name that matched C1 can also match C2 if it includes `"discovery"`.

---

##### Full condition summary (ConvertKit tags)

| Tag ID | Applied when |
|--------|--------------|
| `11470881` | `event_type.slug` contains `mechanical-rules-strategy` **or** `strategy-call` **or** `quiz-review` |
| `11873105` | Event name is Mechanical Rules (not Review), Strategy Call, **or** Quiz Review, **and** assignee is James |
| `11873106` | Same event filter, assignee is Phil |
| `12824071` | Same event filter, assignee is Cailum |
| `20825718` | Event name contains `discovery`, assignee is Jeremy |

Multiple tags can apply on a single booking (e.g. strategy/quiz-review slug tag + assignee tag).

---

#### `POST /api/iclosed/hubspot-webhook`

Syncs iClosed booking contacts into HubSpot.

##### Entry conditions

| Condition | Action |
|-----------|--------|
| Empty payload | Return `200`, no work |
| No email found (`contact` / `invitee` / root) | Return `200`, skip (“no email found”) |
| Missing `HUBSPOT_ACCESS_TOKEN` | `500` |

##### Contact branch

```text
Search HubSpot by email
│
├─ Contact EXISTS
│     For each of: firstname, lastname, phone, utm_campaign, utm_content, utm_medium, utm_source
│       Update ONLY if new value is present AND different from current HubSpot value
│     No differing fields? → skip PATCH
│
└─ Contact MISSING
      Create with email + any provided name / phone / UTMs
```

Accepts single-object or array payloads; contact data is read from `contact`, `invitee`, or root. UTMs are read from `tracking` or root-level UTM keys.

---

### HubSpot — CRM & workflow helpers

#### `POST /api/hubspot/update-contact`

Patch HubSpot contact properties by ID.

**Conditions**

| Condition | Result |
|-----------|--------|
| Missing `contactId` or `properties` | `400` |
| Missing token | `500` |
| Otherwise | PATCH contact |

**Body**

```json
{
  "contactId": "12345",
  "properties": {
    "firstname": "Jane",
    "phone": "+1..."
  }
}
```

---

#### `POST /api/hubspot/update-ticket`

HubSpot workflow action: for the enrolled contact, find associated tickets in a given pipeline and move them to a new stage.

**Conditions**

| Step | Condition | Result |
|------|-----------|--------|
| 1 | Missing `contactId`, `target_pipeline_id`, or `new_stage_id` | Error |
| 2 | No tickets associated with contact | Return message, no update |
| 3 | Tickets exist but none in `target_pipeline_id` | Return message, no update |
| 4 | Ticket(s) match target pipeline | Set `hs_pipeline_stage` → `new_stage_id` |

```text
Contact enrolled
  → fetch associated tickets
  → keep only tickets where hs_pipeline === target_pipeline_id
  → batch-update those tickets to new_stage_id
```

**Body (workflow-style)**

```json
{
  "object": { "objectId": "<contactId>" },
  "inputFields": {
    "target_pipeline_id": "...",
    "new_stage_id": "..."
  }
}
```

---

#### `POST /api/hubspot/post-contact-data`

Sync lead email/phone into Intercom and trigger outbound messaging.

**Conditions / decision tree**

```text
Require email (else 400)
│
├─ Search Intercom by email
│
├─ Contact missing?
│     YES → create with email (+ phone if valid)
│           Phone rejected (422)? → retry create without phone
│     NO  → if no existing phone and valid new phone → update phone
│
├─ Tag decision:
│     phoneSaved === true  → tag 13041517  (WhatsApp Connect)
│     phoneSaved === false → tag 13041640  (Lead Email)
│
└─ Always (if contactId): fire event "outbound_message_trigger"
     Event failure is logged but does not fail the request
```

| Condition | Tag / action |
|-----------|--------------|
| Phone saved on contact | `13041517` WhatsApp Connect |
| Phone missing / rejected | `13041640` Lead Email |
| Contact created or found | Event `outbound_message_trigger` |

Phone formatting: strip non-digits except `+`; convert `00…` prefix to `+…`; require length ≥ 7.

**Body**

```json
{
  "inputFields": { "email": "...", "phone": "..." }
}
```

(or top-level `email` / `phone`)

---

#### `POST /api/hubspot/add-intercom-tag`

Find or create Intercom contact by email, then apply a tag.

**Conditions**

| Condition | Result |
|-----------|--------|
| Missing `email` | `400` |
| Missing `tag_id` | `400` |
| Contact not found | Create user, then tag |
| Contact found | Tag existing contact |

**Body**

```json
{
  "inputFields": { "email": "...", "tag_id": "..." }
}
```

---

#### `POST /api/hubspot/add-convertkit-tag`

Apply a ConvertKit tag by email (HubSpot workflow helper).

**Conditions**

| Condition | Result |
|-----------|--------|
| Missing `email` or `tag_id` | `400` |
| Invalid email | `400` |
| Otherwise | Subscribe + tag |

**Body**

```json
{
  "inputFields": { "email": "...", "tag_id": "..." }
}
```

---

#### `POST /api/hubspot/tag-no-show`

Tags a no-show lead in ConvertKit with tag `14879158` (creates subscriber if needed).

**Conditions**

| Condition | Result |
|-----------|--------|
| Missing / invalid email | `400` |
| Missing ConvertKit secret | `500` |
| Subscriber exists or not | Still subscribe+tag (works for both) |

**Body:** `email` (or `inputFields.email` / `properties.email`)

---

#### `POST /api/hubspot/tag-deal-lost`

Tags a lost deal lead in ConvertKit with tag `14931298`.

**Conditions:** same email gates as `tag-no-show`.

---

#### `POST /api/hubspot/crypto-renewal-email`

Triggers crypto renewal email sequence in ConvertKit (tag `12168728`).

**Flow (always both steps when secret is set)**

```text
1. Unsubscribe email from tag 12168728   (reset; failure only logged)
2. Subscribe email to tag 12168728
     + first_name
     + fields.renewal_price
     + fields.billing
```

**Body**

```json
{
  "fields": {
    "firstName": "...",
    "price": "...",
    "billing": "...",
    "email": "..."
  }
}
```

---

#### `POST /api/hubspot/vsl-video-watch`

Tracks VSL watch progress on HubSpot contact property `vsl_video_watch` (stored as 0–1 decimal).

**Conditions**

| Condition | Result |
|-----------|--------|
| Missing `email` or `percentage` | `400` |
| Contact **exists** | Update only if `percentage/100` **>** current `vsl_video_watch` (or property unset) |
| Contact **exists**, new % is lower/equal | Keep existing watch %; still write UTM fields if present |
| Contact **missing** | Create contact with email, `vsl_video_watch = percentage/100`, UTMs |
| UTM keys empty/blank | Not written |

```text
Search by email
│
├─ Found
│     newWatch = percentage / 100
│     if newWatch > current OR current unset → update vsl_video_watch
│     always merge non-empty UTMs into update when present
│
└─ Not found
      create contact (email + watch decimal + UTMs)
```

**Body**

```json
{
  "email": "user@example.com",
  "percentage": 75,
  "utm": { "utm_source": "...", "utm_medium": "...", "utm_campaign": "...", "utm_content": "..." }
}
```

---

#### `POST /api/hubspot/webhook`

Generic webhook sink: logs payload and returns success. **No conditions, no side effects.**

---

### HubSpot — workflow math utilities

These return HubSpot custom-action style `outputFields`.

#### `POST /api/hubspot/basic-math`

**Operator conditions**

| `operator` | Formula | Special case |
|------------|---------|--------------|
| `add` | `n1 + n2` | — |
| `subtract` | `n1 - n2` | — |
| `multiply` | `n1 * n2` | — |
| `divide` | `n1 / n2` | `n2 === 0` → result `0` |
| anything else | — | Error / `500` |

Missing numbers default to `0`. Result rounded to 2 decimals.

```json
{
  "fields": {
    "number1": 10,
    "number2": 3,
    "operator": "add | subtract | multiply | divide"
  }
}
```

→ `{ "outputFields": { "result": 13 } }`

---

#### `POST /api/hubspot/amount-captured-sum`

Always: `updated_captured_this_far = captured_this_far + payment_amount` (parse float, default 0, 2 decimals).

```json
{
  "fields": {
    "captured_this_far": 100,
    "payment_amount": 50
  }
}
```

→ `{ "outputFields": { "updated_captured_this_far": 150 } }`

---

#### `POST /api/hubspot/vat-free-price`

| Condition | Result |
|-----------|--------|
| `amount` or `vat` not parseable as number | `500` |
| Valid | `vat_free_price = amount / (1 + vat/100)` (2 decimals) |

```json
{
  "fields": {
    "amount": 120,
    "vat": 20
  }
}
```

→ `{ "outputFields": { "vat_free_price": 100 } }`

---

### HubSpot — DocuSeal agreements

#### `POST /api/hubspot/docuseal-agreement`

Sends the standard **Bullmania Platinum Agreement** via DocuSeal (template ID `301737`).

**Conditions**

| Condition | Result |
|-----------|--------|
| Missing `DOCUSEAL_API_TOKEN` | `500` |
| `firstName` present | Prefill FIRST NAME / LAST NAME fields; set submitter name |
| Always | Create submission for template `301737`, role `Platinum Signer`, `send_email: true` |

**Body**

```json
{
  "fields": {
    "email": "...",
    "firstName": "...",
    "lastName": "..."
  }
}
```

---

#### `POST /api/hubspot/docuseal-agreement/webhook-alerts`

DocuSeal webhook for the **standard** Platinum agreement only.

##### Template filter (first gate)

| Condition | Result |
|-----------|--------|
| `data.template.id === 301737` | Process |
| Any other template ID | Return `{ status: "ignored" }` — no Slack, no side effects |

##### Events monitored

All of the following event types are handled for Slack alerting. Only **`form.completed`** runs the full post-sign integrations.

| `event_type` | Slack label | Slack color | Post-sign integrations? |
|--------------|-------------|-------------|-------------------------|
| `form.viewed` | Form Viewed | blue | No |
| `form.started` | Form Started | blue | No |
| `form.completed` | Form Completed (Signed) | green | **Yes** |
| `form.declined` | Form Declined | red | No |
| `submission.created` | Submission Created | blue | No |
| `submission.completed` | Submission Completed | green | No* |
| `submission.expired` | Submission Expired | red | No |
| `submission.archived` | Submission Archived | gray | No |
| unknown | raw event type string | gray | No |

\* Integrations are gated specifically on `event_type === "form.completed"`, not `submission.completed`.

##### Decision tree

```text
DocuSeal webhook
│
├─ template.id !== 301737 ────────────────────► ignored
│
├─ ALWAYS: Slack alert
│     email, template, first/last name, country, submission URL
│
└─ ONLY if event_type === "form.completed" AND valid email:
      │
      ├─ [1] HubSpot PATCH (if any of country / firstName / lastName present)
      │       properties: country, firstname, lastname
      │
      ├─ [2] ThriveCart enroll course 187845  (if THRIVECART_API_KEY set)
      │
      ├─ [3] ConvertKit tag 11448082           (if CONVERTKIT_API_SECRET set)
      │
      └─ [4] Second Slack message
            ThriveCart/ConvertKit failed? → red “Integration Errors”
            All ok? → green “Access Granted”
                      (manual reminder: grant platinum course bundle)
```

| Integration | When | Condition for skip |
|-------------|------|--------------------|
| Slack (event) | Every allowed event | Missing webhook URL fails open (logged) |
| HubSpot update | `form.completed` | No email, or no name/country values |
| ThriveCart course `187845` | `form.completed` | No API key |
| ConvertKit tag `11448082` | `form.completed` | No API secret |
| Slack (access granted / errors) | `form.completed` | No Slack webhook |

---

#### `POST /api/hubspot/custom-docuseal-agreement`

Sends a **custom Platinum Agreement** built from a DOCX template (`template.docx` in the route folder) via DocuSeal DOCX API.

**Conditions**

| Condition | Result |
|-----------|--------|
| Missing `DOCUSEAL_API_TOKEN` | `500` |
| Fee present / numeric | Format as USD currency |
| End date present / parseable | Format as e.g. `January 15, 2026` |
| Deliverables array / JSON / newlines | Convert to HTML `<ul><li>…</li></ul>` |
| Always | `external_id: BULLMANIA_CUSTOM_AGREEMENT`, email signer |

**Body (`fields`)**

| Field | Description |
|-------|-------------|
| `email` | Signer email |
| `firstName` / `lastName` | Pre-filled name fields |
| `program_fee` / `PROGRAM_FEE` | Formatted as USD currency |
| `end_date` / `END_DATE` | Formatted long date |
| `program_deliverables` | Array or newline/JSON string → HTML list |

---

#### `POST /api/hubspot/custom-docuseal-agreement/webhook-alerts`

Same post-sign pipeline as the standard agreement alerts, but filtered to **custom** agreements.

##### Agreement filter (first gate)

Process only if **any** of:

| Check | Value |
|-------|--------|
| `data.external_id` | `BULLMANIA_CUSTOM_AGREEMENT` |
| `data.submission.external_id` | `BULLMANIA_CUSTOM_AGREEMENT` |
| `data.template.name` | `BULLMANIA CUSTOM AGREEMENT` |
| `data.submission.name` | `BULLMANIA CUSTOM AGREEMENT` |
| `data.name` | `BULLMANIA CUSTOM AGREEMENT` |

Otherwise → `{ status: "ignored" }`.

##### Events monitored

Same event map as standard alerts (`form.viewed`, `form.started`, `form.completed`, `form.declined`, `submission.*`).

| Event | Slack | HubSpot + ThriveCart + ConvertKit |
|-------|-------|-----------------------------------|
| All listed events | Yes | No |
| **`form.completed` only** | Yes (+ follow-up Slack) | Yes |

##### Post-sign actions (`form.completed` only)

Same as standard:

1. HubSpot update `country` / `firstname` / `lastname` (if present)
2. ThriveCart course `187845`
3. ConvertKit tag `11448082`
4. Slack access-granted or error follow-up

---

### Payments

Payment-provider webhooks under `app/api/payments`. Both post alerts to the same Slack channel (`SLACK_PAYMENT_ALERTS_WEBHOOK_URL`). They do **not** update HubSpot/ConvertKit — Slack notification only.

#### `POST /api/payments/stripe/webhook`

Stripe webhook. Verifies signature, then alerts Slack on failed payments.

**Entry conditions**

| Condition | Result |
|-----------|--------|
| Invalid / missing Stripe signature | `400` Webhook Error |
| Valid event | Continue |
| Event type **not** in monitored list | Return `200` (no Slack) |

**Events monitored**

| `event.type` | Action |
|--------------|--------|
| `invoice.payment_failed` | Slack payment-failed alert |
| `payment_intent.payment_failed` | Slack payment-failed alert |
| Any other Stripe event | Acknowledged (`200`), no alert |

**Alert content (Slack text)**

| Field | Source |
|-------|--------|
| Type | `event.type` |
| Amount | `amount_due` or `amount` (÷ 100) + currency |
| Customer | `customer_email` or `email` (fallback: `Unknown Email`) |
| Error | `last_payment_error.message` (or default message) |
| ID | object `id` |

```text
Stripe webhook
│
├─ Signature invalid ──────────────────────────► 400
│
├─ type in { invoice.payment_failed, payment_intent.payment_failed }
│     YES → post Slack alert (requires SLACK_PAYMENT_ALERTS_WEBHOOK_URL)
│     NO  → no-op
│
└─ Always return 200 if signature OK
```

**Env:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SLACK_PAYMENT_ALERTS_WEBHOOK_URL`

---

#### `POST /api/payments/whop/webhook`

Whop webhook. Unwraps/verifies payload, then alerts Slack on payment lifecycle events.

**Entry conditions**

| Condition | Result |
|-----------|--------|
| Unwrap / verification fails | `400` Webhook Error |
| Valid event | Continue |
| Event type **not** in monitored list | Return `200` (no Slack) |

**Events monitored**

| `webhookData.type` | Slack title | Emoji |
|--------------------|-------------|-------|
| `payment.succeeded` | Whop Payment Succeeded | ✅ |
| `payment.failed` | Whop Payment Failed | ❌ |
| `refund.created` | Whop Refund Created | 💸 |
| `dispute.created` | Whop Dispute Created | ⚠️ |
| Any other Whop event | — | No alert |

**Alert content (Slack Block Kit)**

| Field | Source / notes |
|-------|----------------|
| Type | event type |
| Amount | `amount` (÷ 100) + currency (`USD` default); label varies by event |
| Customer | username/email if present (omitted if neither available) |
| ID | resource `id` |

```text
Whop webhook
│
├─ Signature / unwrap fails ───────────────────► 400
│
├─ type in {
│     payment.succeeded,
│     payment.failed,
│     refund.created,
│     dispute.created
│   }
│     YES → post Slack Block Kit alert
│     NO  → no-op
│
└─ Always return 200 if verification OK
```

**Env:** `WHOP_API_KEY`, `WHOP_WEBHOOK_SECRET`, `SLACK_PAYMENT_ALERTS_WEBHOOK_URL`

---

### Wistia

#### `GET /api/wistia/stats`

Server-side proxy to Wistia media stats by date. Keeps `WISTIA_API_TOKEN` off the client. Responses cached for 1 hour.

**Conditions**

| Condition | Result |
|-----------|--------|
| Missing `mediaId` | `400` |
| Missing `WISTIA_API_TOKEN` | `500` |
| `start_date` / `end_date` present | Forwarded to Wistia query |

| Param | Required | Description |
|-------|----------|-------------|
| `mediaId` | yes | Wistia media ID |
| `start_date` | no | Start of range |
| `end_date` | no | End of range |

Example: `/api/wistia/stats?mediaId=abc123&start_date=2026-01-01&end_date=2026-01-31`

---

## Key automation flows (at a glance)

```text
Call booked (iClosed)
  → /api/iclosed/webhook
      IF invitee email present:
        → Intercom: tag if user replied to bot (WA vs Email channel)
        → ConvertKit: IF slug matches strategy / strategy-call / quiz-review → tag 11470881
        → ConvertKit: IF event name = MR (not review) OR strategy call OR quiz review
              AND assignee James/Phil/Cailum → assignee tags
        → ConvertKit: IF event name includes "discovery"
              AND assignee Jeremy → discovery tag
  → /api/iclosed/hubspot-webhook
      IF email present → create or update HubSpot contact (diff-only update)

Payment events
  → /api/payments/stripe/webhook
      IF payment failed (invoice or payment_intent) → Slack alert
  → /api/payments/whop/webhook
      IF payment.succeeded | payment.failed | refund.created | dispute.created → Slack alert

Lead captured (HubSpot workflow)
  → /api/hubspot/post-contact-data
      IF phone saved → WhatsApp tag ELSE Lead Email tag
      ALWAYS fire outbound_message_trigger

No-show / deal lost (HubSpot)
  → /api/hubspot/tag-no-show | tag-deal-lost
      IF valid email → ConvertKit tags 14879158 / 14931298

Agreement send (HubSpot)
  → /api/hubspot/docuseal-agreement | custom-docuseal-agreement
      → DocuSeal emails signer

Agreement signed (DocuSeal webhook)
  → .../webhook-alerts
      IF template/external_id matches:
        ALWAYS Slack for monitored events
        IF form.completed:
          HubSpot update + ThriveCart 187845 + ConvertKit 11448082
          + Slack access/error follow-up

VSL progress (frontend)
  → /api/hubspot/vsl-video-watch
      IF new % > stored % → update HubSpot vsl_video_watch
```

---

## Local development

```bash
pnpm install
pnpm dev
```

Set the env vars above in `.env.local` (or your host’s secret store in production). Restart after changing secrets.

---

## Project layout

```text
app/api/
  convertkit/tag/                 # Add / remove ConvertKit tags
  hubspot/                        # Workflow actions, CRM, agreements
  iclosed/                        # Booking webhooks
  payments/
    stripe/webhook/               # Stripe payment-failed → Slack
    whop/webhook/                 # Whop payment lifecycle → Slack
  wistia/stats/                   # Media stats proxy
```
