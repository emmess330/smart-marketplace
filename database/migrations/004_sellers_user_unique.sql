-- One seller profile per user. Without this, two concurrent
-- POST /users/seller (or register-as-seller) requests could both pass the
-- "already a seller?" check and create two stores for the same user.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sellers_user_id_unique'
  ) THEN
    ALTER TABLE sellers ADD CONSTRAINT sellers_user_id_unique UNIQUE (user_id);
  END IF;
END
$$;
