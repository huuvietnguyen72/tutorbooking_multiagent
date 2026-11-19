-- Tutor earnings (QUA-54): platform fee fixed per payment + manual settlement marker.
ALTER TABLE "payments"
  ADD COLUMN "fee_rate" DECIMAL(5,4),
  ADD COLUMN "platform_fee_vnd" INTEGER,
  ADD COLUMN "settled_at" TIMESTAMPTZ(3),
  ADD COLUMN "settled_by" UUID;

-- Backfill every payment that was ever confirmed with the default 10% rate, rounded half up.
UPDATE "payments"
SET "fee_rate" = 0.1000,
    "platform_fee_vnd" = FLOOR("amount_vnd"::numeric * 0.1000 + 0.5)::integer
WHERE "paid_at" IS NOT NULL;

ALTER TABLE "payments" ADD CONSTRAINT "payments_fee_snapshot_check"
  CHECK (("fee_rate" IS NULL) = ("platform_fee_vnd" IS NULL)
         AND ("fee_rate" IS NULL OR ("fee_rate" >= 0 AND "fee_rate" <= 1))
         AND ("platform_fee_vnd" IS NULL OR ("platform_fee_vnd" >= 0 AND "platform_fee_vnd" <= "amount_vnd")));

-- Month filters by end_at (Asia/Ho_Chi_Minh month of the session end).
CREATE INDEX "bookings_tutor_id_end_at_idx" ON "bookings"("tutor_id", "end_at");
