// app/api/newsletter/subscribe/route.js

import { NextResponse } from "next/server";

// Handle CORS preflight requests
export async function OPTIONS(request) {
  const headers = new Headers();
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS"
  );
  headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With"
  );
  headers.set("Access-Control-Max-Age", "86400");

  return new Response(null, {
    status: 200,
    headers: headers,
  });
}

export async function POST(request) {
  // Set CORS headers for the main response
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-Requested-With",
  };

  try {
    const { email, tagId } = await request.json();

    // Validate required fields
    if (!email || !tagId) {
      return new Response(
        JSON.stringify({ error: "Email and tagId are required" }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return new Response(JSON.stringify({ error: "Invalid email format" }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      });
    }

    // Get ConvertKit API secret from environment variables
    const apiSecret = process.env.CONVERTKIT_API_SECRET;
    if (!apiSecret) {
      console.error("CONVERTKIT_API_SECRET environment variable is not set");
      return new Response(
        JSON.stringify({ error: "API configuration error" }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
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
      return new Response(
        JSON.stringify({
          error: "Failed to add tag to user",
          details: responseData.message || "Unknown error",
        }),
        {
          status: convertkitResponse.status,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        }
      );
    }

    // Return successful response
    return new Response(
      JSON.stringify({
        success: true,
        subscription: responseData.subscription,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      }
    );
  } catch (error) {
    console.error("Route handler error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    });
  }
}
