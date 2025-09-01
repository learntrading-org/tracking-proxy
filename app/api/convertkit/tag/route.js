// app/api/convertkit/tag/route.js

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

export async function POST(request) {
  try {
    const { email, tagId } = await request.json();

    // Validate required fields
    if (!email || !tagId) {
      return NextResponse.json(
        { error: "Email and tagId are required" },
        {
          status: 400,
          headers: {
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: "Invalid email format" },
        {
          status: 400,
          headers: {
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

    // Get ConvertKit API secret from environment variables
    const apiSecret = process.env.CONVERTKIT_API_SECRET;
    if (!apiSecret) {
      console.error("CONVERTKIT_API_SECRET environment variable is not set");
      return NextResponse.json(
        { error: "API configuration error" },
        {
          status: 500,
          headers: {
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

    // Make request to ConvertKit API
    const convertkitResponse = await fetch(
      `https://api.convertkit.com/v3/tags/${tagId}/subscribe`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          api_secret: apiSecret,
          email: email,
        }),
      }
    );

    const responseData = await convertkitResponse.json();

    if (!convertkitResponse.ok) {
      console.error("ConvertKit API error:", responseData);
      return NextResponse.json(
        {
          error: "Failed to add tag to user",
          details: responseData.message || "Unknown error",
        },
        {
          status: convertkitResponse.status,
          headers: {
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

    // Return successful response
    return NextResponse.json(
      {
        success: true,
        subscription: responseData.subscription,
      },
      {
        status: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (error) {
    console.error("Route handler error:", error);
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
