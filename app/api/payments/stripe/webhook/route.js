import { headers } from 'next/headers';
import Stripe from 'stripe';

/**
 * Helper to extract subscription or product name from Stripe event payload
 * and query Stripe API as fallback when necessary.
 */
async function getSubscriptionOrProductName(stripe, eventType, data) {
    try {
        // 1. Invoice events
        if (eventType.startsWith('invoice.')) {
            const lines = data.lines?.data || [];
            if (lines.length > 0) {
                const firstLine = lines[0];
                if (firstLine.description) return firstLine.description;
                if (firstLine.price?.nickname) return firstLine.price.nickname;
                if (firstLine.plan?.nickname) return firstLine.plan.nickname;

                const product = firstLine.price?.product || firstLine.plan?.product;
                if (product && typeof product === 'object' && product.name) {
                    return product.name;
                }
                const productId = typeof product === 'string' ? product : null;
                if (productId && process.env.STRIPE_SECRET_KEY) {
                    const prod = await stripe.products.retrieve(productId);
                    if (prod?.name) return prod.name;
                }
            }

            if (data.subscription && typeof data.subscription === 'string' && process.env.STRIPE_SECRET_KEY) {
                const sub = await stripe.subscriptions.retrieve(data.subscription, {
                    expand: ['items.data.price.product'],
                });
                const itemProduct = sub.items?.data?.[0]?.price?.product;
                if (itemProduct && typeof itemProduct === 'object' && itemProduct.name) {
                    return itemProduct.name;
                }
            }
        }

        // 2. Checkout Session events
        if (eventType === 'checkout.session.completed') {
            if (process.env.STRIPE_SECRET_KEY) {
                try {
                    const lineItems = await stripe.checkout.sessions.listLineItems(data.id, {
                        limit: 5,
                        expand: ['data.price.product'],
                    });
                    if (lineItems?.data?.length > 0) {
                        const names = lineItems.data
                            .map((item) => {
                                const product = item.price?.product;
                                return (
                                    (product && typeof product === 'object' && product.name) ||
                                    item.description ||
                                    null
                                );
                            })
                            .filter(Boolean);
                        if (names.length > 0) return names.join(', ');
                    }
                } catch (e) {
                    console.warn('Could not retrieve line items for checkout session:', e.message);
                }
            }

            if (data.subscription && typeof data.subscription === 'string' && process.env.STRIPE_SECRET_KEY) {
                const sub = await stripe.subscriptions.retrieve(data.subscription, {
                    expand: ['items.data.price.product'],
                });
                const itemProduct = sub.items?.data?.[0]?.price?.product;
                if (itemProduct && typeof itemProduct === 'object' && itemProduct.name) {
                    return itemProduct.name;
                }
            }
        }

        // 3. Payment Intent events
        if (eventType.startsWith('payment_intent.')) {
            if (data.description) return data.description;
            if (data.metadata?.product_name || data.metadata?.subscription_name) {
                return data.metadata.product_name || data.metadata.subscription_name;
            }
        }

        // 4. Subscription lifecycle events
        if (eventType.startsWith('customer.subscription.')) {
            const items = data.items?.data || [];
            if (items.length > 0) {
                const firstItem = items[0];
                if (firstItem.price?.nickname) return firstItem.price.nickname;
                if (firstItem.plan?.nickname) return firstItem.plan.nickname;
                const product = firstItem.price?.product || firstItem.plan?.product;
                if (product && typeof product === 'object' && product.name) {
                    return product.name;
                }
                const productId = typeof product === 'string' ? product : null;
                if (productId && process.env.STRIPE_SECRET_KEY) {
                    const prod = await stripe.products.retrieve(productId);
                    if (prod?.name) return prod.name;
                }
            }
        }
    } catch (err) {
        console.warn(`Could not resolve subscription/product name for ${eventType}:`, err.message);
    }
    return null;
}

/**
 * Helper to retrieve customer email and name safely.
 */
async function getCustomerDetails(stripe, data) {
    let email =
        data.customer_email ||
        data.customer_details?.email ||
        data.email ||
        data.receipt_email ||
        null;
    let name =
        data.customer_name ||
        data.customer_details?.name ||
        data.name ||
        null;

    if ((!email || !name) && data.customer && typeof data.customer === 'string' && process.env.STRIPE_SECRET_KEY) {
        try {
            const customer = await stripe.customers.retrieve(data.customer);
            if (!customer.deleted) {
                if (!email) email = customer.email || null;
                if (!name) name = customer.name || null;
            }
        } catch (err) {
            console.warn('Could not retrieve customer details from Stripe API:', err.message);
        }
    }

    return { email, name };
}

