# Stripe Configuration Guide

This guide will help you configure Stripe for TradeBot billing and subscription management.

## Prerequisites

1. A Stripe account (test mode for development)
2. Access to Stripe Dashboard
3. TradeBot admin API running

## Setup Steps

### 1. Get Stripe API Keys

1. Go to [Stripe Dashboard > API Keys](https://dashboard.stripe.com/test/apikeys)
2. Copy your "Publishable key" and "Secret key"
3. Add the secret key to your `.env` file:
   ```
   STRIPE_SECRET_KEY=sk_test_...
   ```

### 2. Create Products and Prices

1. Go to [Stripe Dashboard > Products](https://dashboard.stripe.com/test/products)
2. Create a "Starter Plan" product:
   - Name: `TradeBot Starter`
   - Description: `Single exchange, paper-first onboarding, email support`
   - Price: `$49/month`
   - Copy the price ID and add to `.env`:
     ```
     STRIPE_STARTER_PRICE_ID=price_...
     ```

3. Create a "Pro Plan" product:
   - Name: `TradeBot Pro`
   - Description: `Multi-exchange, live trading allowed, advanced support`
   - Price: `$199/month`
   - Copy the price ID and add to `.env`:
     ```
     STRIPE_PRO_PRICE_ID=price_...
     ```

### 3. Setup Webhooks

1. Go to [Stripe Dashboard > Webhooks](https://dashboard.stripe.com/test/webhooks)
2. Click "Add endpoint"
3. Set endpoint URL to: `http://localhost:9300/billing/webhook` (or your admin API URL)
4. Select these events:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
5. Copy the webhook signing secret and add to `.env`:
   ```
   STRIPE_WEBHOOK_SECRET=whsec_...
   ```

### 4. Test the Integration

1. Start the admin server:
   ```bash
   npm run admin:server
   ```

2. Start the portal:
   ```bash
   npm run portal:dev
   ```

3. Visit `http://localhost:3000/app` and try to upgrade to a paid plan

4. Use Stripe's test card numbers:
   - Success: `4242 4242 4242 4242`
   - Decline: `4000 0000 0000 0002`

### 5. Forward Webhooks (Development)

For local development, use Stripe CLI to forward webhooks:

```bash
# Install Stripe CLI: https://stripe.com/docs/stripe-cli
stripe login
stripe listen --forward-to http://localhost:9300/billing/webhook
```

### 6. Admin Dashboard Features

The admin dashboard (`/admin`) now includes:

- **User Management**: Pause, resume, upgrade, and kill client accounts
- **Admin Trading**: Access to trading interface without membership restrictions
- **Billing Overview**: Monitor subscription statuses and trial periods
- **Admin Privileges**: Bypass all membership and billing restrictions

#### Admin Mode

Access the trading interface in admin mode by visiting:
```
http://localhost:3000/app?admin=true
```

This bypasses all membership requirements and billing restrictions.

## Environment Variables Reference

```bash
# Stripe Configuration
STRIPE_SECRET_KEY=sk_test_...              # Your Stripe secret key
STRIPE_WEBHOOK_SECRET=whsec_...            # Webhook signing secret
STRIPE_STARTER_PRICE_ID=price_...          # Starter plan price ID
STRIPE_PRO_PRICE_ID=price_...              # Pro plan price ID

# Admin API
ADMIN_API_TOKEN=your-secure-token          # Required for admin API access
ADMIN_PORT=9300                            # Admin server port

# Portal
NEXTAUTH_SECRET=your-nextauth-secret       # NextAuth.js secret
NEXTAUTH_URL=http://localhost:3000         # Base URL for auth
```

## Troubleshooting

### Webhook Events Not Received

1. Check that the webhook URL is correct and accessible
2. Verify the webhook secret matches
3. Ensure the admin server is running on the correct port
4. Check the admin server logs for errors

### Checkout Sessions Failing

1. Verify the price IDs are correct
2. Check that the products are active in Stripe
3. Ensure the secret key has the correct permissions

### Admin Dashboard Not Loading

1. Verify `ADMIN_API_TOKEN` is set
2. Check that the admin server is running
3. Ensure the portal can reach the admin API (check `ADMIN_API_URL`)

## Production Deployment

For production:

1. Switch to live Stripe API keys
2. Update webhook URLs to your production domain
3. Set strong, unique values for all secrets
4. Enable HTTPS for all endpoints
5. Use a secure authentication provider (Auth0, etc.)