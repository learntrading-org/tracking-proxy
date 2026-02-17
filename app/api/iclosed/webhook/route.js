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


/**
 * Helper to check Intercom conversations and tag if user interacted with AI.
 */
/**
 * Helper to check Intercom conversations and tag if user interacted with AI.
 */
async function checkAndTagIntercomUser(email, phone, intercomToken) {
  if ((!email && !phone) || !intercomToken) return;

  const TAG_WA = "13115759";
  const TAG_EMAIL = "13115760";
  const INTERCOM_VERSION = "2.14";
  const headers = {
    "Authorization": `Bearer ${intercomToken}`,
    "Content-Type": "application/json",
    "Intercom-Version": INTERCOM_VERSION,
    "Accept": "application/json"
  };

  const contactsToCheck = [];

  try {
    // 1. Find Contact by Email
    if (email) {
      const emailRes = await fetch("https://api.intercom.io/contacts/search", {
        method: "POST",
        headers,
        body: JSON.stringify({
          query: { field: "email", operator: "=", value: email }
        })
      });

      if (emailRes.ok) {
        const data = await emailRes.json();
        if (data.data?.[0]) contactsToCheck.push(data.data[0]);
      } else {
        console.error("[Intercom AI Check] Email Search Failed:", await emailRes.text());
      }
    }

    // 2. Find Contact by Phone
    if (phone) {
      const phoneRes = await fetch("https://api.intercom.io/contacts/search", {
        method: "POST",
        headers,
        body: JSON.stringify({
          query: { field: "phone", operator: "=", value: phone }
        })
      });

      if (phoneRes.ok) {
        const data = await phoneRes.json();
        if (data.data?.[0]) {
          // Avoid duplicates
          if (!contactsToCheck.find(c => c.id === data.data[0].id)) {
            contactsToCheck.push(data.data[0]);
          }
        }
      } else {
        console.error("[Intercom AI Check] Phone Search Failed:", await phoneRes.text());
      }
    }

    if (contactsToCheck.length === 0) {
      console.log("[Intercom AI Check] No Intercom contacts found for email/phone:", email, phone);
      return;
    }

    console.log(`[Intercom AI Check] Found ${contactsToCheck.length} unique contact(s). Checking interactions...`);

    // 3. Check Interactions for each contact
    for (const contact of contactsToCheck) {
      console.log(`[Intercom AI Check] Checking contact ${contact.id}...`);

      // 2. Fetch Conversations (Corrected for API v2.14)
      // We use the Search API to filter specifically by contact_id. 
      // The previous GET endpoint likely ignored 'intercom_user_id' and returned global conversations.
      const convRes = await fetch("https://api.intercom.io/conversations/search", {
        method: "POST",
        headers,
        body: JSON.stringify({
          query: {
            operator: "AND",
            value: [
              {
                field: "contact_ids",
                operator: "=",
                value: contact.id
              }
            ]
          },
          pagination: {
            per_page: 5
          },
          sort: {
            field: "updated_at",
            order: "descending"
          }
        })
      });

      if (!convRes.ok) {
        console.error("[Intercom AI Check] Conversations Search Failed:", await convRes.text());
        continue;
      }

      const convData = await convRes.json();
      const conversations = convData.conversations || [];
      console.log(`[Intercom AI Check] Found ${conversations.length} conversations for ${contact.id}. Checking details...`);

      let taggedWA = false;
      let taggedEmail = false;
      // No need to slice, we requested only 5.
      const recentConversations = conversations;

      await Promise.all(recentConversations.map(async (c) => {
        if ((taggedWA && taggedEmail)) return;

        try {
          const detailRes = await fetch(`https://api.intercom.io/conversations/${c.id}`, { headers });
          if (!detailRes.ok) return;
          const detail = await detailRes.json();

          const parts = detail.conversation_parts?.conversation_parts || [];
          const timeline = [];
          if (detail.source) timeline.push(detail.source);
          if (parts) timeline.push(...parts);

          let botSpoke = false;
          let userRespondedAfterBot = false;

          for (const part of timeline) {
            const authorType = part.author?.type;
            if (authorType === "bot") {
              botSpoke = true;
            } else if (authorType === "user" && botSpoke) {
              userRespondedAfterBot = true;
              break;
            }
          }

          if (userRespondedAfterBot) {
            const channel = detail.source?.delivered_as;
            console.log(`[Intercom AI Check] Conversation ${c.id}: User replied to Bot. Channel: ${channel}`);

            if (channel === "whatsapp" && !taggedWA) {
              await tagIntercomContact(contact.id, TAG_WA, headers);
              taggedWA = true;
              console.log(`[Intercom AI Check] Tagged 'Call Booked WA' on ${contact.id}`);
            } else if (!taggedEmail && (channel === "email" || channel === "customer_initiated" || channel === "chat" || channel === "admin_initiated")) {
              // Fallback: Treat standard chat/email channels as "Call Booked Email"
              await tagIntercomContact(contact.id, TAG_EMAIL, headers);
              taggedEmail = true;
              console.log(`[Intercom AI Check] Tagged 'Call Booked Email' on ${contact.id} (Channel: ${channel})`);
            }
          }
        } catch (err) {
          console.error(`[Intercom AI Check] Error checking conversation ${c.id}:`, err);
        }
      }));
    }

  } catch (err) {
    console.error("[Intercom AI Check] Error in checkAndTagIntercomUser:", err);
  }
}

