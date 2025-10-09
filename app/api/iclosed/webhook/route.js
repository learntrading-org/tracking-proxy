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

    const eventData = payload && payload[0];

    if (!eventData) {
      return NextResponse.json(
        {
          success: true,
          message: "Webhook received but the payload was empty.",
        },
        { status: 200, headers: { "Access-Control-Allow-Origin": "*" } }
      );
    }

    if (eventData.event_type?.slug === "mechanical-rules-strategy-session") {
      const email = eventData.invitee?.email;
      const tagId = 11470881;

      if (email) {
        const apiSecret = process.env.CONVERTKIT_API_SECRET;

        if (!apiSecret) {
          console.error(
            "CONVERTKIT_API_SECRET environment variable is not set. Cannot tag user."
          );
        } else {
          try {
            const convertkitResponse = await fetch(
              `https://api.convertkit.com/v3/tags/${tagId}/subscribe`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json; charset=utf-8" },
                body: JSON.stringify({ api_secret: apiSecret, email: email }),
              }
            );

            if (!convertkitResponse.ok) {
              const responseData = await convertkitResponse.json();
              console.error("ConvertKit API error:", responseData);
            } else {
              console.log(
                `Successfully tagged user ${email} with tag ID ${tagId}.`
              );
            }
          } catch (apiError) {
            console.error(
              "Failed to make a request to the ConvertKit API:",
              apiError
            );
          }
        }
      } else {
        console.warn(
          "Event 'mechanical-rules-strategy-session' was received, but no invitee email was found in the payload."
        );
      }
    } else {
      console.log(
        `Received event type "${eventData.event_type?.slug}", which is not the target event. No action taken.`
      );
    }

    return NextResponse.json(
      {
        success: true,
        message: "Webhook payload received and processed.",
      },
      {
        status: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (error) {
    console.error("Error processing iclosed.io webhook:", error);

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
