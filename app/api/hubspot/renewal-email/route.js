import { NextResponse } from "next/server";
import {
  CORS_HEADERS,
  addHubSpotNote,
  displayFirstName,
  draftIntercomNote,
  findOrCreateIntercomContact,
  formatAmount,
  formatDate,
  getInputValue,
  isWorkflowPayload,
  listIntercomAdmins,
  parseAmount,
  renderRenewalEmail,
  resolveAdmin,
  sendIntercomEmail,
  textToHtml,
} from "./lib";

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: CORS_HEADERS });
}

function workflowResponse(outputFields, status = 200) {
  return NextResponse.json(
    { outputFields },
    { status, headers: CORS_HEADERS }
  );
}

export async function POST(request) {
  let workflow = false;
  let contactId;
  let email;
  let mode = "send";

  try {
    const payload = await request.json();
    workflow = isWorkflowPayload(payload);

    const rawMode = String(
      payload.mode || getInputValue(payload, "mode") || ""
    ).toLowerCase();

    // Workflow crypto action is draft-only until support is ready to send.
    if (workflow) {
      mode = "draft";
    } else if (rawMode === "preview" || rawMode === "draft" || rawMode === "send") {
      mode = rawMode;
    }

    email = String(
      getInputValue(payload, "email") || payload.email || ""
    ).trim();
    const firstNameRaw =
      getInputValue(payload, "firstName") ||
      getInputValue(payload, "firstname") ||
      payload.firstName ||
      "";
    const price =
      getInputValue(payload, "price") ??
      payload.price ??
      "";
    const renewalDate =
      getInputValue(payload, "renewalDate") ||
      getInputValue(payload, "renewal_date") ||
      payload.renewalDate ||
      payload.renewal_date;
    const checkoutLink =
      getInputValue(payload, "checkoutLink") ||
      payload.checkoutLink ||
      "";
    const templateId = workflow
      ? "crypto"
      : getInputValue(payload, "templateId") || payload.templateId || "crypto";
    const adminId = payload.adminId || getInputValue(payload, "adminId");
    const senderEmail =
      getInputValue(payload, "senderEmail") ||
      getInputValue(payload, "sender_email") ||
      payload.senderEmail;
    contactId =
      payload.contactId ||
      getInputValue(payload, "contactId") ||
      (payload.object?.objectId && workflow ? payload.object.objectId : undefined);

    const customSubject = payload.subject;
    const customBody = payload.body;

    if (!email) {
      const message = "Email is required";
      return workflow
        ? workflowResponse({ status: "FAILED", message, mode })
        : NextResponse.json({ error: message }, { status: 400, headers: CORS_HEADERS });
    }

    if (!parseAmount(price) && !String(price).trim()) {
      const message = "Price is required";
      return workflow
        ? workflowResponse({ status: "FAILED", message, mode, email })
        : NextResponse.json({ error: message }, { status: 400, headers: CORS_HEADERS });
    }

    const rendered = renderRenewalEmail({
      templateId,
      firstName: firstNameRaw,
      price,
      renewalDate,
      checkoutLink,
    });
    const subject = String(customSubject || rendered.subject).trim();
    const body = String(customBody || rendered.body).trim();
    const html = customBody ? textToHtml(body) : rendered.html;

    if (mode === "preview") {
      return NextResponse.json(
        {
          status: "SUCCESS",
          mode,
          subject,
          body,
          html,
          amount: rendered.amount,
          renewalDateLabel: rendered.renewalDateLabel,
          templateId: rendered.templateId,
        },
        { status: 200, headers: CORS_HEADERS }
      );
    }

    const intercomToken = process.env.INTERCOM_ACCESS_TOKEN;
    if (!intercomToken) {
      const message = "Server configuration error: Missing INTERCOM_ACCESS_TOKEN";
      return workflow
        ? workflowResponse({ status: "FAILED", message, mode, email })
        : NextResponse.json({ error: message }, { status: 500, headers: CORS_HEADERS });
    }

    const admins = await listIntercomAdmins(intercomToken);
    const admin = resolveAdmin(admins, { adminId, senderEmail });
    if (!admin) {
      const message = "Could not resolve an Intercom teammate to send on behalf of";
      return workflow
        ? workflowResponse({ status: "FAILED", message, mode, email })
        : NextResponse.json({ error: message }, { status: 400, headers: CORS_HEADERS });
    }

    const contact = await findOrCreateIntercomContact(intercomToken, {
      email,
      firstName: displayFirstName(firstNameRaw),
    });

    if (contact.unsubscribed_from_emails && mode === "send") {
      const message = "Contact is unsubscribed from Intercom emails";
      return workflow
        ? workflowResponse({
            status: "FAILED",
            message,
            mode,
            email,
            intercomContactId: contact.id,
          })
        : NextResponse.json({ error: message }, { status: 400, headers: CORS_HEADERS });
    }

    let intercomResult;
    if (mode === "draft") {
      intercomResult = await draftIntercomNote(intercomToken, {
        admin,
        contact,
        subject,
        body,
      });
    } else {
      intercomResult = await sendIntercomEmail(intercomToken, {
        admin,
        contact,
        subject,
        html,
      });
    }

    const hubspotNote = [
      mode === "draft" ? "Drafted" : "Sent",
      "Intercom renewal email",
      `on behalf of ${admin.name}.`,
      `Subject: ${subject}`,
      `Amount: ${formatAmount(price) || price}`,
      formatDate(renewalDate) ? `Renewal date: ${formatDate(renewalDate)}` : "",
      "",
      body,
    ]
      .filter(Boolean)
      .join("\n");

    await addHubSpotNote(
      process.env.HUBSPOT_ACCESS_TOKEN,
      contactId,
      hubspotNote
    );

    const successMessage =
      mode === "draft"
        ? `Draft saved in Intercom for ${email} on behalf of ${admin.name}`
        : `Email sent to ${email} on behalf of ${admin.name}`;

    if (workflow) {
      return workflowResponse({
        status: "SUCCESS",
        message: successMessage,
        mode,
        email,
        intercomContactId: contact.id,
        intercomId: intercomResult?.id || "",
        adminEmail: admin.email,
      });
    }

    return NextResponse.json(
      {
        status: "SUCCESS",
        message: successMessage,
        mode,
        subject,
        body,
        intercomContactId: contact.id,
        intercomId: intercomResult?.id || "",
        admin: { id: admin.id, name: admin.name, email: admin.email },
      },
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (error) {
    console.error("Renewal email error:", error);
    const message = error.message || "Internal server error";
    if (workflow) {
      return workflowResponse({
        status: "FAILED",
        message,
        mode,
        email: email || "",
      });
    }
    return NextResponse.json(
      { error: message },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
