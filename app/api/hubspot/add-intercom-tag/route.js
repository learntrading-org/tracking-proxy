import { NextResponse } from "next/server";

export async function POST(request) {
    try {
        const payload = await request.json();

        // Extract email and tag_id from payload
        // Supporting both direct payload and HubSpot inputFields structure
        const { inputFields } = payload;
        const email = inputFields?.email || payload.email;
        const tag_id = inputFields?.tag_id || payload.tag_id;

        console.log("Received Add Intercom Tag Request:", { email, tag_id });

        if (!email) {
            return NextResponse.json({ error: "Email is required" }, { status: 400 });
        }
        if (!tag_id) {
            return NextResponse.json({ error: "Tag ID is required" }, { status: 400 });
        }

        const intercomToken = process.env.INTERCOM_ACCESS_TOKEN;
        if (!intercomToken) {
            console.error("Missing INTERCOM_ACCESS_TOKEN");
            return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
        }

        const INTERCOM_VERSION = "2.14";
        const headers = {
            "Authorization": `Bearer ${intercomToken}`,
            "Content-Type": "application/json",
            "Intercom-Version": INTERCOM_VERSION,
            "Accept": "application/json"
        };

        // 1. Search for Contact
        const searchRes = await fetch("https://api.intercom.io/contacts/search", {
            method: "POST",
            headers,
            body: JSON.stringify({
                query: {
                    field: "email",
                    operator: "=",
                    value: email
                }
            })
        });

        if (!searchRes.ok) {
            const errText = await searchRes.text();
            throw new Error(`Intercom Search Failed: ${searchRes.status} ${errText}`);
        }

        const searchData = await searchRes.json();
        let contact = searchData.data?.[0]; // Take first match
        let contactId;

        // 2. Create if not found
        if (!contact) {
            console.log("Contact not found in Intercom. Creating new one.");
            const createBody = {
                role: "user",
                email: email
            };

            const createRes = await fetch("https://api.intercom.io/contacts", {
                method: "POST",
                headers,
                body: JSON.stringify(createBody)
            });

            if (!createRes.ok) {
                const errText = await createRes.text();
                throw new Error(`Intercom Create Failed: ${createRes.status} ${errText}`);
            }

            const createData = await createRes.json();
            contactId = createData.id;
        } else {
            console.log(`Contact found: ${contact.id}`);
            contactId = contact.id;
        }

        // 3. Add Tag
        if (contactId) {
            console.log(`Applying tag ${tag_id} to contact ${contactId}`);

            const tagRes = await fetch(`https://api.intercom.io/contacts/${contactId}/tags`, {
                method: "POST",
                headers,
                body: JSON.stringify({
                    id: tag_id
                })
            });

            if (!tagRes.ok) {
                const errText = await tagRes.text();
                console.error(`Intercom Tag Failed: ${tagRes.status} ${errText}`);
                throw new Error(`Intercom Tag Failed: ${tagRes.status}`);
            }
            console.log("Tag applied successfully.");
        }

        return NextResponse.json({
            message: "Processed",
            result: {
                contactId,
                tagged: true,
                email,
                tag_id
            }
        });

    } catch (error) {
        console.error("Error in add-intercom-tag:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
