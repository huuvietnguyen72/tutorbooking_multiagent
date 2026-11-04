# Test Plan P3 — Đặt lịch & Thanh toán (T10 / QUA-19)

> Phiên bản 1.0 — QA Engineer, chờ Tech Lead review.
> Nguồn: [requirements P1](/QUA/issues/QUA-4#document-requirements) rev 1, [architecture](/QUA/issues/QUA-6#document-architecture) rev 3, [openapi](/QUA/issues/QUA-6#document-openapi) rev 3 (`docs/openapi.yaml`), [design P2a](/QUA/issues/QUA-5#document-design), [security-review](/QUA/issues/QUA-9#document-security-review) mục E.
> Phạm vi: kiểm thử P3 cho F1–F9, trọng tâm là luồng đặt lịch + thanh toán (F4/F5/F6/F7) và bộ E2E Playwright chạy trong CI. Ngoài phạm vi: load/performance, VNPay thật, mobile.

## 1. Mục tiêu

1. Mỗi AC trong requirements P1 có ít nhất một test case tự động truy vết được (ma trận §5).
2. Bộ E2E Playwright phủ luồng học viên: thanh toán **thành công / thất bại / hết hạn 15 phút**, **huỷ + hoàn tiền**, **đọc email qua API Mailpit** — chạy xanh trong CI trên stack compose.
3. Đáp ứng Definition of Done P3: test phân quyền (khác vai trò → 401/403, không sở hữu → 404), khớp `docs/openapi.yaml`, các mục checklist bảo mật 23 điểm có test tự động.
4. Cổng P4 (T12): 0 lỗi Critical/High trên build compose.

## 2. Chiến lược theo cấp độ (test pyramid)

| Cấp | Công cụ | Chạy ở đâu | Phạm vi |
|---|---|---|---|
| **Unit** | Jest | CI job `test` | `BookingStateMachine`, `CancellationPolicy`/`ReschedulePolicy` (hàm thuần, test đủ biên), `Clock`, ký/verify HMAC, `lib/time.ts` (FE), mapper DTO theo vai trò |
| **Integration** | Jest + Supertest + **PostgreSQL 16 thật** | CI job `test` (service postgres) | Từng endpoint theo OpenAPI: happy path + lỗi nghiệp vụ + phân quyền; ràng buộc DB §3.3 (exclusion/unique partial); concurrency (2 request tranh 1 slot, 20 webhook trùng, race webhook ↔ expiry job); idempotency; outbox email |
| **Contract** | schema validation (AJV/`jest-openapi` hoặc OpenAPI validator) trong integration | CI job `test` | Response mọi endpoint khớp schema `docs/openapi.yaml` (camelCase, ISO-8601 có offset, tiền nguyên VND, `{items,page,pageSize,total}`, `{error:{code,message,details?}}`) |
| **E2E** | Playwright (chromium) + stack compose + Mailpit API | CI job `e2e` (mới) | Luồng người dùng thật qua UI: §6 |
| **Thủ công / review** | checklist | T11, T12 | UI text chỉ ở `vi.json`; log scrub; review code mục 7, 19 checklist Security |

Nguyên tắc:
- Nghiệp vụ thời gian (15 phút, 24h, 60 phút lead) test bằng **Clock giả** ở unit/integration (không chờ thật); E2E dùng cơ chế §7.
- Rule DB (chống trùng) **bắt buộc** test trên Postgres thật, không test bằng SQLite/memory.
- Mỗi endpoint mới: BE thêm test phân quyền theo ma trận (Security checklist mục 6) ngay trong PR — QA review đủ, không viết thay.

## 3. Môi trường kiểm thử

| Môi trường | Dựng | Cấu hình riêng cho test |
|---|---|---|
| CI unit/integration | GitHub Actions job `test` (có sẵn, postgres service) | `NODE_ENV=test`, `DATABASE_URL` trỏ DB test; migrate + seed trước khi chạy |
| CI E2E | job `e2e` mới: `docker compose -f docker-compose.yml -f docker-compose.test.yml up -d --build`, chờ `api` healthy + `web` sẵn sàng | `SEED_DEMO_DATA=true`, `MOCK_GATEWAY_ENABLED=true`, `SEED_ADMIN_PASSWORD` sinh ngẫu nhiên, cơ chế clock §7; `WEB_BASE_URL=http://localhost:8080`, `MAILPIT_URL=http://localhost:8025`, DB `127.0.0.1:5432` |
| Local | như CI E2E | `npm run e2e` (Playwright) sau khi stack lên |

Mailpit (axllent/mailpit v1.20.4, đã có trong compose):
- UI `http://localhost:8025`, API: `GET /api/v1/messages?query=…&limit=…`, `GET /api/v1/message/{id}`, `DELETE /api/v1/messages` (clear).
- Helper `waitForEmail({to, subjectContains}, timeoutMs)`: poll API mỗi 2s, timeout 60s (outbox worker chu kỳ 15s + backoff). Trước mỗi test: `DELETE /api/v1/messages`.
- Assert nội dung: người nhận, subject tiếng Việt, body chứa mã booking / số tiền / giờ `(GMT+7)` đúng múi `Asia/Ho_Chi_Minh`.

## 4. Dữ liệu test

- **Seed cố định** (T2, `SEED_DEMO_DATA=true`): admin (mật khẩu từ env), tutor-1 `APPROVED` (hồ sơ đầy đủ, học phí cố định, slot tương lai đủ xa), tutor-2 `PENDING_APPROVAL`, student-1, student-2. E2E đọc thông tin seed qua fixture JSON chung.
- **Dữ liệu động**: mỗi test tạo user/booking riêng qua **API** (nhanh, ít flaky) với email unique (`+{testId}@example.test`); chỉ dùng UI cho đúng phần đang kiểm thử.
- **Cô lập**: E2E chạy `workers: 1`, tuần tự (một stack + một DB chung); integration test chạy trong transaction rollback hoặc truncate giữa các suite.
- Slot cho ca hết hạn/biên 24h: tạo qua API với `start_at` tính từ `now` server (API trả `serverTime`), hoặc seed theo offset.

## 5. Ma trận truy vết AC → test case

Ký hiệu cấp: **U**=unit, **I**=integration, **E**=E2E, **C**=contract (chạy kèm I), **R**=review/thủ công.
Mỗi dòng: ID | cấp | AC | nội dung & assert chính.

### 5.1 F1 — Đăng ký / đăng nhập / phân quyền (US-GEN-01, US-GEN-02, US-STU-08, US-TUT-01)

| ID | Cấp | AC | Test |
|---|---|---|---|
| TC-AUTH-01 | I | US-GEN-01 AC1 | Đăng ký STU hợp lệ → 201, dùng được ngay; đăng ký TUT → tạo với `tutorApprovalStatus=PENDING_APPROVAL` |
| TC-AUTH-02 | I | US-GEN-01 AC2 | Email trùng → 409 `EMAIL_TAKEN`, không tạo user (đếm DB) |
| TC-AUTH-03 | I,C | US-GEN-01 AC3 | Form thiếu/sai (email sai định dạng, mật khẩu <8, thiếu họ tên) → 400 `VALIDATION_FAILED` + `details` từng trường; FE hiện text `vi.json` |
| TC-AUTH-04 | I | US-GEN-01 AC4 | Body `role=ADMIN` → 400 (không tự đăng ký Admin); `additionalProperties:false` chặn field lạ |
| TC-AUTH-05 | I | US-GEN-02 AC1 | Login đúng → cookie phiên (`HttpOnly, SameSite=Lax, Path=/api`), `GET /me` đúng vai trò; FE vào trang mặc định theo vai trò |
| TC-AUTH-06 | I | US-GEN-02 AC2 | Sai mật khẩu/email → 401 `INVALID_CREDENTIALS`, message chung giống nhau cho cả 2 ca (không lộ email tồn tại); thời gian trả lời tương đương (verify giả — Security C5, checklist 4) |
| TC-AUTH-07 | I | US-GEN-02 AC3 | User bị `LOCKED` → 401 `ACCOUNT_LOCKED`; phiên cũ (token còn hạn) → 401 |
| TC-AUTH-08 | I | US-GEN-02 AC4 | Không cookie → route cần quyền trả 401 `UNAUTHENTICATED`; FE redirect `/dang-nhap?next=…` (chỉ nhận path tương đối) |
| TC-AUTH-09 | I | US-GEN-02 AC5 | **Ma trận phân quyền tự động** (Security checklist 6): với mỗi endpoint OpenAPI chạy {khách, STU-A, STU-B, TUT-A, TUT-B, ADM} → đối chiếu `x-roles` + sở hữu: sai vai trò → 401/403, tài nguyên không sở hữu → **404** (không 403) |
| TC-AUTH-10 | I | US-GEN-02 AC5 | Logout → `token_version` tăng, cookie hết hiệu lực; request cũ → 401 (C1) |
| TC-AUTH-11 | I | US-STU-08 AC1 | Đổi mật khẩu: đúng mật khẩu cũ → thành công, login mật khẩu mới OK; sai → 400 `WRONG_CURRENT_PASSWORD`; sau đổi mật khẩu phiên cũ mất hiệu lực |
| TC-AUTH-12 | U,I | US-TUT-01 AC1–3 | Tutor `PENDING_APPROVAL`: `GET /me` thấy trạng thái; sửa hồ sơ được; không xuất hiện công khai; `REJECTED` thấy `rejectionReason`; `POST /tutor/profile/submit` → về `PENDING_APPROVAL`; `APPROVED` dùng đủ chức năng |
| TC-AUTH-13 | I | — | Throttle login/register hoạt động sau `trust proxy` (checklist 4): >10 login/giờ/email → 429; register >3/phút/IP → 429 |
| TC-AUTH-14 | U | — | JWT: cố định `HS256` (token `alg=none`/`RS256` giả → 401), kiểm `exp`/`tv` (checklist 2) |

### 5.2 F3 — Công khai: danh sách, hồ sơ, tìm lọc (US-GEN-03, US-STU-01, US-STU-02)

| ID | Cấp | AC | Test |
|---|---|---|---|
| TC-PUB-01 | I | US-GEN-03 AC1 | `GET /tutors` chỉ trả tutor `APPROVED`; `PENDING_APPROVAL`/`REJECTED`/`SUSPENDED`/`LOCKED` không xuất hiện; `GET /tutors/{id}` của tutor chưa duyệt (kể cả ADM-giả-lập khách) → 404 |
| TC-PUB-02 | E | US-GEN-03 AC2 | Khách bấm "Đặt lịch" → chuyển đăng nhập, sau login quay lại đúng slot (`?next=` giữ path) |
| TC-PUB-03 | I,C | US-STU-01 AC1 | Lọc tổ hợp `subjectId`+`minPrice`+`maxPrice` (AND); kết quả đúng tập mong đợi trên dữ liệu seed có kiểm soát |
| TC-PUB-04 | I | US-STU-01 AC2 | Không kết quả → 200 `items: []`; FE hiện trạng thái rỗng `vi.json` |
| TC-PUB-05 | I,C | US-STU-01 AC3 | Phân trang `page/pageSize` đúng `{items,page,pageSize,total}`; `pageSize>100` → 400 (checklist 18) |
| TC-PUB-06 | I | US-STU-02 AC1 | `GET /tutors/{id}` đủ: môn, kinh nghiệm, học phí, `avgRating`, `reviewCount`, reviews gần nhất; **không** lộ email/`rejectionReason`/`reviewedBy` (checklist 8, snapshot DTO) |
| TC-PUB-07 | I | US-STU-02 AC2 | `GET /tutors/{id}/slots?from&to`: chỉ `AVAILABLE` tương lai; giờ ISO UTC; FE hiển thị GMT+7; `to-from > 31 ngày` → 400 |
| TC-PUB-08 | I | US-STU-02 AC3 | Slot `HELD`/`BOOKED` không trả dạng chọn được (status `UNAVAILABLE`, không lộ người đặt); slot quá khứ không xuất hiện |
| TC-PUB-09 | I | — | `GET /slots/{slotId}` công khai đủ dữ liệu cho S-06; slot không tồn tại/UUID sai → 404/400 (`ParseUUIDPipe`, checklist 18) |

### 5.3 F2 — Hồ sơ gia sư + slot (US-TUT-02, US-TUT-03)

| ID | Cấp | AC | Test |
|---|---|---|---|
| TC-TUT-01 | I,C | US-TUT-02 AC1 | `PUT /tutor/profile` hợp lệ (≥1 môn, price nguyên VND >0) → lưu; snapshot DTO |
| TC-TUT-02 | I | US-TUT-02 AC2 | price ≤0 / price thập phân / thiếu môn / chuỗi quá dài → 400 `VALIDATION_FAILED` |
| TC-TUT-03 | I | US-TUT-02 AC3 | Đổi học phí → booking **cũ** giữ `amount_vnd` đã chốt (tạo booking trước, đổi giá sau, đối chiếu DB + response); booking **mới** lấy giá mới; sửa hồ sơ không mất `APPROVED` (A5) |
| TC-TUT-04 | I | US-TUT-03 AC1 | Tạo slot tương lai → `AVAILABLE`; nhập giờ GMT+7 trên UI, DB lưu UTC (`timestamptz`); API trả ISO có offset |
| TC-TUT-05 | I,U | US-TUT-03 AC2 | Slot chồng giờ slot khác của chính gia sư → 409 `SLOT_OVERLAP`; **chạm biên** 09:00–10:00 vs 10:00–11:00 → OK (nửa mở); ràng buộc exclusion DB: 2 INSERT song song chỉ 1 thành công |
| TC-TUT-06 | I | US-TUT-03 AC3 | `PATCH/DELETE /tutor/slots/{id}` với slot `AVAILABLE` → được; delete là xoá mềm (`deleted_at`) |
| TC-TUT-07 | I | US-TUT-03 AC4 | Slot `HELD` hoặc có booking `CONFIRMED` → 409 `SLOT_LOCKED` khi sửa/xoá; đường "huỷ buổi" vẫn dùng được (US-TUT-05) |
| TC-TUT-08 | I | US-TUT-03 AC5 | Slot `start_at` quá khứ hoặc `< now + MIN_BOOKING_LEAD` theo luật tạo → 400/409 (đối chiếu openapi) |
| TC-TUT-09 | I | — | Tutor không phải `APPROVED` gọi `POST /tutor/slots` → 403 `TUTOR_NOT_ACCEPTING`/`FORBIDDEN` theo openapi; slot của tutor B → tutor A sửa/xoá: 404 (sở hữu) |
| TC-TUT-10 | I | — | `POST /tutor/slots/{id}/reopen`: `CLOSED → AVAILABLE` (S-18); trạng thái khác → 409 |

### 5.4 F4/F5/F6 — Đặt lịch + thanh toán (US-STU-03) ★ trọng tâm

| ID | Cấp | AC | Test |
|---|---|---|---|
| TC-BOOK-01 | I | US-STU-03 AC1 | `POST /bookings {slotId}` slot `AVAILABLE` → 201: booking `PENDING_PAYMENT`, `holdExpiresAt = createdAt + 15'` (config `BOOKING_HOLD_MINUTES`), slot → `HELD`, payment `PENDING` `amountVnd` = học phí tại thời điểm đặt, `checkoutUrl` mock đúng dạng; response có `serverTime` |
| TC-BOOK-02 | I | US-STU-03 AC1 | Idempotency-Key: gửi lại cùng key trong 15' → trả **cùng** booking, không tạo mới; key khác → booking khác (nếu slot còn trống thì đã `HELD` → 409) |
| TC-BOOK-03 | I | US-STU-03 AC2 | Webhook `SUCCEEDED` hợp lệ trong hạn (ký đúng HMAC qua mock gateway `/complete {result:SUCCESS}`) → booking `CONFIRMED`, payment `PAID`, slot `BOOKED`, outbox 2 email (STU+TUT); `GET /bookings/{id}` phản ánh đúng |
| TC-BOOK-04 | I | US-STU-03 AC3 | `/complete {result:FAILURE}` → webhook FAILED → booking `EXPIRED`, payment `FAILED`, slot `AVAILABLE` **ngay**; S-09 hiện "thất bại" + nút đặt lại |
| TC-BOOK-05 | I,U | US-STU-03 AC4 | Hết hạn 15' (FakeClock: `now = holdExpiresAt + 1s`): expiry job (30s) hoặc lazy check khi `GET /bookings/{id}` → `EXPIRED`, payment `FAILED(HOLD_EXPIRED)`, slot nhả — **không cần ai mở trang**; độ trễ ≤1' (US-SYS-02 AC1): job quét ≤30s + biên |
| TC-BOOK-06 | I | US-STU-03 AC4 | Biên: đúng `holdExpiresAt` chưa expired; `+1s` expired (FakeClock); webhook SUCCEEDED đến đúng sát hạn → hoặc CONFIRMED hoặc auto-refund, **không bao giờ** CONFIRMED sau EXPIRED (khoá `FOR UPDATE`, race test: bắn webhook song song với expire) |
| TC-BOOK-07 | I | US-STU-03 AC5 | Concurrency: 2 student `POST /bookings` **song song** cùng slotId → đúng 1 được 201, 1 nhận 409 `SLOT_UNAVAILABLE`; DB chỉ 1 booking hiệu lực/slot (unique partial index — test cả khi bypass app logic bằng raw INSERT) |
| TC-BOOK-08 | I,U | US-STU-03 AC6 | Student có booking `PENDING_PAYMENT` hoặc `CONFIRMED` trùng khung giờ (khác gia sư vẫn tính) → 409 `STUDENT_OVERLAP` + `details.conflictingBooking {id,code,startAt,endAt,tutorName}`; chạm biên 10:00 vs 10:00–11:00 → **được** đặt; exclusion constraint DB chặn cả INSERT song song |
| TC-BOOK-09 | I | US-STU-03 AC7 | Slot đã bắt đầu/quá khứ/`< now + MIN_BOOKING_LEAD_MINUTES` → 409 `SLOT_TOO_SOON` (đối chiếu mã lỗi openapi) |
| TC-BOOK-10 | I | US-STU-03 AC8 | **Tiền đến muộn:** booking `EXPIRED` → `/complete {result:SUCCESS}` (gateway vẫn cho chọn khi `FAILED(HOLD_EXPIRED)`) → webhook SUCCEEDED: booking **giữ** `EXPIRED`, payment `PAID` → tự `refund()` → `REFUNDED`, audit `LATE_PAYMENT_AUTO_REFUND`; S-09 hiện "hết hạn, đã tự hoàn" |
| TC-BOOK-11 | I,U | US-STU-03 AC9 | Webhook sai chữ ký (đổi 1 byte body / sai secret / thiếu header / `t` lệch >300s) → **401** `INVALID_SIGNATURE`, **không đổi trạng thái**, **không lưu** `payment_events` (checklist 11, 16); body sai schema → 400; body >4KB → 413 |
| TC-BOOK-12 | I | US-STU-03 AC9 | Replay: cùng `eventId` gửi 2 lần → lần 2: 200 no-op; **20 request song song** cùng eventId → đúng 1 lần áp dụng (checklist 12); SUCCEEDED rồi FAILED → FAILED bị bỏ qua + `rejected_reason` |
| TC-BOOK-13 | I | US-SYS-01 AC2 | Webhook `amountVnd` ≠ DB hoặc `providerRef` lạ → 400 `AMOUNT_MISMATCH`/`UNKNOWN_PAYMENT`, không đổi trạng thái (checklist 13: đối chiếu DB, không tin payload) |
| TC-BOOK-14 | I | — | Mock gateway ownership: student khác (kể cả student-B có booking khác) gọi `GET/POST /mock-gateway/payments/{paymentId}` → **404**; tutor/admin gọi → 404/403 theo openapi `x-roles: [STUDENT]`; chưa login → 401 |
| TC-BOOK-15 | I | — | Gateway một lần: `/complete` lần 2 → 409 `GATEWAY_ALREADY_COMPLETED`; khi `MOCK_GATEWAY_ENABLED=false` → mọi `/mock-gateway/*` 404; response `Cache-Control: no-store`, `Referrer-Policy: no-referrer` (checklist 15) |
| TC-BOOK-16 | I | — | Nginx chặn webhook từ ngoài: `POST http://localhost:8080/api/v1/payments/webhooks/mock` → 404; trong mạng compose (`INTERNAL_WEBHOOK_BASE_URL`) → hoạt động (chạy `scripts/webhook-demo.sh` làm smoke); secret/chữ ký không bao giờ xuất hiện trong response/log trình duyệt (checklist 15, 22 — R thêm log scrub) |
| TC-BOOK-17 | U | US-SYS-01 AC3 | `PaymentProvider` interface: mock provider thoả `createPayment/verifyCallback/refund`; `PaymentsService` không import provider cụ thể (test bằng stub provider — đổi provider không sửa logic booking); refund idempotent theo `idempotencyKey=payment.id` |
| TC-BOOK-18 | I | — | `POST /bookings/{id}/checkout` khi còn `PENDING_PAYMENT` → trả lại `checkoutUrl`; khi `EXPIRED/CONFIRMED` → 409 `BOOKING_NOT_PAYABLE`; booking của người khác → 404 |
| TC-BOOK-19 | U | — | `BookingStateMachine`: mọi chuyển hợp lệ §2.4 (bảng webhook × trạng thái) đúng kết quả; mọi chuyển khác → từ chối `INVALID_STATE`; terminal không đổi được |
| TC-BOOK-20 | I | — | Không có email khi mới `PENDING_PAYMENT` (chỉ khi `CONFIRMED`) — đếm outbox = 0 sau create, = 2 sau webhook thành công |
| TC-BOOK-21 | E | US-STU-03 | E2E-01/02/03/04 (§6) phủ AC1–AC4, AC8 qua UI thật |

### 5.5 F4 — Lịch của tôi, huỷ, đổi lịch (US-STU-04/05/06)

| ID | Cấp | AC | Test |
|---|---|---|---|
| TC-MINE-01 | I,E | US-STU-04 AC1 | `GET /bookings?scope=upcoming\|past\|cancelled`: chỉ booking của mình, đúng nhóm (`past` = `CONFIRMED` + `isFinished`), giờ UTC ISO, kèm `payment.status`/`refundedAt`; UI hiện GMT+7 |
| TC-MINE-02 | I | US-STU-04 AC2 | Student-A `GET /bookings/{idB}` → **404** (không 403, chống dò ID); UUID sai format → 400 |
| TC-CAN-01 | I,U | US-STU-05 AC1 | Huỷ `CONFIRMED` với `start − now ≥ 24h` (FakeClock biên: đúng 24h00m00s → được) → `CANCELLED_BY_STUDENT`, slot `AVAILABLE`, payment `REFUNDED` (100%), 2 email (§3.6) |
| TC-CAN-02 | I,U | US-STU-05 AC2 | `start − now < 24h` (biên 24h − 1s) → 409 `WINDOW_PASSED`/`CANCELLATION_WINDOW_CLOSED` theo openapi, **không đổi trạng thái**, không refund; message FE nêu quy định 24 giờ từ `vi.json` |
| TC-CAN-03 | I | US-STU-05 AC3 | Huỷ `PENDING_PAYMENT` → `EXPIRED`, slot nhả, payment không `REFUNDED` (chưa thu tiền) |
| TC-CAN-04 | I | US-STU-05 AC4 | Huỷ booking `EXPIRED`/`CANCELLED_*` → 409 (`INVALID_STATE`/`NOT_CONFIRMED`); buổi đã bắt đầu (`SESSION_STARTED`) → 409 |
| TC-CAN-05 | U | US-STU-05 AC5 | `CancellationPolicy` đọc `CANCELLATION_WINDOW_HOURS` từ config: đổi config → biên dịch theo; tính bằng **UTC server** (Clock.now), không dùng giờ client (gửi header/body múi giờ lạ không ảnh hưởng) |
| TC-RES-01 | I | US-STU-06 AC1 | Đổi lịch hợp lệ: `CONFIRMED`, ≥24h, `reschedule_count=0`, slot `AVAILABLE` cùng gia sư → booking vẫn `CONFIRMED` sang slot mới, slot cũ `AVAILABLE`, slot mới `BOOKED`, `reschedule_count=1`, không thu/hoàn tiền, 2 email "giờ cũ → giờ mới" |
| TC-RES-02 | I,U | US-STU-06 AC2–3, AC6 | `< 24h` → 409 `WINDOW_PASSED`; `reschedule_count=1` → 409 `RESCHEDULE_LIMIT`; không `CONFIRMED` → 409 `NOT_CONFIRMED` |
| TC-RES-03 | I | US-STU-06 AC4 | Slot mới: khác gia sư / không `AVAILABLE` / quá khứ / `<lead` / trùng lịch học viên với booking khác → 409 đúng mã (`SLOT_UNAVAILABLE`, `STUDENT_OVERLAP`, …); DB không đổi |
| TC-RES-04 | I | US-STU-06 AC5 | Atomic: 2 request đổi lịch song song tranh cùng slot mới → 1 thắng; bên thua booking **giữ slot cũ** nguyên trạng (kiểm tra sau rollback); khoá slot theo thứ tự id (không deadlock — chạy lặp 10 lần) |
| TC-RES-05 | U | — | `ReschedulePolicy` hàm thuần: đủ biên như TC-CAN-05 |

### 5.6 F4/F8 — Gia sư: buổi dạy, huỷ buổi; đánh giá (US-TUT-04/05/06, US-STU-07)

| ID | Cấp | AC | Test |
|---|---|---|---|
| TC-TB-01 | I | US-TUT-04 AC1 | `GET /tutor/bookings`: chỉ `CONFIRMED` (+ lịch sử huỷ) của mình, kèm tên student; **không** trả `PENDING_PAYMENT` (Q6); DTO tutor không có payment/hold/email student (checklist 8) |
| TC-TB-02 | I | US-TUT-04 AC2 | Tutor-A truy cập booking tutor-B → 404 |
| TC-TCAN-01 | I | US-TUT-05 AC1 | Tutor huỷ `CONFIRMED` trước giờ học (bất kỳ mốc nào, kể cả <24h) + lý do bắt buộc → `CANCELLED_BY_TUTOR`, payment `REFUNDED` 100%, slot `CLOSED` (**không** tự mở), email cho student (+xác nhận tutor); thiếu lý do → 400 |
| TC-TCAN-02 | I | US-TUT-05 AC2 | Buổi đã bắt đầu/đã qua → 409 `SESSION_STARTED` |
| TC-REV-01 | I | US-STU-07 AC1 | Booking `CONFIRMED` + `end_utc ≤ now` + chưa review → `POST /bookings/{id}/review` điểm 1–5 (+ nhận xét ≤1000) → lưu; `avgRating`/`reviewCount` tutor cập nhật đúng |
| TC-REV-02 | I,U | US-STU-07 AC2–4 | Chưa diễn ra → 409 `NOT_FINISHED`; không `CONFIRMED` (EXPIRED/CANCELLED) → 409; booking người khác → 404; đã review → 409 `ALREADY_REVIEWED`; điểm 0/6/1.5/chuỗi → 400 |
| TC-REV-03 | I | US-TUT-06 AC1 | `GET /tutor/reviews` + public `GET /tutors/{id}/reviews`: `PublicReview` không có `bookingId`/`hidden`; review `is_hidden` không lộ công khai; tên student rút gọn ("Nguyễn A.") |
| TC-REV-04 | I | — | Cờ `actions.review.allowed/reasonCode` server tính đúng cho từng trạng thái (FE không tự áp quy tắc) |

### 5.7 F9 — Admin (US-ADM-01..04)

| ID | Cấp | AC | Test |
|---|---|---|---|
| TC-ADM-01 | I | US-ADM-01 AC1–2 | Duyệt `PENDING_APPROVAL` → `APPROVED` (hiện công khai, email tuỳ chọn); từ chối **bắt buộc lý do** → `REJECTED` (thiếu lý do → 400); ghi `reviewedBy`/thời điểm |
| TC-ADM-02 | I | US-ADM-01 AC3 | Suspend `APPROVED` → ẩn khỏi `/tutors`, `POST /bookings` vào slot của tutor này → 409 `TUTOR_NOT_ACCEPTING`; booking `CONFIRMED` hiện có **không** bị huỷ; `reinstate` → hoạt động lại |
| TC-ADM-03 | I | US-ADM-01 AC4 | STU/TUT gọi `POST /admin/tutors/{id}/approve` → 403; chưa login → 401; `{action}` ngoài whitelist → 400; target không phải TUTOR → 404 (checklist 10) |
| TC-ADM-04 | I,C | US-ADM-02 AC1 | `GET /admin/users` lọc vai trò/email/trạng thái + phân trang; `q` escape `%`/`_`, ≤100 ký tự (checklist 18) |
| TC-ADM-05 | I | US-ADM-02 AC2, AC4 | Khoá user → login 401 `ACCOUNT_LOCKED`, **phiên hiện tại mất hiệu lực ngay** (request kế tiếp 401); mở khoá → login lại được; booking user không bị tự huỷ |
| TC-ADM-06 | I | US-ADM-02 AC3 | Admin khoá chính mình hoặc admin khác → 403/409 `CANNOT_LOCK_ADMIN` (checklist 10) |
| TC-ADM-07 | I,C | US-ADM-03 AC1 | `GET /admin/bookings` lọc trạng thái/tutor/student/khoảng ngày; chi tiết kèm lịch sử payment/refund (DTO `AdminBookingDetail`) |
| TC-ADM-08 | I | US-ADM-04 AC1 | Admin huỷ `CONFIRMED` chưa diễn ra + lý do: `refund:true` (mặc định) → `CANCELLED_BY_ADMIN`, payment `REFUNDED`, slot `CLOSED`, email 2 bên; `refund:false` → payment giữ `PAID` (đường hoàn thủ công sau) |
| TC-ADM-09 | I | US-ADM-04 AC2 | Booking đã `CANCELLED_*` + payment `PAID` chưa hoàn → `POST /admin/payments/{id}/refund` → `REFUNDED`, audit log ghi ai/khi nào; booking đã **diễn ra** `CONFIRMED` → hoàn thủ công được, booking giữ `CONFIRMED` (Q4) |
| TC-ADM-10 | I | US-ADM-04 AC3 | Hoàn lần 2 → 409 `ALREADY_REFUNDED` (idempotent, không hoàn 2 lần); payment không `PAID` → 409 `PAYMENT_NOT_REFUNDABLE` |
| TC-ADM-11 | I | US-ADM-04 AC4 | Mọi hành động admin (duyệt/từ chối/suspend/khoá/huỷ/hoàn) có dòng `audit_logs` (actor, thời điểm, lý do, target); `GET /admin/audit-logs` trả đúng |
| TC-ADM-12 | I | — | Seed admin: `SEED_ADMIN_PASSWORD` bắt buộc ≥12; `must_change_password`: login đầu → 403 `PASSWORD_CHANGE_REQUIRED` cho mọi endpoint trừ `/me`, `/me/password`, `/auth/logout` (checklist 5) |

### 5.8 F7 — Email (US-SYS-03, §3.6)

| ID | Cấp | AC | Test |
|---|---|---|---|
| TC-MAIL-01 | I,E | §3.6 | Mỗi sự kiện tạo đúng outbox → Mailpit: đặt thành công (STU+TUT: mã booking, giờ GMT+7, số tiền), student huỷ (2 bên: mã, giờ cũ, tiền hoàn), tutor huỷ (lý do, hoàn 100%), admin huỷ (lý do, hoàn tiền), đổi lịch (giờ cũ → mới) — assert `to`, subject, body chứa giá trị qua Mailpit API |
| TC-MAIL-02 | I | US-SYS-03 | Gửi **sau commit**: giao dịch booking fail (ví dụ race thua) → không có email; lỗi SMTP (tắt mailpit/tạo lỗi) → booking vẫn commit, outbox `attempts+1`, backoff 1/5/15', tối đa 5 → `FAILED`; không rollback booking |
| TC-MAIL-03 | I | US-SYS-03 | Không gửi email khi mới `PENDING_PAYMENT`; nội dung tiếng Việt, giờ `(GMT+7)` nhãn múi giờ |
| TC-MAIL-04 | U | — | Template escape HTML + bỏ `\r\n` ở subject/tên (checklist 20, D3); `to_email` lấy từ DB không từ input |
| TC-MAIL-05 | I | — | Outbox worker `SKIP LOCKED`: 2 worker song song không gửi trùng 1 bản ghi |

### 5.9 F5/F6 hệ thống — expiry job, config, NFR

| ID | Cấp | AC | Test |
|---|---|---|---|
| TC-SYS-01 | I | US-SYS-02 AC1 | Job 30s quét `PENDING_PAYMENT AND hold_expires_at <= now()` batch ≤100 `FOR UPDATE SKIP LOCKED`, mỗi booking một giao dịch; độ trễ tối đa ≤1' (FakeClock + đo) |
| TC-SYS-02 | I | — | Lazy expiry: job tắt (interval rất lớn), `GET /bookings/{id}`/`POST /bookings` slot đó sau hạn → booking tự `EXPIRED`, student khác đặt được slot đúng hạn |
| TC-SYS-03 | I | — | Job không đụng booking `CONFIRMED`/terminal; slot đã qua giờ sau expire vẫn không đặt được (`SLOT_TOO_SOON`) |
| TC-SYS-04 | I,C | — | `GET /config/public` trả đúng 6 field (`cancellationWindowHours, holdMinutes, slotDurationMinutes, minBookingLeadMinutes, timezone, mockGatewayEnabled`); đổi env → giá trị đổi (config-driven, không hard-code) |
| TC-SYS-05 | I | NFR-2 | DTO từ chối chuỗi thời gian không offset; DB `timestamptz`; container `TZ=UTC`; so sánh 24h/15' bằng UTC server |
| TC-SYS-06 | E,R | NFR-3 | UI chỉ tiếng Việt; **grep scan**: không có chuỗi text hard-code tiếng Việt trong component (ESLint rule hoặc script kiểm tra) — text lấy từ `vi.json` |
| TC-SYS-07 | R | NFR-1 | `docker compose up` một lệnh chạy đủ db+mailpit+api+web (verify khi T1 xong, chạy lại ở T12) |
| TC-SYS-08 | I | — | Rate limit: global 100'/IP khách, 300' user; `POST /bookings` 10'/user; `/me/password` 5'; webhook 60'/IP → vượt → 429 `RATE_LIMITED` (checklist 23) |
| TC-SYS-09 | I,R | — | Security headers (helmet/CSP `default-src 'self'`), CORS tắt, `X-Powered-By` tắt, lỗi không lộ stack (checklist 22); log không chứa mật khẩu/token/secret/`providerRef` (test log scrub) |
| TC-SYS-10 | I | — | Validation: `additionalProperties:false` mọi DTO — gửi thừa `studentId`/`tutorId`/`price`/`status`/`role` → 400 (checklist 9); `ParseUUIDPipe` mọi `:id`; `sort` ngoài whitelist → 400 (checklist 18) |
| TC-SYS-11 | R | — | Khởi động fail khi secret thiếu/ngắn/giá trị mẫu/trùng nhau (mọi môi trường trừ `test`) (checklist 21); gitleaks + `npm audit` xanh trong CI |

### 5.10 Ánh xạ checklist bảo mật 23 mục (Security E) → test

| # checklist | Test | # checklist | Test |
|---|---|---|---|
| 1 | TC-AUTH-09 (route list khớp `x-roles`) | 13 | TC-BOOK-13 |
| 2 | TC-AUTH-14, TC-AUTH-07 | 14 | TC-BOOK-06, TC-BOOK-10, TC-SYS-01 (race) |
| 3 | TC-AUTH-05, TC-AUTH-10 + R (không token ở localStorage) | 15 | TC-BOOK-14/15/16 |
| 4 | TC-AUTH-06, TC-AUTH-13 | 16 | TC-BOOK-11 |
| 5 | TC-AUTH-04, TC-ADM-12 | 17 | E2E-10 (§6) |
| 6 | TC-AUTH-09 | 18 | TC-SYS-10, TC-PUB-05 |
| 7 | R (code review T11) + TC-AUTH-09/TC-MINE-02 | 19 | R (grep CI — tagged template SQL) |
| 8 | TC-PUB-06, TC-TB-01 (snapshot DTO) | 20 | TC-MAIL-04, (D2: upload magic bytes — TC bổ sung khi T3/T5 code avatar) |
| 9 | TC-SYS-10 | 21 | TC-SYS-11 |
| 10 | TC-ADM-03, TC-ADM-06, TC-ADM-11 | 22 | TC-SYS-09 |
| 11 | TC-BOOK-11 | 23 | TC-SYS-08 |
| 12 | TC-BOOK-12 | | |

## 6. Bộ E2E Playwright (chạy sau khi T8 xong)

### 6.1 Cấu trúc & cấu hình

```
e2e/
├─ playwright.config.ts     # baseURL = WEB_BASE_URL || http://localhost:8080
├─ package.json             # @playwright/test; script "e2e"
├─ fixtures/
│  ├─ auth.ts               # login API-first, lưu storageState theo vai trò (student1, student2, tutor1, admin)
│  ├─ data.ts               # tạo slot/booking qua API cho precondition
│  └─ mailpit.ts            # waitForEmail/clearEmails qua http://localhost:8025/api/v1
└─ tests/
   ├─ booking-payment.spec.ts   # E2E-01..05, E2E-10
   ├─ cancel-refund.spec.ts     # E2E-06..08
   ├─ flows.spec.ts             # E2E-09, E2E-11..13
```

- `playwright.config.ts`: `projects: [{name:'chromium'}]`, `workers: 1`, `retries: process.env.CI ? 1 : 0`, `use: { trace: 'on-first-retry', screenshot: 'only-on-failure' }`, `timeout: 60_000`, `expect.timeout: 10_000`.
- Không `sleep` cứng: dùng `expect.poll` / `page.waitForResponse` / helper `waitForBookingStatus(apiContext, id, status, {timeoutMs: 35_000})` (S-09 poll 2s phía app; test poll phía API).
- Precondition bằng API (login, tạo slot, approve tutor demo có sẵn từ seed) — UI chỉ cho phần đang kiểm thử. Mỗi test dùng email/biển dữ liệu unique; `clearEmails()` trước khi assert mail.
- Chạy local: `docker compose -f docker-compose.yml -f docker-compose.test.yml up -d --build && npm run e2e`.

### 6.2 Kịch bản (★ = bắt buộc theo T10; ☆ = mở rộng)

| ID | Kịch bản | Assert chính (AC) |
|---|---|---|
| **E2E-01 ★ Thanh toán thành công** | student1 login → tìm tutor1 (S-02) → mở hồ sơ, chọn slot `AVAILABLE` (S-03) → xác nhận đặt (S-06) → S-07 hiện countdown + số tiền = học phí → "Thanh toán ngay" → S-08 hiện mã booking/số tiền → bấm **Thành công** → S-09 | S-09 "thành công" (poll `GET /bookings/{id}` → `CONFIRMED`); "Lịch của tôi" có booking `CONFIRMED` giờ GMT+7, payment đã trả; slot biến mất khỏi lịch trống; **Mailpit: 2 email** (student + tutor) chứa mã booking, giờ `(GMT+7)`, số tiền (US-STU-03 AC1–2, US-SYS-01 AC1, §3.6) |
| **E2E-02 ★ Thanh toán thất bại** | như E2E-01 đến S-08 → bấm **Thất bại** | S-09 "thất bại" + nút **Đặt lại**; API: booking `EXPIRED`, payment `FAILED`, slot `AVAILABLE` — đặt lại được ngay từ nút đó (US-STU-03 AC3); không có email thành công |
| **E2E-03 ★ Hết hạn 15 phút** | đặt slot → S-07 hiện countdown → dùng clock giả (§7) đưa `now` vượt `holdExpiresAt` → reload S-07/S-09 (hoặc chờ lazy-expire khi app poll) | S-09 hiện "hết hạn"; booking `EXPIRED`, slot nhả (student2 thấy slot đặt được); payment `FAILED(HOLD_EXPIRED)`; **không** email thành công (US-STU-03 AC4, US-SYS-02 AC1) |
| **E2E-04 ★ Tiền đến muộn (auto-refund)** | tiếp nối E2E-03: vào lại S-08 (gateway vẫn cho chọn "Thành công" khi đã hết hạn) → bấm Thành công | Booking **vẫn** `EXPIRED`; payment `PAID`→`REFUNDED`; S-09 hiện "hết hạn, đã tự hoàn"; audit log có `LATE_PAYMENT_AUTO_REFUND` (admin xem chi tiết booking) (US-STU-03 AC8) |
| **E2E-05 ★ Countdown & resume checkout** | đặt slot → rời trang → vào "Lịch của tôi" → mở booking `PENDING_PAYMENT` → `POST /checkout` qua UI quay lại S-07; countdown tính theo `holdExpiresAt − serverTime` (không theo giờ máy) | Countdown > 0 và ≤ 15'; sau khi clock giả vượt hạn → S-07/S-09 hiện hết hạn, không cho thanh toán tiếp (`BOOKING_NOT_PAYABLE`/`completable:false`) |
| **E2E-06 ★ Student huỷ + hoàn tiền** | chuẩn bị booking `CONFIRMED` (E2E flow) với `start ≥ now+24h` (seed/API) → "Lịch của tôi" → huỷ (S-12) xác nhận | booking `CANCELLED_BY_STUDENT`; UI hiện hoàn 100% (`REFUNDED`); slot về `AVAILABLE` trên lịch tutor; **Mailpit: 2 email huỷ** chứa mã booking, giờ cũ, số tiền hoàn (US-STU-05 AC1) |
| **E2E-07 ★ Huỷ trong <24h bị chặn** | booking `CONFIRMED` `start = now+23h` (API) → UI huỷ | Nút huỷ ẩn/disabled với `reasonCode=WINDOW_PASSED` (server tính `actions.cancel.allowed`); nếu gọi thẳng API → 409, UI hiện thông báo quy định 24 giờ từ `vi.json`; trạng thái không đổi (US-STU-05 AC2) |
| **E2E-08 ★ Tutor huỷ + admin hoàn thủ công** | tutor1 login → "Buổi dạy" → huỷ (S-22) có lý do → student1 thấy hoàn 100%; biến thể admin: admin login (đổi mật khẩu bắt buộc lần đầu) → S-28 huỷ `refund:false` → S-27 bấm hoàn thủ công → hoàn lần 2 bị chặn | `CANCELLED_BY_TUTOR`/`CANCELLED_BY_ADMIN`, slot `CLOSED` (tutor không thấy slot mở lại tự động; có nút "Mở lại" S-18), email đến student; refund lần 2 → thông báo `ALREADY_REFUNDED` (US-TUT-05, US-ADM-04 AC1–3) |
| **E2E-09 ☆ Đổi lịch** | booking `CONFIRMED` ≥24h, `reschedule_count=0` → S-13/S-14 chọn slot khác cùng tutor | slot đổi, giờ mới GMT+7 đúng, slot cũ mở lại, `reschedule_count=1`; đổi lần 2 → UI chặn (`RESCHEDULE_LIMIT`); email "giờ cũ → giờ mới" trong Mailpit (US-STU-06 AC1, AC3) |
| **E2E-10 ★ Trang kết quả không tin query string** | tạo booking `PENDING_PAYMENT` → mở `/thanh-toan/{id}/ket-qua?status=success` giả | S-09 hiển thị theo **trạng thái thật** (đang chờ/hết hạn), không hiện "thành công" giả (Security checklist 17) |
| **E2E-11 ☆ Chống trùng lịch qua UI** | student1 đặt slot X `CONFIRMED`; student1 mở slot Y trùng giờ (tutor khác, seed) → xác nhận đặt | UI hiện lỗi trùng lịch với thông tin booking xung đột (`details.conflictingBooking`: giờ, tên tutor) từ `vi.json` (US-STU-03 AC6) |
| **E2E-12 ☆ Review sau buổi học** | booking `CONFIRMED` có `end ≤ now` (seed qua clock/DB) → S-14 gửi 5★ + nhận xét | Review lưu; hồ sơ công khai tutor hiện điểm mới; gửi lần 2 → bị chặn `ALREADY_REVIEWED` (US-STU-07) |
| **E2E-13 ☆ Webhook nội bộ, không truy cập được từ browser** | từ test (network ngoài compose): `POST {WEB}/api/v1/payments/webhooks/mock` kể cả body ký đúng secret (secret chỉ có trong env CI, test mô phỏng request không ký) | Nginx trả 404; trạng thái booking không đổi (Security B5, checklist 15) |

Ghi chú phạm vi: E2E-01..05 + 06..08 + 10 là nòng cốt theo yêu cầu T10 (thành công/thất bại/hết hạn, huỷ & hoàn tiền, email Mailpit). Các ca ☆ chạy sau khi nòng cốt xanh, tận dụng cùng fixture.

### 6.3 CI job `e2e` (thêm vào `.github/workflows/ci.yml` khi T8 sẵn sàng)

```yaml
  e2e:
    name: E2E (Playwright)
    runs-on: ubuntu-24.04
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20.18.1', cache: npm }
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - name: Prepare .env (CI-only secrets)
        run: |
          cp .env.example .env
          {
            echo "POSTGRES_PASSWORD=ci-only-postgres"
            echo "JWT_SECRET=$(openssl rand -hex 32)"
            echo "PAYMENT_WEBHOOK_SECRET=$(openssl rand -hex 32)"
            echo "SEED_ADMIN_PASSWORD=ci-only-admin-password-$(openssl rand -hex 4)"
            echo "SEED_DEMO_DATA=true"
          } >> .env
      - name: Boot stack
        run: |
          docker compose -f docker-compose.yml -f docker-compose.test.yml up -d --build
          timeout 180s bash -c 'until docker compose ps api | grep -q healthy; do sleep 3; done'
          curl -fsS --retry 30 --retry-delay 2 --retry-all-errors http://localhost:8080/ >/dev/null
      - name: Run Playwright
        run: npm run e2e
      - uses: actions/upload-artifact@v4
        if: ${{ !cancelled() }}
        with: { name: playwright-report, path: e2e/playwright-report, retention-days: 7 }
      - name: Dump logs on failure
        if: failure()
        run: docker compose logs --tail 300 > e2e/compose-logs.txt
```

(Yêu cầu cho T1/T8: thêm workspace `e2e` vào root `package.json` `workspaces` và script `e2e`; biến môi trường clock §7 vào `docker-compose.test.yml`. Secret CI chỉ là giá trị local, sinh ngẫu nhiên — gitleaks allowlist trong `.gitleaks.toml` nếu cần, không dùng secret thật.)

### 6.4 Tiêu chí vào/ra của bộ E2E

- **Vào:** T1 done (compose + CI xanh); T4/T5 (backend booking/payment/email) merged; T8 (UI học viên) merged; seed demo có tutor `APPROVED` + slot; cơ chế clock §7 đã chốt và bật được trong `docker-compose.test.yml`.
- **Ra:** 100% kịch bản ★ xanh ổn định (3 lần chạy liên tiếp không flake); ca ☆ xanh hoặc có issue theo dõi; report + trace upload làm artifact; mỗi AC trọng tâm (US-STU-03 AC1–4, AC8; US-STU-05 AC1–2; US-TUT-05; US-ADM-04; US-SYS-02; §3.6) được phủ ít nhất 1 ca E2E hoặc I.

## 7. Clock giả cho test hết hạn — phối hợp Backend (quyết định ở T2/T4)

Vấn đề: E2E chạy trên stack compose với `NODE_ENV=production` (theo `docker-compose.test.yml` hiện tại) nên không thể inject `FakeClock` in-process như integration test, và không nên chờ thật 15 phút.

| Phương án | Cơ chế | Ưu | Nhược |
|---|---|---|---|
| **1 (QA đề xuất)** | Biến `TEST_CLOCK_ENABLED=true` (mặc định false, **chỉ** bật trong compose test/CI). Khi bật: (a) endpoint nội bộ `POST /api/v1/test/clock/advance {seconds}` cộng offset toàn process vào `Clock.now()`; nginx **chặn `/api/v1/test/*` từ ngoài** (như đã chặn webhook); (b) `Clock.now() = SystemClock + offset`. Offset lưu in-memory, reset khi restart | Test đi qua đường thật (lazy-expire + job + webhook muộn), không cần DB access, nhanh | Backend thêm ~30 dòng code + rule chặn nginx; phải đảm bảo không bao giờ bật ở production (guard: từ chối khởi động nếu `TEST_CLOCK_ENABLED=true` và `NODE_ENV=production` **không kèm** cờ CI? → đơn giản nhất: chỉ đọc biến này khi `MOCK_GATEWAY_ENABLED=true`) |
| **2 (fallback, không cần code)** | E2E thao tác DB trực tiếp qua cổng `127.0.0.1:5432` (compose đã expose): `UPDATE bookings SET hold_expires_at = now() - interval '1 minute' WHERE id = …` rồi chạm lazy-expire (`GET /bookings/{id}`) hoặc chờ job 30s; với mốc 24h: tạo booking có `start_at` mong muốn qua seed/SQL | Zero thay đổi backend | Không test đường Clock/job đầy đủ (job vẫn quét được vì so `now()` DB); test耦合 schema; cần `pg` client trong e2e |
| **3 (dự phòng cuối)** | `BOOKING_HOLD_MINUTES=1` trong e2e env, chờ thật ~90s | Không code, không DB | Chậm (+1,5–2'/test), chỉ áp dụng cho 1 ca; flaky nếu CI chậm |

- Unit/integration (BE, T2/T4): `FakeClock` inject qua DI như architecture §2.7 — đủ cho biên 15'/24h chính xác tới giây.
- QA cần chốt phương án **trước khi T4 code expiry job** để kịp thiết kế; đề nghị Backend trả lời trên issue phối hợp (sẽ tạo) hoặc qua Tech Lead khi review plan này.
- Nếu chọn PA1: thêm vào `docker-compose.test.yml`: `TEST_CLOCK_ENABLED: "true"` cho `api`; nginx conf thêm location `/api/v1/test/ { return 404; }` cho traffic ngoài; helper e2e `advanceClock(seconds)` gọi `docker compose exec api wget --post-data …  http://127.0.0.1:3000/api/v1/test/clock/advance` (trong mạng nội bộ) hoặc qua cổng API nếu cho phép `127.0.0.1`.

## 8. Vai trò & trách nhiệm

| Ai | Việc |
|---|---|
| QA (T10) | Test plan này; viết + chạy bộ E2E Playwright; job CI `e2e`; fixture Mailpit/clock; tổng hợp kết quả T12 (P4); smoke `webhook-demo.sh` |
| Backend (T2–T5) | Unit + integration cho module của mình (bắt buộc ở T4: unit policy, integration concurrency, webhook ký sai/lặp/muộn); ma trận phân quyền endpoint mới (DoD); test contract OpenAPI; chốt clock §7 |
| Frontend (T6–T9) | Không hard-code text (chỉ `vi.json`); `lib/time.ts` có unit test; trang kết quả poll trạng thái thật (E2E-10) |
| DevOps (T1) | Compose + CI ổn định; thêm workspace `e2e`, job `e2e`, expose Mailpit/DB cho runner; gitleaks + npm audit |
| Tech Lead (T11) | Review plan này; gate DoD mọi PR; quyết định cuối §7 cùng Backend |
| Security (T13) | Rà auth/webhook trước khi đóng P3; checklist 23 mục — QA đã map test §5.10 |

## 9. Quy trình thực thi & quản lý lỗi

- **Chạy:** mọi PR → CI (lint, test, build, compose, gitleaks, audit; thêm `e2e` khi T8 xong). Nightly không bắt buộc (repo đồ án, CI theo PR là đủ).
- **Mức lỗi:** Critical = mất dữ liệu/sai tiền/trạng thái không thể phục hồi, security exploit (webhook giả mạo đổi trạng thái, IDOR đọc/sửa dữ liệu người khác); High = AC chính fail không có workaround (không đặt được, không huỷ được <24h sai luật, email không gửi); Medium = AC phụ/sai hiển thị có workaround; Low = cosmetic/text.
- **Báo lỗi:** issue Paperclip gắn nhãn module + mức, kèm: bước tái hiện, expected (AC/test ID), actual, log/trace/artifact Playwright, môi trường (commit SHA).
- **Flake:** test fail không ổn định → bật trace, sửa root cause (chờ đúng điều kiện, không sleep); không tắt test để "xanh". Retry CI = 1 (chẩn đoán, không che flake).
- **Regression P4 (T12):** chạy toàn bộ suite trên build compose sạch + test plan exploratory theo ma trận §5; gate 0 Critical/High.

## 10. Rủi ro

| Rủi ro | Giảm thiểu |
|---|---|
| T8 trễ → E2E trễ (hạn 12-17) | Viết trước toàn bộ fixture/spec skeleton ngay khi T4 merged (test API-level tạm thay UI); ca ★ chỉ cần S-06..S-09 |
| Clock mechanism chưa chốt | §7 có sẵn fallback PA2/PA3 không cần backend; issue phối hợp gửi Backend sớm |
| Flake do mail outbox (15s) / job (30s) | Helper wait đúng timeout (60s/35s), `workers:1`, trace |
| Seed data không đủ (thiếu tutor approved, slot cạn) | Fixture tạo dữ liệu qua API mỗi test; seed chuẩn hoá ở T2 |
| CI không có display/chromium deps | `npx playwright install --with-deps chromium`; headless mặc định |

## 11. Câu hỏi cho Tech Lead khi review

1. §7: chốt PA1 (test-clock endpoint, guard bằng `MOCK_GATEWAY_ENABLED`/`TEST_CLOCK_ENABLED`) hay PA2 (DB manipulation)? Ảnh hưởng T2 (Clock) và T4 (expiry job) + nginx conf (T1).
2. E2E mở rộng (☆ E2E-09, 11, 12, 13) giữ trong phạm vi T10 hay dời sang T12 (P4) nếu T8 về sát hạn?
3. `docker-compose.test.yml` hiện đặt `NODE_ENV=production` cho api — giữ (sát demo thật, cần cờ riêng cho test-clock) hay chuyển `test`? (Guard secret D5 bỏ qua khi `NODE_ENV=test` → QA nghiêng về giữ `production` + cờ tường minh.)
4. Ma trận phân quyền tự động (TC-AUTH-09, checklist 6): đặt trong repo dưới dạng test sinh từ `docs/openapi.yaml` (một lần, chạy mọi PR) — giao Backend viết khung hay QA? QA đề xuất: Backend viết khung trong T2 (gần guard), QA bổ sung case sở hữu (404) ở T10.
