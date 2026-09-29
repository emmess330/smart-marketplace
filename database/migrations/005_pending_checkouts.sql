-- Snapshot of what a Stripe payment intent pays for, written when the intent
-- is created. The order is fulfilled from this snapshot by whichever arrives
-- first: the browser's POST /orders/checkout or Stripe's
-- payment_intent.succeeded webhook. So the order matches what was paid even
-- if the cart changes afterwards, and it is created even if the buyer closes
-- the tab (or pays with a redirect-based method) before checkout is called.
-- The row is deleted once its order exists.
CREATE TABLE IF NOT EXISTS pending_checkouts (
    stripe_payment_id VARCHAR(255) PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    items JSONB NOT NULL,              -- [{ product_id, name, quantity, price }]
    total_amount DECIMAL(10,2) NOT NULL,
    shipping_address JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pending_checkouts_user_id ON pending_checkouts(user_id);
