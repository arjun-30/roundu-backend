-- Migration 015 - TODO
CREATE TABLE service_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    provider_id UUID NOT NULL REFERENCES users(id),
    work_description TEXT NOT NULL,
    materials_used JSONB, -- List of items and costs
    photo_urls TEXT[], -- Array of S3 URLs
    submitted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_reports_booking_id ON service_reports(booking_id);
