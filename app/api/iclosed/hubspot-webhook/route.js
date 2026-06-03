// app/api/iclosed/hubspot-webhook/route.js
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

/**
 * Find contact in HubSpot by email
 */
async function findHubSpotContact(email, token) {
  const response = await fetch("https://api.hubapi.com/crm/v3/objects/contacts/search", {
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
              value: email,
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HubSpot search failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return data.results?.[0]; // Returns the contact object if found, otherwise undefined
}

/**
 * Create a new contact in HubSpot
 */
async function createHubSpotContact(properties, token) {
  const response = await fetch("https://api.hubapi.com/crm/v3/objects/contacts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ properties }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HubSpot creation failed (${response.status}): ${errorText}`);
  }

  return await response.json();
}

/**
 * Update an existing contact in HubSpot
 */
async function updateHubSpotContact(contactId, properties, token) {
  const response = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${contactId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ properties }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HubSpot update failed (${response.status}): ${errorText}`);
  }

  return await response.json();
}

// Handle webhook request
export async function POST(request) {
  try {
    const payload = await request.json();
    console.log("Received iClosed webhook payload:", JSON.stringify(payload, null, 2));

    // Handle array or single object format
    const eventData = Array.isArray(payload) ? payload[0] : payload;

    if (!eventData) {
      return NextResponse.json(
        { success: true, message: "Empty payload received." },
        { status: 200, headers: { "Access-Control-Allow-Origin": "*" } }
      );
    }

    // Extract contact details from various possible paths
    const contactObject = eventData.contact || eventData.invitee || eventData;
    
    const email = contactObject.email;
    if (!email) {
      console.warn("No email address found in the webhook payload. Skipping HubSpot sync.");
      return NextResponse.json(
        { success: true, message: "Skipped: no email found." },
        { status: 200, headers: { "Access-Control-Allow-Origin": "*" } }
      );
    }

    const firstName = contactObject.firstName || contactObject.first_name || "";
    const lastName = contactObject.lastName || contactObject.last_name || "";
    const phone = contactObject.phone || contactObject.mobile || contactObject.text_notification_phone || "";

    // Extract UTM properties from various possible paths
    const utmSource = 
      contactObject.utm_source || 
      contactObject.utmSource || 
      eventData.utm_source || 
      eventData.utmSource || 
      (eventData.utm && eventData.utm.source) || 
      "";

    const utmMedium = 
      contactObject.utm_medium || 
      contactObject.utmMedium || 
      eventData.utm_medium || 
      eventData.utmMedium || 
      (eventData.utm && eventData.utm.medium) || 
      "";

    const utmCampaign = 
      contactObject.utm_campaign || 
      contactObject.utmCampaign || 
      eventData.utm_campaign || 
      eventData.utmCampaign || 
      (eventData.utm && eventData.utm.campaign) || 
      "";

    const utmContent = 
      contactObject.utm_content || 
      contactObject.utmContent || 
      eventData.utm_content || 
      eventData.utmContent || 
      (eventData.utm && eventData.utm.content) || 
      "";

    console.log("Parsed webhook contact data:", {
      email,
      firstName,
      lastName,
      phone,
      utmSource,
      utmMedium,
      utmCampaign,
      utmContent,
    });

    const token = process.env.HUBSPOT_ACCESS_TOKEN;
    if (!token) {
      console.error("HUBSPOT_ACCESS_TOKEN environment variable is missing.");
      return NextResponse.json(
        { success: false, message: "Server configuration error: missing token." },
        { status: 500, headers: { "Access-Control-Allow-Origin": "*" } }
      );
    }

    // Step 1: Check if the contact exists in HubSpot
    console.log(`Checking if contact exists in HubSpot: ${email}`);
    const existingContact = await findHubSpotContact(email, token);

    if (existingContact) {
      console.log(`Contact found in HubSpot with ID: ${existingContact.id}. Updating...`);
      
      const propertiesToUpdate = {};
      // Sync basic details if provided
      if (firstName) propertiesToUpdate.firstname = firstName;
      if (lastName) propertiesToUpdate.lastname = lastName;
      if (phone) propertiesToUpdate.phone = phone;

      // Sync UTM details if provided
      if (utmCampaign) propertiesToUpdate.utm_campaign = utmCampaign;
      if (utmContent) propertiesToUpdate.utm_content = utmContent;
      if (utmMedium) propertiesToUpdate.utm_medium = utmMedium;
      if (utmSource) propertiesToUpdate.utm_source = utmSource;

      // Only make the request if we have properties to update
      if (Object.keys(propertiesToUpdate).length > 0) {
        await updateHubSpotContact(existingContact.id, propertiesToUpdate, token);
        console.log(`Successfully updated contact ${email} in HubSpot.`);
      } else {
        console.log(`No updates required for contact ${email}.`);
      }
    } else {
      console.log(`Contact ${email} not found in HubSpot. Creating new contact...`);

      const propertiesToCreate = { email };
      if (firstName) propertiesToCreate.firstname = firstName;
      if (lastName) propertiesToCreate.lastname = lastName;
      if (phone) propertiesToCreate.phone = phone;

      // Set UTM parameters if present
      if (utmCampaign) propertiesToCreate.utm_campaign = utmCampaign;
      if (utmContent) propertiesToCreate.utm_content = utmContent;
      if (utmMedium) propertiesToCreate.utm_medium = utmMedium;
      if (utmSource) propertiesToCreate.utm_source = utmSource;

      const newContact = await createHubSpotContact(propertiesToCreate, token);
      console.log(`Successfully created contact ${email} in HubSpot with ID: ${newContact.id}.`);
    }

    return NextResponse.json(
      { success: true, message: "HubSpot contact sync completed successfully." },
      { status: 200, headers: { "Access-Control-Allow-Origin": "*" } }
    );
  } catch (error) {
    console.error("Error processing HubSpot webhook:", error);
    return NextResponse.json(
      { success: false, error: "Internal Server Error", details: error.message },
      { status: 500, headers: { "Access-Control-Allow-Origin": "*" } }
    );
  }
}
