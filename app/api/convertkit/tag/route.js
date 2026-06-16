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
    const body = await request.json();
    const { email, tagId, utm } = body;
    console.log({ email, tagId, utm });

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

    // Extract UTM parameters
    const fields = {};
    if (utm && typeof utm === "object") {
      const campaign = utm.utm_campaign || utm.utmCampaign || utm.campaign || utm.Campaign || utm["UTM Campaign"];
      const content = utm.utm_content || utm.utmContent || utm.content || utm.Content || utm["UTM Content"];
      const medium = utm.utm_medium || utm.utmMedium || utm.medium || utm.Medium || utm["UTM Medium"];
      const source = utm.utm_source || utm.utmSource || utm.source || utm.Source || utm["UTM Source"];

      if (campaign !== undefined && campaign !== null && String(campaign).trim() !== "") fields.utm_campaign = campaign;
      if (content !== undefined && content !== null && String(content).trim() !== "") fields.utm_content = content;
      if (medium !== undefined && medium !== null && String(medium).trim() !== "") fields.utm_medium = medium;
      if (source !== undefined && source !== null && String(source).trim() !== "") fields.utm_source = source;
    }

    // Also check root level as fallback
    const rootCampaign = body.utm_campaign || body.utmCampaign || body["UTM Campaign"];
    const rootContent = body.utm_content || body.utmContent || body["UTM Content"];
    const rootMedium = body.utm_medium || body.utmMedium || body["UTM Medium"];
    const rootSource = body.utm_source || body.utmSource || body["UTM Source"];

    if (rootCampaign !== undefined && rootCampaign !== null && String(rootCampaign).trim() !== "" && fields.utm_campaign === undefined) {
      fields.utm_campaign = rootCampaign;
    }
    if (rootContent !== undefined && rootContent !== null && String(rootContent).trim() !== "" && fields.utm_content === undefined) {
      fields.utm_content = rootContent;
    }
    if (rootMedium !== undefined && rootMedium !== null && String(rootMedium).trim() !== "" && fields.utm_medium === undefined) {
      fields.utm_medium = rootMedium;
    }
    if (rootSource !== undefined && rootSource !== null && String(rootSource).trim() !== "" && fields.utm_source === undefined) {
      fields.utm_source = rootSource;
    }

    console.log("Parsed UTM fields for ConvertKit:", fields);

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
          ...(Object.keys(fields).length > 0 ? { fields } : {}),
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
