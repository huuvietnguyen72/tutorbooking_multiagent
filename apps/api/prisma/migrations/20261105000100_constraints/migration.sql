-- Hand-written: constraints Prisma cannot express (docs/architecture.md §3.2, §3.3).
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS citext;

-- CHECK constraints
ALTER TABLE tutor_profiles ADD CONSTRAINT tutor_profiles_price_positive CHECK (price_per_session_vnd > 0);
ALTER TABLE slots ADD CONSTRAINT slots_end_after_start CHECK (end_at > start_at);
ALTER TABLE bookings ADD CONSTRAINT bookings_reschedule_count_range CHECK (reschedule_count BETWEEN 0 AND 1);
ALTER TABLE bookings ADD CONSTRAINT bookings_student_not_tutor CHECK (student_id <> tutor_id);
ALTER TABLE payments ADD CONSTRAINT payments_amount_positive CHECK (amount_vnd > 0);
ALTER TABLE reviews ADD CONSTRAINT reviews_rating_range CHECK (rating BETWEEN 1 AND 5);

-- (1) Slot của cùng gia sư không chồng giờ (nửa mở [start, end))
ALTER TABLE slots ADD CONSTRAINT slots_no_overlap
  EXCLUDE USING gist (tutor_id WITH =, tstzrange(start_at, end_at, '[)') WITH &&)
  WHERE (status <> 'CLOSED' AND deleted_at IS NULL);

-- (2) Một slot tối đa một booking đang hiệu lực
CREATE UNIQUE INDEX bookings_one_active_per_slot
  ON bookings (slot_id) WHERE status IN ('PENDING_PAYMENT', 'CONFIRMED');

-- (3) Học viên không có 2 booking hiệu lực chồng giờ (kể cả khác gia sư)
ALTER TABLE bookings ADD CONSTRAINT bookings_student_no_overlap
  EXCLUDE USING gist (student_id WITH =, tstzrange(start_at, end_at, '[)') WITH &&)
  WHERE (status IN ('PENDING_PAYMENT', 'CONFIRMED'));
