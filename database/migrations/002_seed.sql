-- Seed categories
INSERT INTO categories (id, name, slug) VALUES
    ('11111111-1111-1111-1111-111111111111', 'Electronics', 'electronics'),
    ('22222222-2222-2222-2222-222222222222', 'Clothing', 'clothing'),
    ('33333333-3333-3333-3333-333333333333', 'Books', 'books'),
    ('44444444-4444-4444-4444-444444444444', 'Home & Garden', 'home-garden'),
    ('55555555-5555-5555-5555-555555555555', 'Sports', 'sports')
ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name;

-- Demo seller used by local seed products.
-- LOCAL DEVELOPMENT ONLY — this account's password is documented in
-- README-IMPLEMENTATION.md, not in this file. Do not run this seed against
-- any shared, staging, or production database.
INSERT INTO users (id, email, password_hash, full_name, role) VALUES
    (
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'demo.seller@smart-marketplace.local',
        '$2b$10$rKCoL.kjSaH5cRmGbkkX3.sCU3nDhfojdMPhSxEkltcr.jwHcREFu',
        'Demo Seller',
        'seller'
    )
ON CONFLICT (email) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    role = EXCLUDED.role;

INSERT INTO sellers (id, user_id, store_name, store_description, is_verified)
SELECT
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        id,
        'Demo Marketplace Store',
        'Sample seller account for local development and demos.',
        true
FROM users
WHERE email = 'demo.seller@smart-marketplace.local'
ON CONFLICT (store_name) DO UPDATE SET
    store_description = EXCLUDED.store_description,
    is_verified = EXCLUDED.is_verified;

-- Seed products so a fresh local install is immediately browsable.
WITH seed_products (
    id,
    category_slug,
    name,
    description,
    price,
    stock_quantity,
    images,
    tags
) AS (
    VALUES
        (
            'c1111111-1111-1111-1111-111111111111'::uuid,
            'electronics',
            'Wireless Headphones',
            'Noise-cancelling Bluetooth headphones with long battery life.',
            89.99,
            24,
            '["https://picsum.photos/seed/headphones/400/300"]'::jsonb,
            '["audio", "wireless", "electronics"]'::jsonb
        ),
        (
            'c2222222-2222-2222-2222-222222222222'::uuid,
            'electronics',
            'Smart Fitness Watch',
            'Water-resistant fitness watch with heart-rate and sleep tracking.',
            129.00,
            18,
            '["https://picsum.photos/seed/fitnesswatch/400/300"]'::jsonb,
            '["wearable", "fitness", "electronics"]'::jsonb
        ),
        (
            'c3333333-3333-3333-3333-333333333333'::uuid,
            'books',
            'Modern JavaScript Handbook',
            'A practical guide to building reliable web applications.',
            34.50,
            40,
            '["https://picsum.photos/seed/javascriptbook/400/300"]'::jsonb,
            '["books", "programming", "javascript"]'::jsonb
        ),
        (
            'c4444444-4444-4444-4444-444444444444'::uuid,
            'home-garden',
            'Ceramic Plant Pot Set',
            'Three minimalist ceramic pots for indoor plants.',
            27.99,
            32,
            '["https://picsum.photos/seed/plantpots/400/300"]'::jsonb,
            '["home", "garden", "plants"]'::jsonb
        ),
        (
            'c5555555-5555-5555-5555-555555555555'::uuid,
            'sports',
            'Yoga Mat',
            'Non-slip exercise mat for yoga, stretching, and home workouts.',
            22.00,
            55,
            '["https://picsum.photos/seed/yogamat/400/300"]'::jsonb,
            '["sports", "fitness", "yoga"]'::jsonb
        ),
        (
            'c6666666-6666-6666-6666-666666666666'::uuid,
            'clothing',
            'Classic Hoodie',
            'Soft cotton hoodie with a relaxed fit for everyday comfort.',
            39.99,
            28,
            '["https://picsum.photos/seed/hoodie/400/300"]'::jsonb,
            '["clothing", "apparel", "casual"]'::jsonb
        ),
        (
            'c7777777-7777-7777-7777-777777777777'::uuid,
            'home-garden',
            'Bamboo Cutting Board',
            'Durable eco-friendly cutting board with juice groove.',
            29.50,
            21,
            '["https://picsum.photos/seed/cuttingboard/400/300"]'::jsonb,
            '["kitchen", "home", "eco"]'::jsonb
        )
)
INSERT INTO products (
    id,
    seller_id,
    category_id,
    name,
    description,
    price,
    stock_quantity,
    images,
    tags,
    is_active
)
SELECT
    seed_products.id,
    sellers.id,
    categories.id,
    seed_products.name,
    seed_products.description,
    seed_products.price,
    seed_products.stock_quantity,
    seed_products.images,
    seed_products.tags,
    true
FROM seed_products
CROSS JOIN sellers
JOIN categories ON categories.slug = seed_products.category_slug
WHERE sellers.store_name = 'Demo Marketplace Store'
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    price = EXCLUDED.price,
    stock_quantity = EXCLUDED.stock_quantity,
    images = EXCLUDED.images,
    tags = EXCLUDED.tags,
    is_active = EXCLUDED.is_active,
    updated_at = NOW();