// Helper to tag Intercom User
async function tagIntercomContact(contactId, tagId, headers) {
  try {
    const res = await fetch(`https://api.intercom.io/contacts/${contactId}/tags`, {
      method: "POST",
      headers,
      body: JSON.stringify({ id: tagId })
    });
    if (res.ok) {
      console.log(`Intercom Tag ${tagId} applied to ${contactId}`);
    } else {
      console.error(`Failed to apply Intercom tag ${tagId}:`, await res.text());
    }
  } catch (e) {
    console.error("Error applying Intercom tag:", e);
  }
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
    const intercomToken = process.env.INTERCOM_ACCESS_TOKEN; // New token

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

    // --- NEW: Check Intercom for AI Interactions ---
    if (intercomToken) {
      // Trying to find phone in typical fields
      const inviteePhone = eventData.invitee?.text_notification_phone || eventData.invitee?.phone || eventData.invitee?.mobile;

      // In Serverless/Vercel, we must await the promise to ensure it runs before the process exits.
      // This will delay the webhook response slightly (by a few seconds), which is acceptable.
      try {
        await checkAndTagIntercomUser(inviteeEmail, inviteePhone, intercomToken);
      } catch (e) {
        console.error("Intercom Check Failed:", e);
      }
    } else {
      console.warn("INTERCOM_ACCESS_TOKEN not set, skipping Intercom AI check.");
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
      const eventName = eventData.event_type?.name || "";
      const eventNameLower = eventName.toLowerCase();

      // Filter: Must include "mechanical rules" and NOT include "review" (all lowercased)
      const shouldRunTagging =
        eventNameLower.includes("mechanical rules") &&
        !eventNameLower.includes("review");

      if (shouldRunTagging) {
        console.log(
          `Call is assigned to: ${assignedEmail}. Event "${eventName}" matches criteria.`
        );
        let tagIdToAssign = null;

        if (assignedEmail === "james@bullmania.com") {
          tagIdToAssign = 11873105; // James's tag
        } else if (assignedEmail === "phil@bullmania.com") {
          tagIdToAssign = 11873106; // Phil's tag
        } else if (assignedEmail === "cailum@bullmania.com") {
          tagIdToAssign = 12824071; // Cailum's tag
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
          `Skipping assignee tag logic: Event "${eventName}" does not match criteria.`
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
