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

        console.log("Received Post Contact Data:", { email, phone });

        if (!email) {
            return NextResponse.json({ error: "Email is required" }, { status: 400 });
        }

        const intercomToken = process.env.INTERCOM_ACCESS_TOKEN;
        if (!intercomToken) {
            console.error("Missing INTERCOM_ACCESS_TOKEN");
            return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
        }

        const TAG_ID = "13041517"; // WhatsApp Connect
        const INTERCOM_VERSION = "2.14";
        const headers = {
            "Authorization": `Bearer ${intercomToken}`,
            "Content-Type": "application/json",
            "Intercom-Version": INTERCOM_VERSION,
            "Accept": "application/json"
        };

        // Helper to format phone to E.164 roughly (if not already)
        // Intercom is strict, so we attempt to ensure it starts with + and has no spaces/dashes
        const formatPhone = (p) => {
            if (!p) return null;
            let clean = p.replace(/[^\d+]/g, '');
            // Handle 00 prefix
            if (clean.startsWith('00')) {
                clean = '+' + clean.substring(2);
            }
            if (!clean.startsWith('+')) {
                // If missing +, and looks like it might have country code (e.g. 11+ chars), we could prepend + potentially
                // But usually safest to leave as is and let validation fail/fallback.
            }
            return clean.length >= 7 ? clean : null;
        };
        const formattedPhone = formatPhone(phone);

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
        let phoneSaved = false;

        // 2. Create or Update
        if (!contact) {
            console.log("Contact not found in Intercom. Creating new one.");
            const createBody = {
                role: "user",
                email: email
            };
            if (formattedPhone) {
                createBody.phone = formattedPhone;
            }

            const createRes = await fetch("https://api.intercom.io/contacts", {
                method: "POST",
                headers,
                body: JSON.stringify(createBody)
            });

            if (!createRes.ok) {
                const errText = await createRes.text();
                // Check if it's a phone validation error (422)
                if (createRes.status === 422 && errText.includes("phone")) {
                    console.warn(`Intercom rejected phone number (${formattedPhone}). Retrying creation without phone.`);

                    // Retry without phone
                    const retryBody = { role: "user", email: email };
                    const retryRes = await fetch("https://api.intercom.io/contacts", {
                        method: "POST",
                        headers,
                        body: JSON.stringify(retryBody)
                    });

                    if (!retryRes.ok) {
                        const retryErr = await retryRes.text();
                        throw new Error(`Intercom Create Retry Failed: ${retryRes.status} ${retryErr}`);
                    }

                    const retryData = await retryRes.json();
                    contactId = retryData.id;
                    phoneSaved = false;

                } else {
                    throw new Error(`Intercom Create Failed: ${createRes.status} ${errText}`);
                }
            } else {
                const createData = await createRes.json();
                contactId = createData.id;
                if (formattedPhone) phoneSaved = true;
            }

        } else {
            console.log(`Contact found: ${contact.id}`);
            contactId = contact.id;

            // Check if phone needs adding
            const existingPhone = contact.phone;
            if (existingPhone) {
                phoneSaved = true;
            }

            // "if the contact does not have a mobile number we need to ... add the mobile number."
            if (!existingPhone && formattedPhone) {
                console.log("Contact missing phone. Updating...");
                const updateRes = await fetch(`https://api.intercom.io/contacts/${contactId}`, {
                    method: "PUT",
                    headers,
                    body: JSON.stringify({
                        phone: formattedPhone
                    })
                });

                if (!updateRes.ok) {
                    const errText = await updateRes.text();
                    console.error(`Intercom Update Phone Failed: ${updateRes.status} ${errText}`);
                    // We proceed to tag even if phone update fails
                    phoneSaved = false;
                } else {
                    console.log("Phone updated successfully.");
                    phoneSaved = true;
                }
            }
        }

        // 3. Add Tag
        if (contactId) {
            console.log(`Applying tag ${TAG_ID} to contact ${contactId}`);
            const tagRes = await fetch(`https://api.intercom.io/contacts/${contactId}/tags`, {
                method: "POST",
                headers,
                body: JSON.stringify({
                    id: TAG_ID
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
                phoneSaved
            }
        });

    } catch (error) {
        console.error("Error in post-contact-data:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
