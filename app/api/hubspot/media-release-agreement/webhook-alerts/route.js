// app/api/hubspot/media-release-agreement/webhook-alerts/route.js
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

    const eventType = payload.event_type;
    const data = payload.data;
    const timestamp = payload.timestamp;

    // Only process webhooks for the 355760 template
    if (data.template?.id !== 355760) {
      return NextResponse.json({ status: "ignored", reason: "Template ID mismatch" }, { status: 200 });
    }

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

    // Extract fields from values array (case-insensitive + trim)
    let country = null;
    let firstName = null;
    let lastName = null;
    let fullName = null;

    if (data.values && Array.isArray(data.values)) {
      data.values.forEach((item) => {
        if (!item.field) return;
        const fieldName = item.field.trim().toLowerCase();
        const fieldValue = item.value ? item.value.trim() : null;

        if (!fieldValue) return;

        if (fieldName === "country") {
          country = fieldValue;
        } else if (fieldName === "first name") {
          firstName = fieldValue;
        } else if (fieldName === "last name") {
          lastName = fieldValue;
        } else if (fieldName === "full name") {
          fullName = fieldValue;
        }
      });
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

    if (fullName) {
      fields.push({ title: "Full Name", value: fullName, short: true });
    } else {
      if (firstName) {
        fields.push({ title: "First Name", value: firstName, short: true });
      }
      if (lastName) {
        fields.push({ title: "Last Name", value: lastName, short: true });
      }
    }

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

    if (slackWebhook) {
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
    } else {
      console.warn("SLACK_DOCUSEAL_WEBHOOK is not configured.");
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
