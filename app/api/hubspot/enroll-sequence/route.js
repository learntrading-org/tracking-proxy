// app/api/hubspot/enroll-sequence/route.js
import { NextResponse } from "next/server";

// Default Bullmania HubSpot User ID (hubspot@bullmania.com)
const DEFAULT_HUBSPOT_USER_ID = "84285656";

// Known sequence labels for clearer alert messaging
const SEQUENCE_NAMES = {
  "628348137": "Discord Moneyline Reminder",
  "615158993": "First 1-on-1 reachout",
};

/**
 * Sends a formatted error alert to the internal Slack channel via SLACK_DOCUSEAL_WEBHOOK
 */
async function sendSlackErrorAlert({
  errorMessage,
  contactId,
  email,
  sequenceId,
  senderEmail,
  objectType,
  objectId,
  details,
}) {
  const slackWebhook = process.env.SLACK_DOCUSEAL_WEBHOOK;
  if (!slackWebhook) {
    console.warn("SLACK_DOCUSEAL_WEBHOOK is not configured. Skipping Slack alert.");
    return;
  }

  try {
    const sequenceLabel = SEQUENCE_NAMES[sequenceId]
      ? `${sequenceId} (${SEQUENCE_NAMES[sequenceId]})`
      : sequenceId || "N/A";

    const fields = [
      {
        title: "Error Message",
        value: String(errorMessage || "Unknown error"),
        short: false,
      },
      {
        title: "Contact Email",
        value: String(email || "N/A"),
        short: true,
      },
      {
        title: "Contact ID",
        value: String(contactId || "N/A"),
        short: true,
      },
      {
        title: "Sequence",
        value: String(sequenceLabel),
        short: true,
      },
      {
        title: "Sender Email",
        value: String(senderEmail || "hello@bullmania.com"),
        short: true,
      },
    ];

    if (objectType || objectId) {
      fields.push({
        title: "Workflow Object",
        value: `${objectType || "Unknown"} (ID: ${objectId || "N/A"})`,
        short: true,
      });
    }

    if (details) {
      const detailStr =
        typeof details === "object"
          ? JSON.stringify(details, null, 2)
          : String(details);
      fields.push({
        title: "Technical Details",
        value: `\`\`\`${detailStr.slice(0, 1000)}\`\`\``,
        short: false,
      });
    }

    const slackPayload = {
      attachments: [
        {
          color: "#d9534f", // Danger / Red
          title: "🚨 HubSpot Sequence Enrollment Failed",
          fields: fields,
          footer: "Tracking Proxy • Sequence Enrollment Alert",
          ts: Math.floor(Date.now() / 1000),
        },
      ],
    };

    const slackResponse = await fetch(slackWebhook, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(slackPayload),
    });

    if (!slackResponse.ok) {
      const errText = await slackResponse.text();
      console.error("Failed to send Slack alert:", errText);
    } else {
      console.log("Slack error alert sent successfully.");
    }
  } catch (slackError) {
    console.error("Error dispatching Slack alert:", slackError);
  }
}

// Handle CORS preflight requests
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}

