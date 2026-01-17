import { NextResponse } from "next/server";

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

export async function POST(request) {
    try {
        const payload = await request.json();

        // Expecting payload to follow HubSpot Custom Code action format
        // or a direct webhook format. We will extract email and phone.
        // Common pattern for Custom Code Actions: { inputFields: { email: "...", phone: "..." } }

        const { inputFields } = payload;
        const email = inputFields?.email || payload.email;
        const phone = inputFields?.phone || payload.phone;

        console.log("Received Post Contact Data:", {
            email,
            phone,
            fullPayload: payload
        });

        return NextResponse.json({
            message: "Data received",
            receivedData: { email, phone }
        });

    } catch (error) {
        console.error("Error in post-contact-data:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
