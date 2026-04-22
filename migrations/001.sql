-- Insert base categories
INSERT INTO categories (id, name, slug) VALUES 
  (gen_random_uuid(), 'Home Cleaning', 'home-cleaning'),
  (gen_random_uuid(), 'Plumbing', 'plumbing'),
  (gen_random_uuid(), 'Electrical', 'electrical');

-- Insert initial services
INSERT INTO services (id, category_id, name, base_price, duration_minutes, is_active, created_at) 
VALUES 
  (gen_random_uuid(), (SELECT id FROM categories WHERE slug = 'home-cleaning'), 'Deep Home Cleaning', 150.00, 180, true, NOW()),
  (gen_random_uuid(), (SELECT id FROM categories WHERE slug = 'plumbing'), 'Leak Fix', 50.00, 60, true, NOW()),
  (gen_random_uuid(), (SELECT id FROM categories WHERE slug = 'electrical'), 'Fan Installation', 40.00, 45, true, NOW());﻿-- Migration 001 - TODO
