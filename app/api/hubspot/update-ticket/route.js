// app/api/hubspot/update-ticket/route.js
import { NextResponse } from "next/server";

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

export async function POST(request) {
  try {
    const payload = await request.json();

    // 1. Get the Enrolled Contact and Inputs
    const { object, inputFields } = payload;
    const contactId = object.objectId; // The ID of the user (Contact) enrolled in the workflow
    const { target_pipeline_id, new_stage_id } = inputFields;

    console.log(`Processing for Contact ID: ${contactId}, Pipeline: ${target_pipeline_id}, Target Stage: ${new_stage_id}`);

    if (!contactId || !target_pipeline_id || !new_stage_id) {
      throw new Error("Missing required fields");
    }

    const token = process.env.HUBSPOT_ACCESS_TOKEN;
    if (!token) throw new Error("Missing HUBSPOT_ACCESS_TOKEN");

    // 2. Find Tickets associated with this Contact
    // We use the Contact ID to find associations. This is more reliable than email.
    const assocUrl = `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}/associations/tickets`;
    const assocResponse = await fetch(assocUrl, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!assocResponse.ok) throw new Error(`Failed to fetch associations: ${assocResponse.status}`);

    const assocData = await assocResponse.json();
    const ticketIds = assocData.results.map(r => r.id);

    if (ticketIds.length === 0) {
      console.log("No tickets associated with this contact.");
      return NextResponse.json({ message: "No associated tickets found" });
    }

    // 3. Check which of these tickets are in the correct Pipeline
    const batchReadUrl = `https://api.hubapi.com/crm/v3/objects/tickets/batch/read`;
    const batchReadResponse = await fetch(batchReadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        inputs: ticketIds.map(id => ({ id })),
        properties: ["hs_pipeline", "subject"]
      })
    });

    if (!batchReadResponse.ok) throw new Error(`Failed to read ticket details`);

    const ticketsData = await batchReadResponse.json();

    // Filter: Find the ticket that matches the target_pipeline_id
    const ticketsToUpdate = ticketsData.results.filter(ticket => {
      return ticket.properties.hs_pipeline === target_pipeline_id;
    });

    if (ticketsToUpdate.length === 0) {
      console.log(`Found ${ticketIds.length} tickets, but none in pipeline ${target_pipeline_id}`);
      return NextResponse.json({ message: "No tickets found in the target pipeline" });
    }

    // 4. Update the Stage of the matching ticket(s)
    const batchUpdateUrl = `https://api.hubapi.com/crm/v3/objects/tickets/batch/update`;
    const updatePayload = {
      inputs: ticketsToUpdate.map(t => ({
        id: t.id,
        properties: {
          hs_pipeline_stage: new_stage_id
        }
      }))
    };

    const updateResponse = await fetch(batchUpdateUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(updatePayload)
    });

    if (!updateResponse.ok) throw new Error(`Failed to update tickets`);

    const updateResult = await updateResponse.json();
    console.log(`Successfully updated ${updateResult.results.length} tickets.`);

    return NextResponse.json({
      message: `Updated ${updateResult.results.length} tickets in pipeline ${target_pipeline_id}`
    });

  } catch (error) {
    console.error("Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
