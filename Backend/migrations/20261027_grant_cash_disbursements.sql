-- Add claim tracking columns to Scholarship_Awards for Barangay Cash Disbursements
ALTER TABLE "Scholarship_Awards"
ADD COLUMN IF NOT EXISTS claim_status VARCHAR(30) NOT NULL DEFAULT 'unclaimed',
ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS claimed_by INTEGER REFERENCES "Users"(user_id),
ADD COLUMN IF NOT EXISTS claim_notes TEXT;

CREATE INDEX IF NOT EXISTS idx_scholarship_awards_claim_status
ON "Scholarship_Awards" (claim_status);

