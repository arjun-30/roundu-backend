-- Migration 010 - TODO
CREATE TABLE ratings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    provider_id UUID NOT NULL REFERENCES users(id),
    rating_score INTEGER CHECK (rating_score >= 1 AND rating_score <= 5),
    review_text TEXT,
    tags TEXT[], -- Array of tags like ['punctual', 'professional']
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure a user can only rate a specific booking once
    UNIQUE(booking_id)
);

CREATE INDEX idx_ratings_provider_id ON ratings(provider_id);
