-- Seed categories
INSERT INTO categories (id, name, slug) VALUES
    (gen_random_uuid(), 'Electronics', 'electronics'),
    (gen_random_uuid(), 'Clothing', 'clothing'),
    (gen_random_uuid(), 'Books', 'books'),
    (gen_random_uuid(), 'Home & Garden', 'home-garden'),
    (gen_random_uuid(), 'Sports', 'sports');