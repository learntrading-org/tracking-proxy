// app/api/hubspot/docuseal-agreement/route.js
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
    const { email, firstName, lastName } = fields;

    const apiToken = process.env.DOCUSEAL_API_TOKEN;

    if (!apiToken) {
      throw new Error("DocuSeal API token is not set");
    }

    const submitter = {
      email,
      role: "Platinum Signer",
    };

    let fullName;
    if (firstName) {
      fullName = `${firstName}${lastName ? ` ${lastName}` : ""}`;
      submitter.name = fullName;
      submitter.fields = [
        {
          name: "Full Name",
          default_value: fullName,
          readonly: false,
        },
      ];
    }

    const requestBody = {
      template_id: "301737",
      submitters: [submitter],
      send_email: true,
      message: {
        subject: 'eSignature request for "BULLMANIA PLATINUM AGREEMENT"',
        body: "Hi there, \n\nWelcome to Bullmania, and thank you for joining us! \n\nYour agreement has been sent for your eSignature. Please click the link below to review and sign the document:\n{{submitter.link}} \n\nIf your subscription includes 1-on-1 coaching, our team will reach out shortly to schedule your first session.\n\nIf you have any questions, feel free to contact us at hello@bullmania.com.\n\nThank you and welcome aboard,\nThe Bullmania Team",
      },
    };

    const response = await fetch("https://api.docuseal.com/submissions", {
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
