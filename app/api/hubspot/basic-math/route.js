// app/api/hubspot/basic-math/route.js
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
    const { number1, number2, operator } = fields;

    // Safely parse numbers, default to 0 if invalid/missing
    const num1 = parseFloat(number1) || 0;
    const num2 = parseFloat(number2) || 0;

    let result = 0;
    switch (operator) {
      case "add":
        result = num1 + num2;
        break;
      case "subtract":
        result = num1 - num2;
        break;
      case "multiply":
        result = num1 * num2;
        break;
      case "divide":
        if (num2 !== 0) {
          result = num1 / num2;
        } else {
          console.warn("Division by zero attempted; returning 0");
          result = 0; // Or throw an error if you prefer to fail the action
        }
        break;
      default:
        throw new Error("Invalid operator");
    }

    // Round to 2 decimal places for consistency
    const finalResult = Number(result.toFixed(2));

    // Return success response in the exact format HubSpot expects
    return NextResponse.json(
      {
        outputFields: {
          result: finalResult,
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
    console.error("Error processing basic-math action:", error);
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
