-- POST /bookings `Idempotency-Key` (docs/openapi.yaml): same key by the same student returns the same booking.
ALTER TABLE "bookings" ADD COLUMN "idempotency_key" VARCHAR(64);
CREATE UNIQUE INDEX "bookings_student_idempotency_key"
  ON "bookings" ("student_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL;
