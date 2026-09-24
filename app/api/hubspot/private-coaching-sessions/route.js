// app/api/hubspot/private-coaching-sessions/route.js
import { NextResponse } from "next/server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

// "4 Private Coaching Sessions" → 4. Missing phrase → 0.
const PRIVATE_COACHING_COUNT = /(\d+)\s+private\s+coaching\b/i;

export function extractPrivateCoachingCount(value) {
  if (value == null || value === "") return 0;

  const text = typeof value === "string" ? value : JSON.stringify(value);
  const match = text.match(PRIVATE_COACHING_COUNT);
  if (!match) return 0;

  const count = Number.parseInt(match[1], 10);
  return Number.isInteger(count) ? count : 0;
}

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
    const privateCoachingSessions = extractPrivateCoachingCount(programDeliverables);

    console.log("Private coaching sessions count:", privateCoachingSessions);

    return NextResponse.json(
      {
        outputFields: {
          private_coaching_sessions: privateCoachingSessions,
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
