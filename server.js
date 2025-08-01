require('dotenv').config();
const express = require('express');
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 3000;

// FIXED CORS configuration - allows both github.io and github.io/Foundation
app.use(cors({
    origin: [
        'https://gurukullam.github.io/Foundation',
        'https://gurukullam.github.io',
        'http://localhost:8080',
        'http://localhost:3000'
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'stripe-signature']
}));

app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'French Learning App Payment Backend',
        environment: process.env.NODE_ENV || 'development'
    });
});

app.post('/create-payment-intent', async (req, res) => {
    console.log('🔄 Creating payment intent...');
    
    try {
        const { planType, currency, amount, customerEmail, customerName } = req.body;
        
        if (!planType || !currency || !amount) {
            return res.status(400).json({ 
                error: 'Missing required fields: planType, currency, amount' 
            });
        }

        let customer = null;
        if (customerEmail) {
            try {
                customer = await stripe.customers.create({
                    email: customerEmail,
                    name: customerName || 'French Learning Student',
                    metadata: {
                        planType: planType,
                        source: 'french-learning-app'
                    }
                });
            } catch (customerError) {
                console.log('⚠️ Customer creation failed, proceeding without customer:', customerError.message);
            }
        }

        const paymentIntent = await stripe.paymentIntents.create({
            amount: amount,
            currency: currency.toLowerCase(),
            customer: customer ? customer.id : undefined,
            description: `French Learning App - ${planType} subscription`,
            metadata: {
                planType: planType,
                customerEmail: customerEmail || 'guest',
                source: 'french-learning-app'
            },
            confirm: false,
            automatic_payment_methods: {
                enabled: true,
            },
        });

        console.log('✅ Payment intent created:', paymentIntent.id);

        res.json({
            clientSecret: paymentIntent.client_secret,
            paymentIntentId: paymentIntent.id,
            customerId: customer ? customer.id : null
        });

    } catch (error) {
        console.error('❌ Error creating payment intent:', error);
        res.status(500).json({ 
            error: 'Payment intent creation failed',
            message: error.message 
        });
    }
});

app.get('/subscription-status/:customerEmail', async (req, res) => {
    try {
        const { customerEmail } = req.params;
        
        const customers = await stripe.customers.list({
            email: customerEmail,
            limit: 1
        });

        if (customers.data.length === 0) {
            return res.json({ 
                hasSubscription: false, 
                message: 'Customer not found' 
            });
        }

        const customer = customers.data[0];
        
        const subscriptions = await stripe.subscriptions.list({
            customer: customer.id,
            status: 'active',
            limit: 10
        });

        if (subscriptions.data.length > 0) {
            const subscription = subscriptions.data[0];
            res.json({
                hasSubscription: true,
                subscription: {
                    id: subscription.id,
                    status: subscription.status,
                    currentPeriodEnd: subscription.current_period_end,
                    planName: subscription.items.data[0]?.price?.nickname || 'Premium'
                }
            });
        } else {
            res.json({ 
                hasSubscription: false, 
                message: 'No active subscriptions found' 
            });
        }

    } catch (error) {
        console.error('❌ Error checking subscription status:', error);
        res.status(500).json({ 
            error: 'Failed to check subscription status',
            message: error.message 
        });
    }
});

app.post('/webhook', async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
        console.log('✅ Webhook signature verified:', event.type);
    } catch (err) {
        console.error('❌ Webhook signature verification failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
        switch (event.type) {
            case 'payment_intent.succeeded':
                const paymentIntent = event.data.object;
                console.log('💳 Payment succeeded:', paymentIntent.id);
                break;

            case 'payment_intent.payment_failed':
                const failedPayment = event.data.object;
                console.log('❌ Payment failed:', failedPayment.id);
                break;

            case 'invoice.payment_succeeded':
                const invoice = event.data.object;
                console.log('📄 Invoice payment succeeded:', invoice.id);
                break;

            case 'customer.subscription.deleted':
                const subscription = event.data.object;
                console.log('🗑️ Subscription deleted:', subscription.id);
                break;

            default:
                console.log(`🔔 Unhandled event type: ${event.type}`);
        }

        res.json({ received: true });

    } catch (error) {
        console.error('❌ Error processing webhook:', error);
        res.status(500).json({ error: 'Webhook processing failed' });
    }
});

app.get('/test', (req, res) => {
    res.json({ 
        message: 'Backend is working!',
        stripe: stripe ? 'Connected' : 'Not connected',
        environment: process.env.NODE_ENV || 'development'
    });
});

app.use((error, req, res, next) => {
    console.error('❌ Unhandled error:', error);
    res.status(500).json({ 
        error: 'Internal server error',
        message: error.message 
    });
});

app.use('*', (req, res) => {
    res.status(404).json({ 
        error: 'Endpoint not found',
        message: `${req.method} ${req.originalUrl} not found`
    });
});

app.listen(port, () => {
    console.log(`🚀 French Learning Payment Backend running on port ${port}`);
    console.log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`💳 Stripe: ${stripe ? 'Connected' : 'Not connected'}`);
});

module.exports = app; 