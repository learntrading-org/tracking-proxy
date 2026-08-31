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

    const { object, fields = {}, inputFields = {}, properties = {} } = payload;

    // Extract contact ID from payload with fallbacks
    let contactId =
      object?.objectId ||
      payload.objectId ||
      payload.contactId ||
      fields.contactId ||
      inputFields.contactId;

    // Extract email from fields or root
    const email = fields.email || inputFields.email || payload.email || properties.email;

    // Extract sequence ID from fields or root
    const sequenceId = fields.sequenceId || inputFields.sequenceId || payload.sequenceId;

    // Extract sender email (fallback to default if empty or blank)
    const rawSenderEmail = fields.senderEmail || inputFields.senderEmail || payload.senderEmail;
    const senderEmail =
      rawSenderEmail && typeof rawSenderEmail === "string" && rawSenderEmail.trim() !== ""
        ? rawSenderEmail.trim()
        : "hello@bullmania.com";

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

    // If contactId is not present, attempt to look it up via HubSpot Search API using email
    if (!contactId && email && typeof email === "string" && email.trim() !== "") {
      console.log(`contactId not found in payload, searching HubSpot for contact by email: ${email.trim()}`);
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
        parsedErrorMessage = errorJson.message || errorJson.error || errorText;
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
