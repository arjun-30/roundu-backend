INSERT INTO offers (id, code, description, discount_type, discount_amount, is_active, valid_until)
VALUES 
  (gen_random_uuid(), 'WELCOME50', 'Flat 50 off on first booking', 'flat', 50.00, true, NOW() + INTERVAL '30 days'),
  (gen_random_uuid(), 'SUMMER10', '10% off on all cleaning services', 'percentage', 10.00, true, NOW() + INTERVAL '60 days');
