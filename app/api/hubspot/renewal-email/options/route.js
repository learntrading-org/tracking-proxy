import { NextResponse } from "next/server";
import {
  CORS_HEADERS,
  TEMPLATES,
  listIntercomAdmins,
  resolveAdmin,
  SENDER_EMAIL,
} from "../lib";

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: CORS_HEADERS });
}

export async function GET() {
  try {
    const token = process.env.INTERCOM_ACCESS_TOKEN;
    if (!token) {
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500, headers: CORS_HEADERS }
      );
    }

    const admins = await listIntercomAdmins(token);
    const defaultAdmin = resolveAdmin(admins);

    return NextResponse.json(
      {
        templates: TEMPLATES,
        admins,
        defaultAdminId: defaultAdmin?.id || "",
        senderEmail: SENDER_EMAIL,
      },
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (error) {
    console.error("Failed to load renewal email options:", error);
    return NextResponse.json(
      { error: error.message || "Failed to load options" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
