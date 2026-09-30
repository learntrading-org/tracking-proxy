import { NextResponse } from "next/server";
import {
  addKitTag,
  createThriveCartStudent,
  loadKit,
  loadThriveCart,
  removeKitTag,
  THRIVECART_COURSE_ID,
} from "./lib.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: corsHeaders });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: { ...corsHeaders, "Access-Control-Max-Age": "86400" },
  });
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function profile(email) {
  const result = { email, kit: null, thrivecart: null, errors: {} };
  const [kitResult, thriveResult] = await Promise.allSettled([
    loadKit(email),
    loadThriveCart(email),
  ]);
  if (kitResult.status === "fulfilled") result.kit = kitResult.value;
  else result.errors.kit = kitResult.reason?.message || "Kit lookup failed";
  if (thriveResult.status === "fulfilled") result.thrivecart = thriveResult.value;
  else result.errors.thrivecart = thriveResult.reason?.message || "ThriveCart lookup failed";
  return result;
}

export async function POST(request) {
  try {
    const body = await request.json();
    const email = String(body.email || "").trim();
    const action = String(body.action || "load");
    if (!validEmail(email)) {
      return json({ error: "A valid contact email is required" }, 400);
    }

    if (action === "add_tag" || action === "remove_tag") {
      const tagId = String(body.tagId || "").trim();
      if (!/^\d+$/.test(tagId)) return json({ error: "A Kit tag is required" }, 400);
      if (action === "add_tag") await addKitTag(email, tagId);
      else await removeKitTag(email, tagId);
    } else if (action === "create_student") {
      await createThriveCartStudent(email, String(body.name || "").trim());
    } else if (action !== "load") {
      return json({ error: `Unknown action: ${action}` }, 400);
    }

    const data = await profile(email);
    return json({
      ...data,
      courseId: THRIVECART_COURSE_ID,
      message:
        action === "add_tag"
          ? "Kit tag added."
          : action === "remove_tag"
            ? "Kit tag removed."
            : action === "create_student"
              ? `ThriveCart student created for course ${THRIVECART_COURSE_ID}. An access email was sent.`
              : "",
    });
  } catch (error) {
    console.error("contact-profile:", error);
    return json({ error: error?.message || "Request failed" }, 500);
  }
}
