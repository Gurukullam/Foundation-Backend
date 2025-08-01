// Load environment variables
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors({
    origin: process.env.FRONTEND_URL || [
        'https://gurukullam.github.io',
        'http://localhost:8080',
        'http://localhost:3000'
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'stripe-signature']
}));

// Raw body for webhooks
app.use('/webhook', express.raw({ type: 'application/json' }));

// JSON parsing for other routes
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'French Learning App Payment Backend',
        environment: process.env.NODE_ENV || 'development'
    });
});

// Create Payment Intent endpoint
app.post('/create-payment-intent', async (req, res) => {
    console.log('🔄 Creating payment intent...');
    
    try {
        const { planType, currency, amount, customerEmail, customerName } = req.body;
        
        // Validate required fields
        if (!planType || !currency || !amount) {
            return res.status(400).json({ 
                error: 'Missing required fields: planType, currency, amount' 
            });
        }

        // Create customer if email provided
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

        // Create payment intent
        const paymentIntent = await stripe.paymentIntents.create({
            amount: amount, // Amount in cents
            currency: currency.toLowerCase(),
            customer: customer ? customer.id : undefined,
            description: `French Learning App - ${planType} subscription`,
            metadata: {
                planType: planType,
                customerEmail: customerEmail || 'guest',
                source: 'french-learning-app'
            },
            // Automatically confirm the payment (for immediate processing)
            confirm: false,
            // Enable automatic payment methods
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

// Get subscription status
app.get('/subscription-status/:customerEmail', async (req, res) => {
    try {
        const { customerEmail } = req.params;
        
        // Search for customer by email
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
        
        // Get customer's subscriptions
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

// Webhook endpoint for Stripe events
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

    // Handle the event
    try {
        switch (event.type) {
            case 'payment_intent.succeeded':
                const paymentIntent = event.data.object;
                console.log('💳 Payment succeeded:', paymentIntent.id);
                
                // Here you could update your database with successful payment
                // For example, mark user as premium in Firebase
                
                break;

            case 'payment_intent.payment_failed':
                const failedPayment = event.data.object;
                console.log('❌ Payment failed:', failedPayment.id);
                
                // Handle failed payment
                
                break;

            case 'invoice.payment_succeeded':
                const invoice = event.data.object;
                console.log('📄 Invoice payment succeeded:', invoice.id);
                
                // Handle successful recurring payment
                
                break;

            case 'customer.subscription.deleted':
                const subscription = event.data.object;
                console.log('🗑️ Subscription deleted:', subscription.id);
                
                // Handle subscription cancellation
                
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

// Test endpoint for development
app.get('/test', (req, res) => {
    res.json({ 
        message: 'Backend is working!',
        stripe: stripe ? 'Connected' : 'Not connected',
        environment: process.env.NODE_ENV || 'development'
    });
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('❌ Unhandled error:', error);
    res.status(500).json({ 
        error: 'Internal server error',
        message: error.message 
    });
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({ 
        error: 'Endpoint not found',
        message: `${req.method} ${req.originalUrl} not found`
    });
});

// Start server
app.listen(port, () => {
    console.log(`🚀 French Learning Payment Backend running on port ${port}`);
    console.log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`💳 Stripe: ${stripe ? 'Connected' : 'Not connected'}`);
});

module.exports = app; 