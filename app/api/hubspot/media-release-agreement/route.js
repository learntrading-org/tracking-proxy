// app/api/hubspot/media-release-agreement/route.js
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

    const { fields } = payload;
    const { email, firstName, lastName } = fields || {};

    const apiToken = process.env.DOCUSEAL_API_TOKEN;

    if (!apiToken) {
      throw new Error("DocuSeal API token is not set");
    }

    // Handle null or empty cases for firstName and lastName
    const first = firstName || "";
    const last = lastName || "";
    const fullName = [first, last].filter(Boolean).join(" ");

    const submitter = {
      email: email || "",
      fields: [
        {
          name: "Full Name",
          default_value: fullName,
        },
        {
          name: "Email",
          default_value: email || "",
        },
      ],
    };

    const requestBody = {
      template_id: "355760",
      submitters: [submitter],
      send_email: true,
      message: {
        subject: 'eSignature request for "Media Release Form Agreement"',
        body: "Hi there, \n\nYour Media Release Form Agreement has been sent for your eSignature. Please click the link below to review and sign the document:\n{{submitter.link}} \n\nIf you have any questions, feel free to contact us at hello@bullmania.com.\n\nThank you",
      },
    };

    const response = await fetch("https://api.docuseal.eu/submissions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Auth-Token": apiToken,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw new Error(`DocuSeal API error: ${await response.text()}`);
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
