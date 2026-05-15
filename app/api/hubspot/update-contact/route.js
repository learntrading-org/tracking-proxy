// app/api/hubspot/update-contact/route.js
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
    const { contactId, properties } = payload;

    if (!contactId || !properties) {
      return NextResponse.json(
        { error: "Missing contactId or properties" },
        { status: 400, headers: { "Access-Control-Allow-Origin": "*" } }
      );
    }

    const token = process.env.HUBSPOT_ACCESS_TOKEN;
    if (!token) {
      console.error("Missing HUBSPOT_ACCESS_TOKEN");
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500, headers: { "Access-Control-Allow-Origin": "*" } }
      );
    }

    const updateUrl = `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}`;
    const updateResponse = await fetch(updateUrl, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ properties }),
    });

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      console.error("HubSpot API error:", errorText);
      return NextResponse.json(
        { error: `HubSpot Update API error: ${errorText}` },
        { status: updateResponse.status, headers: { "Access-Control-Allow-Origin": "*" } }
      );
    }

    const result = await updateResponse.json();

    return NextResponse.json(
      { status: "SUCCESS", data: result },
      {
        status: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (error) {
    console.error("Error processing request:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500, headers: { "Access-Control-Allow-Origin": "*" } }
    );
  }
}
