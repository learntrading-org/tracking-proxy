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
        const { email, percentage, utm } = payload;

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

        // Extract UTM parameters
        const fields = {};
        if (utm && typeof utm === "object") {
            const campaign = utm.utm_campaign || utm.utmCampaign || utm.campaign || utm.Campaign || utm["UTM Campaign"];
            const content = utm.utm_content || utm.utmContent || utm.content || utm.Content || utm["UTM Content"];
            const medium = utm.utm_medium || utm.utmMedium || utm.medium || utm.Medium || utm["UTM Medium"];
            const source = utm.utm_source || utm.utmSource || utm.source || utm.Source || utm["UTM Source"];

            if (campaign !== undefined && campaign !== null && String(campaign).trim() !== "") fields.utm_campaign = campaign;
            if (content !== undefined && content !== null && String(content).trim() !== "") fields.utm_content = content;
            if (medium !== undefined && medium !== null && String(medium).trim() !== "") fields.utm_medium = medium;
            if (source !== undefined && source !== null && String(source).trim() !== "") fields.utm_source = source;
        }

        // Also check root level as fallback
        const rootCampaign = payload.utm_campaign || payload.utmCampaign || payload["UTM Campaign"];
        const rootContent = payload.utm_content || payload.utmContent || payload["UTM Content"];
        const rootMedium = payload.utm_medium || payload.utmMedium || payload["UTM Medium"];
        const rootSource = payload.utm_source || payload.utmSource || payload["UTM Source"];

        if (rootCampaign !== undefined && rootCampaign !== null && String(rootCampaign).trim() !== "" && fields.utm_campaign === undefined) {
            fields.utm_campaign = rootCampaign;
        }
        if (rootContent !== undefined && rootContent !== null && String(rootContent).trim() !== "" && fields.utm_content === undefined) {
            fields.utm_content = rootContent;
        }
        if (rootMedium !== undefined && rootMedium !== null && String(rootMedium).trim() !== "" && fields.utm_medium === undefined) {
            fields.utm_medium = rootMedium;
        }
        if (rootSource !== undefined && rootSource !== null && String(rootSource).trim() !== "" && fields.utm_source === undefined) {
            fields.utm_source = rootSource;
        }

        console.log("Parsed UTM fields for HubSpot:", fields);

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
            const currentWatchStr = contact.properties.vsl_video_watch;
            const currentWatchDecimal = currentWatchStr ? parseFloat(currentWatchStr) : 0;
            const newWatchDecimal = percentage / 100;

            const updateProperties = {};
            
            // Only update vsl_video_watch if the new watch percentage is higher, or it wasn't set yet
            if (newWatchDecimal > currentWatchDecimal || !currentWatchStr) {
                updateProperties.vsl_video_watch = newWatchDecimal;
            }

            // Always add the UTM parameters if they exist
            Object.assign(updateProperties, fields);

            if (Object.keys(updateProperties).length > 0) {
                const updateUrl = `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}`;
                const updateResponse = await fetch(updateUrl, {
                    method: "PATCH",
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        properties: updateProperties,
                    }),
                });

                if (!updateResponse.ok) {
                    const errorText = await updateResponse.text();
                    throw new Error(`HubSpot Update API error: ${errorText}`);
                }

                result = await updateResponse.json();
                console.log(`Updated contact ${contactId} with properties:`, updateProperties);
            } else {
                console.log(`Skipped updating contact ${contactId}. Current vsl_video_watch (${currentWatchDecimal * 100}%) is >= new value (${percentage}%) and no new UTM values to update.`);
                result = contact; // Return existing contact info
            }

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
                        ...fields,
                    },
                }),
            });

            if (!createResponse.ok) {
                const errorText = await createResponse.text();
                throw new Error(`HubSpot Create API error: ${errorText}`);
            }

            result = await createResponse.json();
            console.log(`Created new contact ${result.id} with vsl_video_watch: ${percentage} and UTM fields:`, fields);
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
