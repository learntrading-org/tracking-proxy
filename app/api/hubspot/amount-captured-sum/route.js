// app/api/hubspot/amount-captured-sum/route.js
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
    const { captured_this_far, payment_amount } = fields;

    const captured = parseFloat(captured_this_far) || 0;
    const payment = parseFloat(payment_amount) || 0;

    const updated_captured_this_far = Number((captured + payment).toFixed(2));

    return NextResponse.json(
      {
        outputFields: {
          updated_captured_this_far: updated_captured_this_far,
        },
      },
      {
        status: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (error) {
    console.error("Error processing amount-captured-sum action:", error);
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
