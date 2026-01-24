// app/api/hubspot/tag-no-show/route.js
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

/**
 * Helper function to check if a subscriber exists in ConvertKit
 * @param {string} email - The email to check
 * @param {string} apiSecret - ConvertKit API secret
 * @returns {Promise<boolean>} - True if subscriber exists, false otherwise
 */
async function checkSubscriberExists(email, apiSecret) {
    try {
        const response = await fetch(
            `https://api.convertkit.com/v3/subscribers?api_secret=${apiSecret}&email_address=${encodeURIComponent(email)}`,
            {
                method: "GET",
                headers: {
                    "Content-Type": "application/json; charset=utf-8",
                },
            }
        );

        if (!response.ok) {
            console.error(`ConvertKit subscriber check failed: ${response.status}`);
            return false;
        }

        const data = await response.json();
        const subscribers = data.subscribers || [];

        if (subscribers.length > 0) {
            console.log(`Subscriber exists in ConvertKit: ${email}`);
            return true;
        }

        console.log(`Subscriber does not exist in ConvertKit: ${email}`);
        return false;
    } catch (error) {
        console.error(`Error checking subscriber existence: ${error.message}`);
        return false;
    }
}

/**
 * Helper function to subscribe a user and add a tag in ConvertKit
 * @param {string} email - The email to subscribe and tag
 * @param {string} tagId - The tag ID to add
 * @param {string} apiSecret - ConvertKit API secret
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function subscribeAndTag(email, tagId, apiSecret) {
    try {
        const convertkitResponse = await fetch(
            `https://api.convertkit.com/v3/tags/${tagId}/subscribe`,
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
            console.error(`ConvertKit API error for tag ${tagId} and email ${email}:`, responseData);
            return {
                success: false,
                message: responseData.message || "Failed to subscribe and tag user",
            };
        }

        console.log(`Successfully subscribed and tagged user ${email} with tag ID ${tagId}`);
        return {
            success: true,
            message: "User subscribed and tagged successfully",
            subscription: responseData.subscription,
        };
    } catch (error) {
        console.error(`Failed to make ConvertKit API request: ${error.message}`);
        return {
            success: false,
            message: error.message,
        };
    }
}

// Handle the main webhook POST request
export async function POST(request) {
    try {
        const payload = await request.json();
        console.log("Received HubSpot no-show webhook:", payload);

        // Extract email from payload
        // HubSpot can send data in different formats, handle common cases
        const email = payload.email || payload.inputFields?.email || payload.properties?.email;

        // Validate email
        if (!email) {
            console.warn("No email found in HubSpot webhook payload");
            return NextResponse.json(
                {
                    success: false,
                    message: "Email is required",
                },
                {
                    status: 400,
                    headers: {
                        "Access-Control-Allow-Origin": "*",
                    },
                }
            );
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            console.warn(`Invalid email format: ${email}`);
            return NextResponse.json(
                {
                    success: false,
                    message: "Invalid email format",
                },
                {
                    status: 400,
                    headers: {
                        "Access-Control-Allow-Origin": "*",
                    },
                }
            );
        }

        // Get ConvertKit API secret from environment variables
        const apiSecret = process.env.CONVERTKIT_API_SECRET;
        if (!apiSecret) {
            console.error("CONVERTKIT_API_SECRET environment variable is not set");
            return NextResponse.json(
                {
                    success: false,
                    message: "API configuration error",
                },
                {
                    status: 500,
                    headers: {
                        "Access-Control-Allow-Origin": "*",
                    },
                }
            );
        }

        // Tag ID for no-show users
        const NO_SHOW_TAG_ID = "14879158";

        // Check if subscriber exists (optional check before subscribing)
        const subscriberExists = await checkSubscriberExists(email, apiSecret);

        if (subscriberExists) {
            console.log(`User ${email} already exists in ConvertKit. Adding tag...`);
        } else {
            console.log(`User ${email} does not exist in ConvertKit. Creating subscriber and adding tag...`);
        }

        // Subscribe and tag the user (this works for both existing and new subscribers)
        const result = await subscribeAndTag(email, NO_SHOW_TAG_ID, apiSecret);

        if (!result.success) {
            return NextResponse.json(
                {
                    success: false,
                    message: result.message,
                },
                {
                    status: 500,
                    headers: {
                        "Access-Control-Allow-Origin": "*",
                    },
                }
            );
        }

        // Return success response
        return NextResponse.json(
            {
                success: true,
                message: subscriberExists
                    ? "Existing subscriber tagged successfully"
                    : "New subscriber created and tagged successfully",
                email: email,
                tagId: NO_SHOW_TAG_ID,
                subscriberExists: subscriberExists,
            },
            {
                status: 200,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                },
            }
        );
    } catch (error) {
        console.error("Error processing HubSpot no-show webhook:", error);
        return NextResponse.json(
            {
                success: false,
                error: "Internal server error",
                message: error.message,
            },
            {
                status: 500,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                },
            }
        );
    }
}
