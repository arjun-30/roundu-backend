-- Migration 011 - TODO
CREATE TABLE platform_settings (
  key         VARCHAR(100) PRIMARY KEY,
  value       TEXT NOT NULL,
  description TEXT,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO platform_settings (key, value, description) VALUES
  ('platform_fee_percent', '10', 'Platform commission percentage'),
  ('cashback_percent', '5', 'Cashback percentage on each booking'),
  ('search_radius_km', '10', 'Default provider search radius'),
  ('booking_expiry_minutes', '10', 'Minutes before unaccepted booking expires'),
  ('referral_reward_paise', '10000', 'Reward for referrer and referee (₹100)'),
  ('max_otp_attempts', '3', 'Max OTP verification attempts'),
  ('provider_cancel_penalty_percent', '20', 'Penalty when provider cancels'),
  ('company_cancel_share_percent', '20', 'Company keeps on provider cancellation'),
  ('gps_alert_threshold_minutes', '15', 'Minutes near customer without booking to trigger alert'),
  ('gps_alert_max_warnings', '3', 'Warnings before provider suspension'),
  ('auto_call_before_minutes', '30', 'Minutes before service to make ElevenLabs call');
