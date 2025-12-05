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

    // === THRIVECART & CONVERTKIT & EXTRA ALERTS (form.completed) ===
    if (eventType === "form.completed" && email && email !== "N/A") {
      try {
        // Determine Name
        let userName = "";
        if (data.submitters && data.submitters.length > 0 && data.submitters[0].name) {
          userName = data.submitters[0].name;
        } else if (data.created_by_user && data.created_by_user.name) {
          userName = data.created_by_user.name;
        }

        console.log(`Processing additional integrations for ${email}`);

        let tcStatus = "Skipped";
        let ckStatus = "Skipped";
        const errors = [];

        // --- 1. ThriveCart: Grant Access to Course 187845 ---
        const thriveCartKey = process.env.THRIVECART_API_KEY;
        if (thriveCartKey) {
          try {
            const thriveCartUrl = "https://thrivecart.com/api/external/students";
            const formData = new URLSearchParams();
            formData.append("email", email);
            formData.append("name", userName);
            formData.append("course_id", "187845");
            formData.append("trigger_emails", "true");
            formData.append("tags[]", "");
            formData.append("order_info[order_id]", "");
            formData.append("order_info[purchase_type]", "");
            formData.append("order_info[purchase_id]", "");

            const tcResponse = await fetch(thriveCartUrl, {
              method: "POST",
              headers: {
                Authorization: thriveCartKey,
              },
              body: formData,
            });

            if (!tcResponse.ok) {
              const errText = await tcResponse.text();
              console.error("ThriveCart Error:", errText);
              tcStatus = "Failed";
              errors.push(`ThriveCart: ${errText}`);
            } else {
              console.log("ThriveCart success");
              tcStatus = "Success";
            }
          } catch (e) {
            console.error("ThriveCart Exception:", e);
            tcStatus = "Exception";
            errors.push(`ThriveCart Exception: ${e.message}`);
          }
        } else {
          console.warn("Skipping ThriveCart: THRIVECART_API_KEY not set");
          tcStatus = "Skipped (No Key)";
        }

        // --- 2. ConvertKit: Add Tag 11448082 ---
        const ckSecret = process.env.CONVERTKIT_API_SECRET;
        if (ckSecret) {
          try {
            const ckUrl = "https://api.convertkit.com/v3/tags/11448082/subscribe";
            const ckResponse = await fetch(ckUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json; charset=utf-8" },
              body: JSON.stringify({
                api_secret: ckSecret,
                email: email
              })
            });
            if (!ckResponse.ok) {
              const errText = await ckResponse.text();
              console.error("ConvertKit Error:", errText);
              ckStatus = "Failed";
              errors.push(`ConvertKit: ${errText}`);
            } else {
              console.log("ConvertKit success");
              ckStatus = "Success";
            }
          } catch (e) {
            console.error("ConvertKit Exception:", e);
            ckStatus = "Exception";
            errors.push(`ConvertKit Exception: ${e.message}`);
          }
        } else {
          console.warn("Skipping ConvertKit: CONVERTKIT_API_SECRET not set");
          ckStatus = "Skipped (No Key)";
        }

        // --- 3. Additional Slack Alert ---
        if (slackWebhook) {
          const hasFailure = tcStatus.includes("Failed") || tcStatus.includes("Exception") || ckStatus.includes("Failed") || ckStatus.includes("Exception");

          let slackColor = "#36a64f"; // Green
          let slackTitle = "Access Granted";
          let slackText = "Access to Mechanical course and Initial email has been sent. Need to grant access to the platinum course bundle.";

          if (hasFailure) {
            slackColor = "#ff0000"; // Red
            slackTitle = "Integration Errors Detected";
            slackText = "Some automated actions failed. Please review the details below.";
          }

          const slackFields = [
            { title: "User", value: `${userName} (${email})`, short: false },
            { title: "ThriveCart", value: tcStatus, short: true },
            { title: "ConvertKit", value: ckStatus, short: true }
          ];

          if (errors.length > 0) {
            slackFields.push({ title: "Error Details", value: errors.join("\n").substring(0, 1000), short: false });
          }

          // If successful, add the manual reminder as a field or keep in text
          if (!hasFailure) {
            // Retain the specific instruction about platinum course
            // We can modify the text slightly or keep as is.
            // The variable `slackText` already holds it.
          } else {
            // If failed, make sure the manual instruction is not lost if relevant, or maybe high priority is fixing the error.
            slackFields.push({ title: "Next Steps", value: "Check logs and grant access manually if needed.", short: false });
          }

          const extraSlackPayload = {
            attachments: [
              {
                color: slackColor,
                title: slackTitle,
                text: slackText,
                fields: slackFields,
                footer: `Timestamp: ${timestamp}`,
              },
            ],
          };

          await fetch(slackWebhook, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(extraSlackPayload),
          });
        }

      } catch (integrationErr) {
        console.error("Error in additional integrations:", integrationErr);
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
