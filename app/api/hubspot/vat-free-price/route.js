// app/api/hubspot/vat-free-price/route.js
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
    const { amount, vat } = fields;

    const amt = parseFloat(amount);
    if (isNaN(amt) || isNaN(v)) {
      throw new Error("Invalid amount or VAT values");
    }
    const vat_free_price = Number((amount / (1 + vat / 100)).toFixed(2));
    // Return success response with the requested format
    return NextResponse.json(
      {
        outputFields: {
          vat_free_price: vat_free_price,
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
