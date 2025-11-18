// app/api/hubspot/docuseal-agreement/webhook-alerts/route.js
import { NextResponse } from "next/server";

// Handle CORS preflight requests
export async function OPTIONS(request) {
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

// Handle the main webhook POST request
export async function POST(request) {
  try {
    const payload = await request.json();

    // Extract the specific data fields

    const eventType = payload.event_type;
    const data = payload.data;
    const timestamp = payload.timestamp;

    // Extract email from possible places
    let email = data.email || "N/A";
    if (
      email === "N/A" &&
      data.submitters &&
      data.submitters.length > 0 &&
      data.submitters[0].email
    ) {
      email = data.submitters[0].email;
    } else if (
      email === "N/A" &&
      data.created_by_user &&
      data.created_by_user.email
    ) {
      email = data.created_by_user.email + " (creator)";
    }

    // Extract Country from values array (case-insensitive + trim)
    let country = null;
    if (data.values && Array.isArray(data.values)) {
      const countryItem = data.values.find(
        (item) => item.field && item.field.trim().toLowerCase() === "country"
      );
      if (countryItem?.value) {
        country = countryItem.value.trim();
        // If value is empty after trim, treat as null
        if (country === "") country = null;
      }
    }

    // Map event types to human-readable status messages
    const eventMap = {
      "form.viewed": "Form Viewed",
      "form.started": "Form Started",
      "form.completed": "Form Completed (Signed)",
      "form.declined": "Form Declined",
      "submission.created": "Submission Created",
      "submission.completed": "Submission Completed",
      "submission.expired": "Submission Expired",
      "submission.archived": "Submission Archived",
    };

    const statusMessage = eventMap[eventType] || eventType;

    // Map event types to Slack attachment colors
    const colorMap = {
      "form.completed": "#36a64f", // green
      "submission.completed": "#36a64f", // green
      "form.declined": "#ff0000", // red
      "submission.expired": "#ff0000", // red
      "form.viewed": "#00bfff", // blue
      "form.started": "#00bfff", // blue
      "submission.created": "#00bfff", // blue
      "submission.archived": "#808080", // gray
    };

    const color = colorMap[eventType] || "#808080"; // default to gray

    // Additional details if available
    const templateName = data.template ? data.template.name : "N/A";

    // Extract submission URL from possible places
    let submissionUrl = "N/A";
    if (data.submission_url) {
      submissionUrl = data.submission_url;
    } else if (data.submission && data.submission.url) {
      submissionUrl = data.submission.url;
    } else if (data.slug) {
      submissionUrl = `https://docuseal.eu/e/${data.slug}`;
    } else if (data.url) {
      submissionUrl = data.url;
    }

    // Construct Slack fields dynamically
    const fields = [
      { title: "Email", value: email, short: true },
      { title: "Template", value: templateName, short: true },
    ];

    if (country) {
      fields.push({ title: "Country", value: country, short: true });
    }

    fields.push({
      title: "Submission URL",
      value: submissionUrl,
      short: false,
    });

    // Construct Slack payload
    const slackPayload = {
      attachments: [
        {
          color: color,
          title: `DocuSeal Event: ${statusMessage}`,
          fields: fields,
          footer: `Timestamp: ${timestamp}`,
        },
      ],
    };

    // Slack webhook URL
    const slackWebhook = process.env.SLACK_DOCUSEAL_WEBHOOK;

    // Send to Slack
    const slackResponse = await fetch(slackWebhook, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(slackPayload),
    });

    if (!slackResponse.ok) {
      console.error("Failed to send to Slack:", await slackResponse.text());
    }

    // === HUBSPOT COUNTRY UPDATE (only on form.completed and when country is present) ===
    if (eventType === "form.completed" && country && email && email !== "N/A") {
      const hubspotToken = process.env.HUBSPOT_ACCESS_TOKEN; // ← Set this in your .env (Private App token or OAuth)

      if (!hubspotToken) {
        console.error(
          "HubSpot access token not configured in environment variables"
        );
      } else {
        const encodedEmail = encodeURIComponent(email);
        const hubspotUrl = `https://api.hubapi.com/crm/v3/objects/contacts/${encodedEmail}?idProperty=email`;

        try {
          const hubspotResponse = await fetch(hubspotUrl, {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${hubspotToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              properties: {
                country: country,
              },
            }),
          });

          if (hubspotResponse.ok) {
            console.log(
              `Successfully updated HubSpot country for ${email} → ${country}`
            );
          } else {
            const errorBody = await hubspotResponse.text();
            console.error(
              `Failed to update HubSpot country for ${email}: ${hubspotResponse.status} ${errorBody}`
            );
          }
        } catch (err) {
          console.error("Exception while updating HubSpot:", err);
        }
      }
    }

    // Return success response
    return NextResponse.json(
      {
        status: "success",
        statusCode: 200,
      },
      {
        status: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (error) {
    console.error("Error processing webhook:", error);

    return NextResponse.json(
      { error: "Internal server error" },
      {
        status: 500,
        headers: {
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }
}
