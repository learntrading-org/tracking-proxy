// app/api/hubspot/private-coaching-sessions/route.js
import { NextResponse } from "next/server";
import { parsePrivateCoaching } from "./parse.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function readProgramDeliverables(payload) {
  const fields = payload?.fields || payload?.inputFields || {};
  if (fields.program_deliverables != null) return fields.program_deliverables;

  const key = Object.keys(fields).find(
    (name) => name.toLowerCase() === "program_deliverables"
  );
  return key ? fields[key] : "";
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: CORS_HEADERS,
  });
}

export async function POST(request) {
  try {
    const payload = await request.json();
    const programDeliverables = readProgramDeliverables(payload);
    const result = parsePrivateCoaching(programDeliverables);

    console.log("Private coaching sessions:", result);

    return NextResponse.json(
      { outputFields: result },
      {
        status: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (error) {
    console.error("Error processing private-coaching-sessions action:", error);
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
