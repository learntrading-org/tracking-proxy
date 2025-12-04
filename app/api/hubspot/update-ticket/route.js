// app/api/hubspot/update-ticket/route.js
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

    // 1. Extract inputs and context
    const { object, inputFields } = payload;
    const { objectId, objectType } = object;
    const { target_pipeline_id, new_stage_id, ticket_name_filter } = inputFields;

    if (!objectId || !target_pipeline_id || !new_stage_id) {
      throw new Error("Missing required fields: objectId, target_pipeline_id, or new_stage_id");
    }

    const token = process.env.HUBSPOT_ACCESS_TOKEN;
    if (!token) {
      console.error("Missing HUBSPOT_ACCESS_TOKEN environment variable");
      throw new Error("Configuration error");
    }

    // 2. Fetch associated tickets
    // We need to know the association type ID. 
    // For Contact -> Ticket, it's usually 15 (Contact to Ticket) or 16 (Ticket to Contact).
    // But it's safer to query associations generically or assume standard definition.
    // Let's use the V4 associations API or V3 for simplicity.
    // V3: GET /crm/v3/objects/{objectType}/{objectId}/associations/{toObjectType}

    // Determine the 'from' object type for the URL (e.g. 'contacts')
    const fromType = objectType.toLowerCase() + 's'; // e.g. 'contacts'

    const assocUrl = `https://api.hubapi.com/crm/v3/objects/${fromType}/${objectId}/associations/tickets`;
    const assocResponse = await fetch(assocUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!assocResponse.ok) {
      const errorText = await assocResponse.text();
      console.error(`Error fetching associations: ${assocResponse.status} ${errorText}`);
      throw new Error(`Failed to fetch associated tickets`);
    }

    const assocData = await assocResponse.json();
    const ticketIds = assocData.results.map(r => r.id);

    if (ticketIds.length === 0) {
      return NextResponse.json({
        message: "No associated tickets found"
      });
    }

    // 3. Fetch details for these tickets (pipeline, stage, subject)
    // POST /crm/v3/objects/tickets/batch/read
    const batchReadUrl = `https://api.hubapi.com/crm/v3/objects/tickets/batch/read`;
    const batchReadResponse = await fetch(batchReadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        inputs: ticketIds.map(id => ({ id })),
        properties: ["hs_pipeline", "hs_pipeline_stage", "subject"]
      })
    });

    if (!batchReadResponse.ok) {
      const errorText = await batchReadResponse.text();
      console.error(`Error fetching ticket details: ${batchReadResponse.status} ${errorText}`);
      throw new Error(`Failed to fetch ticket details`);
    }

    const ticketsData = await batchReadResponse.json();
    const tickets = ticketsData.results;

    // 4. Filter tickets
    const ticketsToUpdate = tickets.filter(ticket => {
      const pipelineMatch = ticket.properties.hs_pipeline === target_pipeline_id;

      let nameMatch = true;
      if (ticket_name_filter) {
        const subject = ticket.properties.subject || "";
        nameMatch = subject.toLowerCase().includes(ticket_name_filter.toLowerCase());
      }

      // Optional: Don't update if already in the target stage?
      // const stageDiffers = ticket.properties.hs_pipeline_stage !== new_stage_id;

      return pipelineMatch && nameMatch;
    });

    if (ticketsToUpdate.length === 0) {
      return NextResponse.json({
        message: "No tickets matched the criteria"
      });
    }

    // 5. Update tickets
    // POST /crm/v3/objects/tickets/batch/update
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

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      console.error(`Error updating tickets: ${updateResponse.status} ${errorText}`);
      throw new Error(`Failed to update tickets`);
    }

    const updateResult = await updateResponse.json();

    return NextResponse.json(
      {
        message: `Successfully updated ${updateResult.results.length} tickets`
      },
      {
        status: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
        },
      }
    );

  } catch (error) {
    console.error("Error processing update-ticket action:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      {
        status: 500,
        headers: {
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }
}
