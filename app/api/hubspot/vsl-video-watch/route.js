// app/api/hubspot/vsl-video-watch/route.js
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
        const { email, percentage } = payload;

        if (!email || percentage === undefined) {
            return NextResponse.json(
                { error: "Email and percentage are required" },
                { status: 400, headers: { "Access-Control-Allow-Origin": "*" } }
            );
        }

        const token = process.env.HUBSPOT_ACCESS_TOKEN;
        if (!token) {
            console.error("Missing HUBSPOT_ACCESS_TOKEN");
            return NextResponse.json(
                { error: "Server configuration error" },
                { status: 500, headers: { "Access-Control-Allow-Origin": "*" } }
            );
        }

        // 1. Search for existing contact by email
        const searchUrl = "https://api.hubapi.com/crm/v3/objects/contacts/search";
        const searchResponse = await fetch(searchUrl, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                filterGroups: [
                    {
                        filters: [
                            {
                                propertyName: "email",
                                operator: "EQ",
                                value: email,
                            },
                        ],
                    },
                ],
                properties: ["email", "vsl_video_watch"],
            }),
        });

        if (!searchResponse.ok) {
            const errorText = await searchResponse.text();
            throw new Error(`HubSpot Search API error: ${errorText}`);
        }

        const searchData = await searchResponse.json();
        const contact = searchData.results?.[0]; // Get the first matching contact

        let result;

        if (contact) {
            // 2. Update existing contact
            const contactId = contact.id;
            const updateUrl = `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}`;
            const updateResponse = await fetch(updateUrl, {
                method: "PATCH",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    properties: {
                        vsl_video_watch: percentage / 100,
                    },
                }),
            });

            if (!updateResponse.ok) {
                const errorText = await updateResponse.text();
                throw new Error(`HubSpot Update API error: ${errorText}`);
            }

            result = await updateResponse.json();
            console.log(`Updated contact ${contactId} with vsl_video_watch: ${percentage}`);

        } else {
            // 3. Create new contact
            const createUrl = "https://api.hubapi.com/crm/v3/objects/contacts";
            const createResponse = await fetch(createUrl, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    properties: {
                        email: email,
                        vsl_video_watch: percentage / 100,
                    },
                }),
            });

            if (!createResponse.ok) {
                const errorText = await createResponse.text();
                throw new Error(`HubSpot Create API error: ${errorText}`);
            }

            result = await createResponse.json();
            console.log(`Created new contact ${result.id} with vsl_video_watch: ${percentage}`);
        }

        return NextResponse.json(
            {
                status: "success",
                message: contact ? "Contact updated" : "Contact created",
                contactId: result.id,
            },
            {
                status: 200,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                },
            }
        );

    } catch (error) {
        console.error("Error processing request:", error);
        return NextResponse.json(
            { error: "Internal server error", details: error.message },
            {
                status: 500,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                },
            }
        );
    }
}