export async function POST(req) {
    // Initialize inside the handler to prevent build-time crashes if the env var is missing
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_dummy');

    const body = await req.text();
    const signature = (await headers()).get('stripe-signature');

    let event;

    try {
        event = stripe.webhooks.constructEvent(
            body,
            signature,
            process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch (err) {
        console.error(`Webhook signature verification failed: ${err.message}`);
        return new Response(`Webhook Error: ${err.message}`, { status: 400 });
    }

    const monitoredEvents = [
        'checkout.session.completed',
        'invoice.payment_succeeded',
        // 'invoice.payment_failed',
        'payment_intent.succeeded',
        // 'payment_intent.payment_failed',
        // 'customer.subscription.deleted',
    ];

    if (!monitoredEvents.includes(event.type)) {
        return new Response('Event ignored', { status: 200 });
    }

    const data = event.data.object;

    // Avoid duplicate alerts: if payment_intent belongs to an invoice, let invoice.* events handle it
    if (event.type === 'payment_intent.succeeded' && data.invoice) {
        return new Response('Skipped (handled by invoice event)', { status: 200 });
    }

    // Determine message attributes based on event
    let messageTitle = 'Stripe Event';
    let emoji = '✅';
    let rawAmount = null;
    let currency = data.currency || 'usd';

    if (event.type === 'checkout.session.completed') {
        messageTitle =
            data.mode === 'subscription'
                ? 'Stripe Subscription Checkout Succeeded'
                : 'Stripe Checkout Succeeded';
        rawAmount = data.amount_total;
    } else if (event.type === 'invoice.payment_succeeded') {
        const isSubscription = Boolean(data.subscription);
        const isRenewal = data.billing_reason === 'subscription_cycle';
        messageTitle = isRenewal
            ? 'Stripe Subscription Renewal Succeeded'
            : isSubscription
            ? 'Stripe Subscription Payment Succeeded'
            : 'Stripe Invoice Payment Succeeded';
        rawAmount = data.amount_paid ?? data.total ?? data.amount_due;
    } else if (event.type === 'payment_intent.succeeded') {
        messageTitle = 'Stripe Payment Succeeded';
        rawAmount = data.amount_received ?? data.amount;
    }

    // Only alert for successful payments with amount 2364 ($2,364.00 = 236400 cents)
    const TARGET_AMOUNT_CENTS = 236400;
    if (rawAmount !== TARGET_AMOUNT_CENTS) {
        return new Response('Event ignored (amount does not match 2364)', { status: 200 });
    }

    // Format Amount
    let formattedAmount = null;
    if (typeof rawAmount === 'number') {
        formattedAmount = `${(rawAmount / 100).toFixed(2)} ${currency.toUpperCase()}`;
    }

    const { email: customerEmail, name: customerName } = await getCustomerDetails(stripe, data);
    const subscriptionName = await getSubscriptionOrProductName(stripe, event.type, data);
    const resourceId = data.id || 'Unknown ID';

    // Build Slack Block Kit fields
    const fields = [
        {
            type: 'mrkdwn',
            text: `*Type:*\n${event.type}`,
        },
    ];

    if (formattedAmount) {
        fields.push({
            type: 'mrkdwn',
            text: `*Amount:*\n${formattedAmount}`,
        });
    }

    if (customerName || customerEmail) {
        const nameStr = customerName || 'Unknown';
        const emailStr = customerEmail ? `(${customerEmail})` : '';
        fields.push({
            type: 'mrkdwn',
            text: `*Customer:*\n${nameStr} ${emailStr}`.trim(),
        });
    }

    if (subscriptionName) {
        fields.push({
            type: 'mrkdwn',
            text: `*Subscription / Product:*\n${subscriptionName}`,
        });
    }

    fields.push({
        type: 'mrkdwn',
        text: `*ID:*\n\`${resourceId}\``,
    });

    // Create Slack Block Kit payload with fallback text
    const slackPayload = {
        text: `${emoji} ${messageTitle}${subscriptionName ? ` - ${subscriptionName}` : ''}`,
        blocks: [
            {
                type: 'header',
                text: {
                    type: 'plain_text',
                    text: `${emoji} ${messageTitle}`,
                    emoji: true,
                },
            },
            {
                type: 'section',
                fields: fields,
            },
            {
                type: 'divider',
            },
        ],
    };

    try {
        if (!process.env.SLACK_PAYMENT_ALERTS_WEBHOOK_URL) {
            throw new Error('SLACK_PAYMENT_ALERTS_WEBHOOK_URL is not defined');
        }

        const res = await fetch(process.env.SLACK_PAYMENT_ALERTS_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(slackPayload),
        });

        if (!res.ok) {
            const errText = await res.text();
            console.error(`Slack alert HTTP ${res.status}: ${errText}`);
        } else {
            console.log(`Slack alert sent for Stripe ${event.type}.`);
        }
    } catch (error) {
        console.error('Failed to send Slack alert:', error);
    }

    return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}
