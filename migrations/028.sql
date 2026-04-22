-- Migration 028 - TODO
CREATE TABLE kyc_verifications (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID REFERENCES users(id) NOT NULL,
  doc_type               VARCHAR(10) NOT NULL CHECK (doc_type IN ('aadhaar', 'pan')),
  doc_number_masked      VARCHAR(20),
  status                 VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'initiated', 'verified', 'failed', 'rejected')),
  verified_name          VARCHAR(200),
  verified_dob           VARCHAR(20),
  verified_gender        VARCHAR(5),
  verified_address       TEXT,
  digilocker_request_id  VARCHAR(100),
  raw_response           JSONB,
  verified_at            TIMESTAMPTZ,
  created_at             TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_kyc_user ON kyc_verifications(user_id);
CREATE UNIQUE INDEX idx_kyc_user_doc_verified ON kyc_verifications(user_id, doc_type) WHERE status = 'verified';