// Handle HubSpot Custom Workflow Action webhook for sequence enrollment
export async function POST(request) {
  let contactId;
  let email;
  let sequenceId;
  let senderEmail;
  let rawObjectType;
  let object = {};
  let contactLookupError = null;

  try {
    const payload = await request.json();
    console.log("Received HubSpot sequence enrollment webhook payload:", JSON.stringify(payload, null, 2));

    const fields = payload.fields || {};
    const inputFields = payload.inputFields || {};
    const typedInputs = payload.typedInputs || {};
    const properties = payload.properties || {};
    object = payload.object || {};

    // Helper to extract value across different HubSpot payload formats
    const getInputValue = (key) => {
      if (fields[key] !== undefined && fields[key] !== null && String(fields[key]).trim() !== "") {
        return fields[key];
      }
      if (inputFields[key] !== undefined && inputFields[key] !== null && String(inputFields[key]).trim() !== "") {
        return inputFields[key];
      }
      if (typedInputs[key]?.value !== undefined && typedInputs[key]?.value !== null && String(typedInputs[key]?.value).trim() !== "") {
        return typedInputs[key].value;
      }
      if (properties[key] !== undefined && properties[key] !== null && String(properties[key]).trim() !== "") {
        return properties[key];
      }
      if (payload[key] !== undefined && payload[key] !== null && String(payload[key]).trim() !== "") {
        return payload[key];
      }
      return undefined;
    };

    const token = process.env.HUBSPOT_ACCESS_TOKEN;
    if (!token) {
      const errorMessage = "Server configuration error: Missing HUBSPOT_ACCESS_TOKEN";
      console.error(errorMessage);
      await sendSlackErrorAlert({
        errorMessage,
        contactId,
        email,
        sequenceId,
        senderEmail,
        objectType: rawObjectType,
        objectId: object?.objectId,
      });
      return NextResponse.json(
        {
          outputFields: {
            status: "FAILED",
            message: errorMessage,
            enrollmentId: "",
          },
        },
        {
          status: 200,
          headers: {
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

    rawObjectType = String(object.objectType || object.objectTypeId || "").toUpperCase();
    const isExplicitContactObject =
      rawObjectType === "CONTACT" ||
      rawObjectType === "0-1" ||
      rawObjectType === "1";

    const isExplicitTicketObject =
      rawObjectType === "TICKET" ||
      rawObjectType === "0-5" ||
      rawObjectType === "5";

    const isExplicitDealObject =
      rawObjectType === "DEAL" ||
      rawObjectType === "0-3" ||
      rawObjectType === "3";

    // 1. Determine contactId
    contactId = getInputValue("contactId") || getInputValue("contact_id");

    // If the workflow object is specifically a Contact, object.objectId is the contactId
    if (!contactId && isExplicitContactObject && object.objectId) {
      contactId = object.objectId;
    }

    // 2. Extract email, sequenceId, and senderEmail
    email = getInputValue("email");
    sequenceId = getInputValue("sequenceId") || getInputValue("sequence_id");
    const rawSenderEmail = getInputValue("senderEmail") || getInputValue("sender_email");
    senderEmail =
      rawSenderEmail && typeof rawSenderEmail === "string" && rawSenderEmail.trim() !== ""
        ? rawSenderEmail.trim()
        : "hello@bullmania.com";

    // 3. If contactId is not yet resolved, search HubSpot by email
    if (!contactId && email && typeof email === "string" && email.trim() !== "") {
      console.log(`contactId not found in payload (objectType: ${rawObjectType || "unknown"}), searching HubSpot contact by email: ${email.trim()}`);
      try {
        const searchUrl = "https://api.hubapi.com/crm/v3/objects/contacts/search";
        const searchResponse = await fetch(searchUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            filterGroups: [
              {
                filters: [
                  {
                    propertyName: "email",
                    operator: "EQ",
                    value: email.trim(),
                  },
                ],
              },
            ],
            properties: ["email"],
          }),
        });

        if (searchResponse.ok) {
          const searchData = await searchResponse.json();
          if (searchData.results && searchData.results.length > 0) {
            contactId = searchData.results[0].id;
            console.log(`Found contactId ${contactId} for email ${email}`);
          } else {
            console.warn(`No contact found in HubSpot for email: ${email}`);
          }
        } else {
          const searchErrorText = await searchResponse.text();
          contactLookupError = `HubSpot Contacts Search API returned ${searchResponse.status}: ${searchErrorText}`;
          console.error("HubSpot Contacts Search API returned error:", searchErrorText);
        }
      } catch (searchError) {
        contactLookupError = `Contacts Search exception: ${searchError.message}`;
        console.error("Error executing HubSpot contact search:", searchError);
      }
    }

    // 4. If contactId is still not found and object is Ticket/Deal, check associations
    if (!contactId && object.objectId) {
      if (isExplicitTicketObject) {
        console.log(`Attempting to find contact associated with Ticket ID ${object.objectId}`);
        try {
          const assocUrl = `https://api.hubapi.com/crm/v3/objects/tickets/${object.objectId}/associations/contacts`;
          const assocResponse = await fetch(assocUrl, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (assocResponse.ok) {
            const assocData = await assocResponse.json();
            if (assocData.results && assocData.results.length > 0) {
              contactId = assocData.results[0].id;
              console.log(`Found associated contactId ${contactId} from Ticket ${object.objectId}`);
            }
          } else {
            const assocErr = await assocResponse.text();
            contactLookupError = `Ticket Associations API returned ${assocResponse.status}: ${assocErr}`;
          }
        } catch (assocError) {
          contactLookupError = `Ticket Associations exception: ${assocError.message}`;
          console.error("Error fetching ticket contact associations:", assocError);
        }
      } else if (isExplicitDealObject) {
        console.log(`Attempting to find contact associated with Deal ID ${object.objectId}`);
        try {
          const assocUrl = `https://api.hubapi.com/crm/v3/objects/deals/${object.objectId}/associations/contacts`;
          const assocResponse = await fetch(assocUrl, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (assocResponse.ok) {
            const assocData = await assocResponse.json();
            if (assocData.results && assocData.results.length > 0) {
              contactId = assocData.results[0].id;
              console.log(`Found associated contactId ${contactId} from Deal ${object.objectId}`);
            }
          } else {
            const assocErr = await assocResponse.text();
            contactLookupError = `Deal Associations API returned ${assocResponse.status}: ${assocErr}`;
          }
        } catch (assocError) {
          contactLookupError = `Deal Associations exception: ${assocError.message}`;
          console.error("Error fetching deal contact associations:", assocError);
        }
      } else if (!rawObjectType) {
        // Fallback if objectType is omitted entirely
        contactId = object.objectId;
      }
    }

    // Validate contactId
    if (!contactId) {
      let errorMessage = email
        ? `Contact not found in HubSpot for email: ${email}`
        : "Missing contactId and email in payload";
      if (contactLookupError) {
        errorMessage += ` (${contactLookupError})`;
      }
      console.warn(`Enrollment request rejected: ${errorMessage}`);
      await sendSlackErrorAlert({
        errorMessage,
        contactId: null,
        email,
        sequenceId,
        senderEmail,
        objectType: rawObjectType,
        objectId: object?.objectId,
        details: contactLookupError,
      });
      return NextResponse.json(
        {
          outputFields: {
            status: "FAILED",
            message: errorMessage,
            enrollmentId: "",
          },
        },
        {
          status: 200,
          headers: {
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

    // Validate sequenceId
    if (!sequenceId) {
      const errorMessage = "Missing sequenceId in payload";
      console.warn(`Enrollment request rejected: ${errorMessage}`);
      await sendSlackErrorAlert({
        errorMessage,
        contactId,
        email,
        sequenceId: null,
        senderEmail,
        objectType: rawObjectType,
        objectId: object?.objectId,
      });
      return NextResponse.json(
        {
          outputFields: {
            status: "FAILED",
            message: errorMessage,
            enrollmentId: "",
          },
        },
        {
          status: 200,
          headers: {
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

    // 5. Determine userId required by Sequences API query param
    const userId =
      process.env.HUBSPOT_USER_ID ||
      payload.origin?.userId ||
      DEFAULT_HUBSPOT_USER_ID;

    const stringContactId = String(contactId);
    const stringSequenceId = String(sequenceId);

    console.log(
      `Initiating sequence enrollment: contactId=${stringContactId}, sequenceId=${stringSequenceId}, senderEmail=${senderEmail}, userId=${userId}`
    );

    // Call HubSpot Sequences API with userId query parameter
    const enrollUrl = `https://api.hubapi.com/automation/sequences/2026-03/enrollments?userId=${encodeURIComponent(userId)}`;
    const enrollResponse = await fetch(enrollUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contactId: stringContactId,
        sequenceId: stringSequenceId,
        senderEmail: senderEmail,
      }),
    });

    if (!enrollResponse.ok) {
      const errorText = await enrollResponse.text();
      let parsedErrorMessage = errorText;
      let errorDetails = errorText;
      try {
        const errorJson = JSON.parse(errorText);
        if (Array.isArray(errorJson.errors) && errorJson.errors.length > 0) {
          const details = errorJson.errors.map((e) => e.message || JSON.stringify(e)).join("; ");
          parsedErrorMessage = `${errorJson.message || "Error"}: ${details}`;
        } else {
          parsedErrorMessage = errorJson.message || errorJson.error || errorText;
        }
        errorDetails = errorJson;
      } catch {
        // Use raw errorText if JSON parsing fails
      }

      console.error(
        `HubSpot Sequences API error (${enrollResponse.status}) for contact ${stringContactId}:`,
        parsedErrorMessage
      );

      await sendSlackErrorAlert({
        errorMessage: `HubSpot API Error (${enrollResponse.status}): ${parsedErrorMessage}`,
        contactId: stringContactId,
        email,
        sequenceId: stringSequenceId,
        senderEmail,
        objectType: rawObjectType,
        objectId: object?.objectId,
        details: errorDetails,
      });

      return NextResponse.json(
        {
          outputFields: {
            status: "FAILED",
            message: `HubSpot Error: ${parsedErrorMessage}`,
            enrollmentId: "",
          },
        },
        {
          status: 200,
          headers: {
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

    const enrollmentData = await enrollResponse.json();
    const enrollmentId = enrollmentData.id || enrollmentData.enrollmentId || "";

    console.log(
      `Successfully enrolled contact ${stringContactId} into sequence ${stringSequenceId}. Enrollment ID: ${enrollmentId}`
    );

    return NextResponse.json(
      {
        outputFields: {
          status: "SUCCESS",
          message: `Successfully enrolled contact into sequence ${stringSequenceId}`,
          enrollmentId: String(enrollmentId),
        },
      },
      {
        status: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (error) {
    console.error("Unexpected error in sequence enrollment endpoint:", error);
    await sendSlackErrorAlert({
      errorMessage: `Internal server error: ${error.message}`,
      contactId: typeof contactId !== "undefined" ? contactId : null,
      email: typeof email !== "undefined" ? email : null,
      sequenceId: typeof sequenceId !== "undefined" ? sequenceId : null,
      senderEmail: typeof senderEmail !== "undefined" ? senderEmail : null,
      objectType: typeof rawObjectType !== "undefined" ? rawObjectType : null,
      objectId: object?.objectId,
      details: error.stack || error.message,
    });

    return NextResponse.json(
      {
        outputFields: {
          status: "FAILED",
          message: `Internal server error: ${error.message}`,
          enrollmentId: "",
        },
      },
      {
        status: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }
}
