// app/api/hubspot/crypto-renewal-email/route.js
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
    const data = await request.json();
    const { fields } = data;
    const { firstName, price, billing, email } = fields;

    const tagId = "12168728"; // Trigger Crypto Renewal Email
    const apiSecret = process.env.CONVERTKIT_API_SECRET;

    if (!apiSecret) {
      throw new Error("ConvertKit API secret is not set");
    }

    // Step 1: Remove the tag if it exists (unsubscribe from tag)
    const unsubscribeResponse = await fetch(
      `https://api.convertkit.com/v3/tags/${tagId}/unsubscribe`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          api_secret: apiSecret,
          email,
        }),
      }
    );

    if (!unsubscribeResponse.ok) {
      console.error(
        "Failed to unsubscribe from tag:",
        await unsubscribeResponse.text()
      );
    }

    // Step 2: Update metadata and add the tag (subscribe to tag, which also updates fields)
    const subscribeResponse = await fetch(
      `https://api.convertkit.com/v3/tags/${tagId}/subscribe`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          api_secret: apiSecret,
          email,
          first_name: firstName,
          fields: {
            renewal_price: price,
            billing: billing,
          },
        }),
      }
    );

    if (!subscribeResponse.ok) {
      throw new Error(
        "Failed to subscribe to tag and update fields: " +
          (await subscribeResponse.text())
      );
    }

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
