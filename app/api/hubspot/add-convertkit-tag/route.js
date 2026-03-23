import { NextResponse } from "next/server";

export async function POST(request) {
    try {
        const payload = await request.json();

        // Extract email and tag_id from payload
        // Supporting both direct payload and HubSpot inputFields structure
        const { inputFields } = payload;
        const email = inputFields?.email || payload.email;
        const tag_id = inputFields?.tag_id || payload.tag_id || payload.tagId;

        console.log("Received Add ConvertKit Tag Request:", { email, tag_id });

        if (!email) {
            return NextResponse.json({ error: "Email is required" }, { status: 400 });
        }
        if (!tag_id) {
            return NextResponse.json({ error: "Tag ID is required" }, { status: 400 });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
        }

        const apiSecret = process.env.CONVERTKIT_API_SECRET;
        if (!apiSecret) {
            console.error("Missing CONVERTKIT_API_SECRET");
            return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
        }

        console.log(`Applying ConvertKit tag ${tag_id} to contact ${email}`);

        // Make request to ConvertKit API
        const convertkitResponse = await fetch(
            `https://api.convertkit.com/v3/tags/${tag_id}/subscribe`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json; charset=utf-8",
                },
                body: JSON.stringify({
                    api_secret: apiSecret,
                    email: email,
                }),
            }
        );

        const responseData = await convertkitResponse.json();

        if (!convertkitResponse.ok) {
            console.error("ConvertKit API error:", responseData);
            throw new Error(`ConvertKit Tag Failed: ${convertkitResponse.status} ${responseData.message || JSON.stringify(responseData)}`);
        }

        console.log("Tag applied successfully.");

        return NextResponse.json({
            message: "Processed",
            result: {
                success: true,
                tagged: true,
                email,
                tag_id,
                subscription: responseData.subscription
            }
        });

    } catch (error) {
        console.error("Error in add-convertkit-tag:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
