import { NextResponse } from "next/server";
import {
  CORS_HEADERS,
  TEMPLATES,
  listOnBehalfAdmins,
  resolveAdmin,
  SENDER_EMAIL,
} from "../lib";

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: CORS_HEADERS });
}

export async function GET() {
  const admins = listOnBehalfAdmins();
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
}
