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
            let infoLine = '';

            if (webhookData.type === 'payment.succeeded') {
                messageTitle = 'Whop Payment Succeeded';
                emoji = '✅';
                const amount = data.amount || 0;
                const currency = data.currency || 'USD';
                infoLine = `*Amount:* ${amount / 100} ${currency.toUpperCase()}`;
            } else if (webhookData.type === 'payment.failed') {
                messageTitle = 'Whop Payment Failed';
                emoji = '❌';
                const amount = data.amount || 0;
                const currency = data.currency || 'USD';
                infoLine = `*Failed Amount:* ${amount / 100} ${currency.toUpperCase()}`;
            } else if (webhookData.type === 'refund.created') {
                messageTitle = 'Whop Refund Created';
                emoji = '💸';
                const amount = data.amount || 0;
                const currency = data.currency || 'USD';
                infoLine = `*Refund Amount:* ${amount / 100} ${currency.toUpperCase()}`;
            } else if (webhookData.type === 'dispute.created') {
                messageTitle = 'Whop Dispute Created';
                emoji = '⚠️';
                const amount = data.amount || 0;
                const currency = data.currency || 'USD';
                infoLine = `*Dispute Amount:* ${amount / 100} ${currency.toUpperCase()}`;
            }

            const customerEmail = data.user?.email || data.email || 'Unknown Email';
            const customerName = data.user?.username || data.username || 'Unknown Name';
            const resourceId = data.id || 'Unknown ID';

            const message = `
${emoji} *${messageTitle}* ${emoji}

*Type:* ${webhookData.type}
${infoLine}
*Customer:* ${customerName} (${customerEmail})
*ID:* ${resourceId}
`;

            if (process.env.SLACK_PAYMENT_ALERTS_WEBHOOK_URL) {
                await fetch(process.env.SLACK_PAYMENT_ALERTS_WEBHOOK_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: message }),
                });
                console.log(`Slack alert sent for Whop ${webhookData.type}.`);
            } else {
                console.error('SLACK_PAYMENT_ALERTS_WEBHOOK_URL is not defined');
            }
        }

        return new Response('OK', { status: 200 });
    } catch (err) {
        console.error(`Whop Webhook error: ${err.message}`);
        return new Response(`Webhook Error: ${err.message}`, { status: 400 });
    }
}
