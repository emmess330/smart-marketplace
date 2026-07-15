-- Prevent a single Stripe payment intent from being applied to more than one order.
-- (NULL stripe_payment_id values are unaffected — Postgres unique constraints allow
-- multiple NULLs — but the orders/checkout endpoint now always requires a payment id.)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_stripe_payment_id_unique'
  ) THEN
    ALTER TABLE orders ADD CONSTRAINT orders_stripe_payment_id_unique UNIQUE (stripe_payment_id);
  END IF;
END
$$;
