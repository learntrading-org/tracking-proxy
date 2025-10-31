// app/api/hubspot/webhook/route.js
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
    console.log({ payload });
    const { inputs, associatedObjects } = payload;
    const contact = associatedObjects?.[0];
    const email = contact?.properties?.email;
    const contactId = contact?.objectId;
    const customId = inputs?.dataObjectId;

    // Log the extracted data
    console.log("Extracted webhook data:", {
      email,
      contactId,
      customId,
      inputs,
      contact,
    });

    // Return success response with the requested format
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
