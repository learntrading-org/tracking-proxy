import { headers } from 'next/headers';
import { Whop } from '@whop/sdk';

export async function POST(req) {
    const whopsdk = new Whop({
        apiKey: process.env.WHOP_API_KEY || 'dummy_api_key',
        webhookKey: Buffer.from(process.env.WHOP_WEBHOOK_SECRET || '').toString('base64'),
    });

    try {
        const body = await req.text();
        const requestHeaders = Object.fromEntries(await headers());

        const webhookData = whopsdk.webhooks.unwrap(body, { headers: requestHeaders });

        if (
            webhookData.type === 'payment.succeeded' ||
            webhookData.type === 'payment.failed' ||
            webhookData.type === 'refund.created' ||
            webhookData.type === 'dispute.created'
        ) {
            const data = webhookData.data;

            // Prepare dynamic message content depending on webhook type
            let messageTitle = 'Unknown Whop Event';
            let emoji = '🚨';
            let amountField = '';
            
            // Format amounts properly if present
            const amount = data.amount || 0;
            const currency = (data.currency || 'USD').toUpperCase();
            const formattedAmount = `${amount / 100} ${currency}`;

            if (webhookData.type === 'payment.succeeded') {
                messageTitle = 'Whop Payment Succeeded';
                emoji = '✅';
                amountField = `*Amount:*\n${formattedAmount}`;
            } else if (webhookData.type === 'payment.failed') {
                messageTitle = 'Whop Payment Failed';
                emoji = '❌';
                amountField = `*Failed Amount:*\n${formattedAmount}`;
            } else if (webhookData.type === 'refund.created') {
                messageTitle = 'Whop Refund Created';
                emoji = '💸';
                amountField = `*Refund Amount:*\n${formattedAmount}`;
            } else if (webhookData.type === 'dispute.created') {
                messageTitle = 'Whop Dispute Created';
                emoji = '⚠️';
                amountField = `*Dispute Amount:*\n${formattedAmount}`;
            }

            const customerEmail = data.user?.email || data.payment?.user?.email || data.customer_email_address || data.email;
            const customerName = data.user?.username || data.payment?.user?.username || data.customer_name || data.username;
            const resourceId = data.id || 'Unknown ID';

            // Build Slack Block Kit fields
            const fields = [
                {
                    type: "mrkdwn",
                    text: `*Type:*\n${webhookData.type}`
                },
                {
                    type: "mrkdwn",
                    text: amountField
                }
            ];

            // Only add customer field if we have at least some customer data
            if (customerName || customerEmail) {
                const nameStr = customerName || 'Unknown';
                const emailStr = customerEmail ? `(${customerEmail})` : '';
                fields.push({
                    type: "mrkdwn",
                    text: `*Customer:*\n${nameStr} ${emailStr}`
                });
            }

            fields.push({
                type: "mrkdwn",
                text: `*ID:*\n\`${resourceId}\``
            });

            // Create the Block Kit payload
            const slackPayload = {
                text: `${emoji} ${messageTitle}`, // Fallback text for notifications
                blocks: [
                    {
                        type: "header",
                        text: {
                            type: "plain_text",
                            text: `${emoji} ${messageTitle}`,
                            emoji: true
                        }
                    },
                    {
                        type: "section",
                        fields: fields
                    },
                    {
                        type: "divider"
                    }
                ]
            };

            if (process.env.SLACK_WEBHOOK_URL) {
                await fetch(process.env.SLACK_WEBHOOK_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(slackPayload),
                });
                console.log(`Slack alert sent for Whop ${webhookData.type}.`);
            } else {
                console.error('SLACK_WEBHOOK_URL is not defined');
            }
        }

        return new Response('OK', { status: 200 });
    } catch (err) {
        console.error(`Whop Webhook error: ${err.message}`);
        return new Response(`Webhook Error: ${err.message}`, { status: 400 });
    }
}
