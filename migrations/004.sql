-- Migration 004 - TODO
CREATE TYPE kyc_status AS ENUM ('pending', 'verified', 'rejected');
CREATE TYPE id_type AS ENUM ('aadhaar', 'pan', 'voter_id');

CREATE TABLE kyc_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status kyc_status DEFAULT 'pending',
    document_type id_type NOT NULL,
    id_number_encrypted TEXT NOT NULL, -- Store encrypted for security
    document_url TEXT, -- S3 URL of the uploaded doc
    rejection_reason TEXT,
    verified_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_kyc_user_id ON kyc_verifications(user_id);
CREATE INDEX idx_kyc_status ON kyc_verifications(status);
