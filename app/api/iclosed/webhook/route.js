// app/api/iclosed/webhook/route.js
import { NextResponse } from "next/server";

/**
 * Helper function to add a tag to a user in ConvertKit.
 * Logs errors internally instead of throwing, so the main webhook can always return 200.
 */
async function addTagToUser(email, tagId, apiSecret) {
  // Basic validation
  if (!email || !tagId || !apiSecret) {
    console.error(
      "addTagToUser: Missing required parameters (email, tagId, or apiSecret).",
      { email: !!email, tagId: !!tagId, apiSecret: !!apiSecret }
    );
    return;
  }

  try {
    const convertkitResponse = await fetch(
      `https://api.convertkit.com/v3/tags/${tagId}/subscribe`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ api_secret: apiSecret, email: email }),
      }
    );

    if (!convertkitResponse.ok) {
      const responseData = await convertkitResponse.json();
      console.error(
        `ConvertKit API error for tag ${tagId} and email ${email}:`,
        responseData
      );
    } else {
      console.log(`Successfully tagged user ${email} with tag ID ${tagId}.`);
    }
  } catch (apiError) {
    console.error(
      `Failed to make ConvertKit API request for tag ${tagId} and email ${email}:`,
      apiError
    );
  }
}

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
    const eventData = payload && payload[0];

    // --- 1. Basic Payload Validation ---
    if (!eventData) {
      return NextResponse.json(
        {
          success: true,
          message: "Webhook received but the payload was empty.",
        },
        { status: 200, headers: { "Access-Control-Allow-Origin": "*" } }
      );
    }

    // --- 2. Get Common Variables ---
    const inviteeEmail = eventData.invitee?.email;
    const apiSecret = process.env.CONVERTKIT_API_SECRET;

    // If there's no email, we can't do anything.
    if (!inviteeEmail) {
      console.warn(
        "Webhook received, but no invitee email was found in the payload. No actions taken."
      );
      return NextResponse.json(
        {
          success: true,
          message: "Webhook processed, no invitee email found.",
        },
        { status: 200, headers: { "Access-Control-Allow-Origin": "*" } }
      );
    }

    // If the API secret isn't set, log a server-side error.
    if (!apiSecret) {
      console.error(
        "CONVERTKIT_API_SECRET environment variable is not set. Cannot tag user."
      );
      // Still return 200 to iClosed, as it's a server config issue.
      return NextResponse.json(
        { success: true, message: "Webhook received, server config error." },
        { status: 200, headers: { "Access-Control-Allow-Origin": "*" } }
      );
    }

    // --- 3. ORIGINAL LOGIC: Tag based on event type ---
    if (eventData.event_type?.slug === "mechanical-rules-strategy-session") {
      const tagId = 11470881;
      console.log(
        `Event "mechanical-rules-strategy-session" detected. Attempting to add tag ${tagId} to ${inviteeEmail}.`
      );
      // We use 'await' to ensure this call completes before the function finishes,
      // but we don't need to block the *next* logic block.
      await addTagToUser(inviteeEmail, tagId, apiSecret);
    } else {
      console.log(
        `Received event type "${eventData.event_type?.slug}", which is not "mechanical-rules-strategy-session". No action for this block.`
      );
    }

    // --- 4. NEW LOGIC: Tag based on assigned user (runs independently) ---
    const assignedToData = eventData.event?.extended_assigned_to;
    let assignedEmail = null;

    // Find the first assigned user's email from the 'extended_assigned_to' object
    if (assignedToData && typeof assignedToData === "object") {
      const assignedUsers = Object.values(assignedToData);
      const firstUserWithEmail = assignedUsers.find(
        (user) => user && user.email
      );
      if (firstUserWithEmail) {
        assignedEmail = firstUserWithEmail.email;
      }
    }

    if (assignedEmail) {
      console.log(`Call is assigned to: ${assignedEmail}.`);
      let tagIdToAssign = null;

      if (assignedEmail === "james@bullmania.com") {
        tagIdToAssign = 11873105; // James's tag
      } else if (assignedEmail === "phil@bullmania.com") {
        tagIdToAssign = 11873106; // Phil's tag
      }

      if (tagIdToAssign) {
        console.log(
          `Assignee email matches. Attempting to add tag ${tagIdToAssign} to ${inviteeEmail}.`
        );
        await addTagToUser(inviteeEmail, tagIdToAssign, apiSecret);
      } else {
        console.log(
          "Assignee email did not match specified emails. No new tag added from this block."
        );
      }
    } else {
      console.log(
        "Could not determine 'assigned_to' email from payload. Skipping assignee tag logic."
      );
    }

    // --- 5. Final Success Response ---
    // Always return a success response to the webhook sender
    return NextResponse.json(
      {
        success: true,
        message: "Webhook payload received and processed.",
      },
      {
        status: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (error) {
    console.error("Error processing iclosed.io webhook:", error);

    // Catch parsing errors or other major issues
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
