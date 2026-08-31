// app/api/hubspot/enroll-sequence/route.js
import { NextResponse } from "next/server";

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
  try {
    const payload = await request.json();
    console.log("Received HubSpot sequence enrollment webhook payload:", JSON.stringify(payload, null, 2));

    const fields = payload.fields || {};
    const inputFields = payload.inputFields || {};
    const typedInputs = payload.typedInputs || {};
    const properties = payload.properties || {};
    const object = payload.object || {};

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
      console.error("Missing HUBSPOT_ACCESS_TOKEN environment variable");
      return NextResponse.json(
        {
          outputFields: {
            status: "FAILED",
            message: "Server configuration error: Missing HUBSPOT_ACCESS_TOKEN",
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

    const rawObjectType = String(object.objectType || object.objectTypeId || "").toUpperCase();
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
    let contactId = getInputValue("contactId") || getInputValue("contact_id");

    // If the workflow object is specifically a Contact, object.objectId is the contactId
    if (!contactId && isExplicitContactObject && object.objectId) {
      contactId = object.objectId;
    }

    // 2. Extract email, sequenceId, and senderEmail
    const email = getInputValue("email");
    const sequenceId = getInputValue("sequenceId") || getInputValue("sequence_id");
    const rawSenderEmail = getInputValue("senderEmail") || getInputValue("sender_email");
    const senderEmail =
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
          console.error("HubSpot Contacts Search API returned error:", searchErrorText);
        }
      } catch (searchError) {
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
          }
        } catch (assocError) {
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
          }
        } catch (assocError) {
          console.error("Error fetching deal contact associations:", assocError);
        }
      } else if (!rawObjectType) {
        // Fallback if objectType is omitted entirely
        contactId = object.objectId;
      }
    }

    // Validate contactId
    if (!contactId) {
      const errorMessage = email
        ? `Contact not found in HubSpot for email: ${email}`
        : "Missing contactId and email in payload";
      console.warn(`Enrollment request rejected: ${errorMessage}`);
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
      console.warn("Enrollment request rejected: Missing sequenceId in payload");
      return NextResponse.json(
        {
          outputFields: {
            status: "FAILED",
            message: "Missing sequenceId in payload",
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

    const stringContactId = String(contactId);
    const stringSequenceId = String(sequenceId);

    console.log(
      `Initiating sequence enrollment: contactId=${stringContactId}, sequenceId=${stringSequenceId}, senderEmail=${senderEmail}`
    );

    // Call HubSpot Sequences API
    const enrollUrl = "https://api.hubapi.com/automation/sequences/2026-03/enrollments";
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
      try {
        const errorJson = JSON.parse(errorText);
        if (Array.isArray(errorJson.errors) && errorJson.errors.length > 0) {
          const details = errorJson.errors.map((e) => e.message || JSON.stringify(e)).join("; ");
          parsedErrorMessage = `${errorJson.message || "Error"}: ${details}`;
        } else {
          parsedErrorMessage = errorJson.message || errorJson.error || errorText;
        }
      } catch {
        // Use raw errorText if JSON parsing fails
      }

      console.error(
        `HubSpot Sequences API error (${enrollResponse.status}) for contact ${stringContactId}:`,
        parsedErrorMessage
      );

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
