ALTER TABLE rental_agreements
    ADD COLUMN IF NOT EXISTS unassigned_at TIMESTAMP WITH TIME ZONE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_active_agreement_equipment
    ON rental_agreements (equipment_id)
    WHERE unassigned_at IS NULL;
