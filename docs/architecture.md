# Kiến trúc — MVP Web Tutor Booking Management (QUA-6 / P2b)

> **Rev 3 — gửi CEO duyệt (cổng P2b).** Đã đối chiếu API với flow màn hình P2a ([design v1.2](/QUA/issues/QUA-5#document-design), review Tech Lead tại [QUA-8](/QUA/issues/QUA-8)), xem mục 4.1. Đã xử lý góp ý sớm của Security ([QUA-9](/QUA/issues/QUA-9)), xem mục 5.
> Đầu vào: [plan rev 2](/QUA/issues/QUA-2#document-plan), [requirements P1](/QUA/issues/QUA-4#document-requirements) (đã duyệt), quyết định CEO #1–#6 ngày 2026-11-04.
> Đặc tả API đầy đủ: [openapi](/QUA/issues/QUA-6#document-openapi) (OpenAPI 3.1). Mã định danh user story (US-…) và quy tắc (§3.x) tham chiếu tài liệu requirements.

## 0. Tóm tắt quyết định

| Hạng mục | Chọn | Lý do chính |
|---|---|---|
| Ngôn ngữ | TypeScript ở cả backend và frontend | Một ngôn ngữ cho cả repo; dùng chung kiểu sinh từ OpenAPI. |
| Backend | **NestJS 10** (Node.js 20 LTS) | Phổ biến, có sẵn Guard/RBAC, ValidationPipe, `@nestjs/swagger`, `@nestjs/schedule`. Cấu trúc module rõ, người chấm dễ đọc. |
| DB | **PostgreSQL 16** | Có `EXCLUDE USING gist` + `tstzrange` → chống trùng lịch ở tầng DB (CEO/NFR-5). `timestamptz` lưu UTC. MySQL không có exclusion constraint. |
| ORM / migration | **Prisma 5** + migration SQL viết tay cho constraint đặc biệt | Phổ biến, schema dễ đọc. Exclusion constraint và partial unique index thêm bằng raw SQL trong migration. |
| Frontend | **React 18 + Vite**, React Router, TanStack Query, Ant Design 5 (locale `vi_VN`), react-hook-form + zod, dayjs (plugin `utc` + `timezone`) | Stack SPA phổ biến nhất; Ant Design có sẵn bảng, form, DatePicker tiếng Việt cho trang Admin. |
| i18n | `react-i18next`, một file `apps/web/src/i18n/vi.json`; email dùng `apps/api/src/mail/templates/vi/*` | CEO #5: chỉ tiếng Việt, text gom một chỗ. |
| Email | Nodemailer → **Mailpit** (SMTP 1025, UI 8025) | CEO #3. Gửi qua bảng outbox để không phụ thuộc giao dịch booking (§3.6). |
| Thanh toán | `PaymentProvider` + `MockPaymentProvider` (cổng giả lập trong cùng backend), webhook ký HMAC-SHA256 | CEO #1. VNPay sandbox là triển khai thứ hai, tuỳ chọn. |
| Job nền | `@nestjs/schedule` trong process API, `SELECT … FOR UPDATE SKIP LOCKED` | Không cần Redis/queue → ít service, chi phí 0. |
| Test | Jest (unit), Jest + Supertest với PostgreSQL thật (integration), Playwright (E2E) | Bắt buộc có test tự động cho đặt lịch và thanh toán; constraint DB chỉ kiểm được trên Postgres thật. |
| Chạy | `docker compose up`: `db`, `mailpit`, `api`, `web` | CEO #3, NFR-1. |
| CI | GitHub Actions (free tier, repo public hoặc quota free) | Lint + test + build mỗi PR. Chi phí 0. |
| Deploy public (tuỳ chọn) | Không bắt buộc. Nếu cần: một VM/PaaS free tier chạy cùng compose file | CEO #3: demo local là đủ; mọi chi phí phải hỏi board. |

Phương án đã cân nhắc và không chọn: Spring Boot + JPA (nặng hơn, vòng build chậm, hai ngôn ngữ trong repo); Django + DRF (tốt nhưng tách ngôn ngữ FE/BE, khó dùng chung kiểu); Next.js full-stack (gộp FE/BE làm mờ ranh giới API cần cho OpenAPI và cho review bảo mật); MySQL (không có exclusion constraint, phải tự khoá bằng code).

---

## 1. Stack và cách chạy

### 1.1 Cấu trúc repo (một repo, npm workspaces)

```
tutor-booking/
├─ apps/
│  ├─ api/                 NestJS
│  │  ├─ prisma/           schema.prisma, migrations/ (gồm SQL constraint), seed.ts
│  │  ├─ src/
│  │  │  ├─ common/        auth guards, decorators, Clock, error filter, config
│  │  │  ├─ auth/  users/  tutors/  subjects/  slots/
│  │  │  ├─ bookings/      state machine, policies (cancel/reschedule), expiry job
│  │  │  ├─ payments/      PaymentProvider, mock provider, webhook controller, mock-gateway pages
│  │  │  ├─ reviews/  admin/  mail/ (outbox + worker + templates/vi)  audit/
│  │  └─ test/             integration + concurrency tests (Postgres thật)
│  └─ web/                 React + Vite
│     └─ src/ (pages/, features/, api/ (client sinh từ openapi), i18n/vi.json, lib/time.ts)
├─ e2e/                    Playwright (đặt lịch + thanh toán, đọc email qua API Mailpit)
├─ docs/                   architecture.md, openapi.yaml (nguồn chuẩn), runbook.md
├─ docker-compose.yml      db, mailpit, api, web
├─ docker-compose.test.yml (override: DB test, chạy integration/E2E trong CI)
├─ .env.example            không chứa secret thật
└─ .github/workflows/ci.yml
```

`docs/openapi.yaml` là nguồn chuẩn (contract-first). Backend kiểm tra contract bằng test (so sánh spec sinh từ `@nestjs/swagger` với file chuẩn); frontend sinh kiểu bằng `openapi-typescript`.

### 1.2 Docker Compose

| Service | Image | Cổng host | Ghi chú |
|---|---|---|---|
| `db` | `postgres:16-alpine` | 5432 (tuỳ chọn) | Volume `pgdata`; healthcheck `pg_isready`. |
| `mailpit` | `axllent/mailpit` | 8025 (UI), 1025 (SMTP) | Xem toàn bộ email demo. |
| `api` | build `apps/api` (multi-stage, `node:20-alpine`) | — (chỉ qua `web`) | Lúc khởi động: `prisma migrate deploy` → seed (idempotent) → `node dist/main`. Chạy luôn job hết hạn và worker gửi mail. Volume `uploads` cho ảnh đại diện. |
| `web` | build `apps/web` → `nginx:alpine` | **8080** | Phục vụ SPA (kể cả trang cổng giả lập S-08); reverse proxy `/api/*` sang `api:3000`. Một origin → cookie đơn giản, không cần CORS. |

Người chấm chỉ cần: `cp .env.example .env && docker compose up --build` → mở `http://localhost:8080` (app) và `http://localhost:8025` (email). Seed: 1 Admin (mật khẩu lấy từ `SEED_ADMIN_PASSWORD` trong `.env`, buộc đổi ở lần đăng nhập đầu). Khi `SEED_DEMO_DATA=true` (mặc định cho demo local) có thêm vài gia sư đã duyệt kèm slot và vài học viên; mật khẩu tài khoản demo không phải Admin ghi trong README. Phải tắt cờ này khi deploy public.

### 1.3 Cấu hình (biến môi trường, đọc qua `@nestjs/config` + validate bằng zod khi khởi động)

| Biến | Mặc định | Dùng cho |
|---|---|---|
| `BOOKING_HOLD_MINUTES` | 15 | Giữ slot khi `PENDING_PAYMENT` (CEO #1). |
| `CANCELLATION_WINDOW_HOURS` | 24 | Mốc huỷ / đổi lịch của học viên (CEO #2). |
| `MIN_BOOKING_LEAD_MINUTES` | 60 | Giả định A2. |
| `SLOT_DURATION_MINUTES` | 60 | Giả định A1. |
| `EXPIRY_JOB_INTERVAL_SECONDS` | 30 | Đảm bảo độ trễ hết hạn ≤ 1 phút (US-SYS-02). |
| `DISPLAY_TIMEZONE` | `Asia/Ho_Chi_Minh` | Email và mặc định FE. |
| `PAYMENT_PROVIDER` | `mock` | `mock` \| `vnpay` (tuỳ chọn). |
| `MOCK_GATEWAY_ENABLED` | `true` (compose demo); mặc định `false` khi `NODE_ENV=production` | Tắt → mọi `/mock-gateway/*` trả 404. |
| `AVATAR_MAX_BYTES` | 2097152 | Ảnh đại diện ≤ 2 MB, JPG/PNG. |
| `PAYMENT_WEBHOOK_SECRET` | (bắt buộc, ≥ 32 byte) | Ký/verify HMAC. |
| `JWT_SECRET` | (bắt buộc, ≥ 32 byte, khác webhook secret) | Ký token phiên. |
| `SEED_ADMIN_PASSWORD` | (bắt buộc, ≥ 12 ký tự, không có mặc định) | Mật khẩu Admin seed (Security C6). |
| `SEED_DEMO_DATA` | `true` trong compose demo | Seed gia sư/học viên demo; `false` khi deploy public. |
| `INTERNAL_WEBHOOK_BASE_URL` | `http://api:3000` | Địa chỉ nội bộ để cổng giả lập gửi webhook (Security B5). |
| `DATABASE_URL`, `SMTP_HOST`, `SMTP_PORT`, `APP_BASE_URL` | theo compose | |

Secret chỉ nằm trong `.env` (đã `.gitignore`); `.env.example` có giá trị giả và hướng dẫn tạo (`openssl rand -hex 32`). API từ chối khởi động nếu secret thiếu, ngắn, là giá trị mẫu, hoặc hai secret trùng nhau, ở mọi môi trường trừ `NODE_ENV=test` (Security D5). Compose không đặt mật khẩu DB mặc định; cổng DB và SMTP chỉ bind `127.0.0.1`.

---

## 2. Kiến trúc tổng thể

### 2.1 Sơ đồ

```
Trình duyệt (SPA React, giờ hiển thị Asia/Ho_Chi_Minh)
   │  HTTPS/HTTP same-origin, cookie httpOnly
   ▼
nginx (web:8080) ── /            → file tĩnh SPA (gồm trang cổng giả lập /cong-thanh-toan-gia-lap/:paymentId)
                 ── /api/v1/*    → api:3000
   ▼
NestJS API (api:3000) — modular monolith
   ├─ Controllers (REST, DTO validate)  ── Guards: JwtAuth → Roles → (TutorApproved)
   ├─ Services (nghiệp vụ, kiểm tra sở hữu, máy trạng thái)  ── Clock (inject, test được)
   ├─ PaymentProvider ◄── MockPaymentProvider | VnpayProvider(tuỳ chọn)
   ├─ Jobs: BookingExpiryJob (30s), MailOutboxWorker (15s)
   └─ Prisma ──► PostgreSQL 16 (UTC, constraint chống trùng)
                         ▲
MailOutboxWorker ── SMTP ──► Mailpit
MockGateway (module trong API) ── POST webhook ký HMAC ──► /api/v1/payments/webhooks/mock (đi qua HTTP thật, cùng code path với cổng thật; demo được webhook sai chữ ký/lặp bằng curl)
```

Kiểu kiến trúc: **modular monolith** (một process API, chia module theo nghiệp vụ). Đủ cho MVP, dễ chạy bằng compose, dễ review. Ranh giới module rõ để sau tách được nếu cần.

### 2.2 Luồng đặt lịch + thanh toán (đường chính, US-STU-03, US-SYS-01)

1. Học viên `POST /api/v1/bookings {slotId}`.
2. API trong **một giao dịch**: khoá dòng slot (`SELECT … FOR UPDATE`), kiểm tra slot `AVAILABLE`, gia sư `APPROVED`, `start_at ≥ now + MIN_BOOKING_LEAD`, người đặt là STUDENT; `INSERT booking (PENDING_PAYMENT, hold_expires_at = now + 15')` — exclusion constraint chặn trùng lịch học viên, unique partial index chặn 2 booking hiệu lực/slot; `UPDATE slot → HELD`; `INSERT payment (PENDING, amount = giá chốt)`. Commit.
3. API gọi `provider.createPayment()` → trả `checkoutUrl` (mock: `/cong-thanh-toan-gia-lap/{paymentId}`). Response `201 {booking, checkoutUrl, serverTime}` → SPA mở S-07 (đếm ngược theo `holdExpiresAt − serverTime`).
4. S-07 "Thanh toán ngay" → trang cổng giả lập S-08 (route SPA, giao diện khác app chính). Trang gọi `GET /api/v1/mock-gateway/payments/{paymentId}` — **yêu cầu phiên của chính học viên chủ booking** — để hiện mã booking, số tiền và 2 nút **Thanh toán thành công / Thất bại**.
5. Bấm nút → `POST /api/v1/mock-gateway/payments/{paymentId}/complete {result}`. API kiểm tra chủ sở hữu, payment chưa từng được "hoàn tất" ở cổng (`gateway_completed_at IS NULL`), rồi **chính API** tạo sự kiện, ký HMAC và **POST webhook** tới `/api/v1/payments/webhooks/mock` qua HTTP thật. Trả `{redirectUrl: "/thanh-toan/{bookingId}/ket-qua"}`.
6. Webhook handler: verify chữ ký + timestamp → ghi `payment_events` (unique `event_id` → idempotent) → giao dịch khoá dòng booking `FOR UPDATE` → áp máy trạng thái (§2.4). Commit → ghi outbox email (cùng giao dịch).
7. Trang kết quả S-09 **không tin query string**; nó gọi `GET /api/v1/bookings/{id}` (poll 2s, tối đa 30s) và hiển thị theo trạng thái thật: `CONFIRMED` → "thành công"; `EXPIRED` + payment `FAILED` → "thất bại"; `EXPIRED` + payment `REFUNDED` → "hết hạn, đã tự hoàn".

### 2.3 Hết hạn giữ slot (US-SYS-02) và race với webhook

- `BookingExpiryJob` chạy mỗi 30 giây: lấy tối đa 100 booking `PENDING_PAYMENT AND hold_expires_at <= now()` bằng `FOR UPDATE SKIP LOCKED`; với mỗi booking: `→ EXPIRED`, `payment PENDING → FAILED`, `slot HELD → AVAILABLE` (slot đã qua giờ vẫn không đặt được vì luật `MIN_BOOKING_LEAD`). Một giao dịch mỗi booking.
- Kiểm tra lười: mọi thao tác đọc/ghi booking hoặc slot đều coi `PENDING_PAYMENT` có `hold_expires_at <= now` là hết hạn (gọi `expireIfDue()` trong giao dịch trước khi xử lý). Nhờ đó dù job trễ, người khác vẫn đặt được slot đúng hạn.
- Race webhook ↔ job: cả hai đều khoá dòng booking `FOR UPDATE`; bên nào giữ khoá trước thắng, bên sau đọc lại trạng thái và xử lý theo bảng §2.4 (không bao giờ có `CONFIRMED` sau `EXPIRED`).
- Webhook thành công đến khi `now ≥ hold_expires_at` được xử lý như "đến muộn" (không gia hạn). Theo design S-08, cổng giả lập **vẫn cho chọn "Thành công"** khi booking đã hết hạn (mô phỏng cổng thật nhận tiền muộn) để demo AC8; mỗi payment chỉ "hoàn tất" ở cổng được một lần.
- Khi hết hạn do quá giờ, payment → `FAILED` với `failure_reason = HOLD_EXPIRED`. Chỉ trường hợp này mới cho phép chuyển `FAILED → PAID` (tiền đến muộn), và ngay sau đó tự hoàn → `REFUNDED`.

### 2.4 Máy trạng thái (cài trong `BookingStateMachine`, một chỗ duy nhất được đổi `status`)

Booking: `PENDING_PAYMENT → CONFIRMED | EXPIRED`; `CONFIRMED → CANCELLED_BY_STUDENT | CANCELLED_BY_TUTOR | CANCELLED_BY_ADMIN`; `CONFIRMED → CONFIRMED` (đổi lịch). `EXPIRED`, `CANCELLED_*` là terminal. Payment: `PENDING → PAID | FAILED`; `PAID → REFUNDED`; `FAILED(HOLD_EXPIRED) → PAID` chỉ cho tiền đến muộn (rồi tự `REFUNDED`). Slot: `AVAILABLE ↔ HELD → BOOKED`; `BOOKED → AVAILABLE` (học viên huỷ/đổi đi) hoặc `CLOSED` (gia sư/Admin huỷ, giả định A6); `CLOSED → AVAILABLE` (gia sư "Mở lại", S-18); xoá slot là **xoá mềm** (`deleted_at`) vì booking cũ còn tham chiếu.

Xử lý sự kiện webhook (sau khi chữ ký hợp lệ, trong giao dịch có khoá booking):

| Booking hiện tại | Sự kiện | Kết quả |
|---|---|---|
| `PENDING_PAYMENT`, còn hạn | SUCCEEDED, amount khớp | booking `CONFIRMED`, payment `PAID`, slot `BOOKED`, outbox email "đặt thành công" (STU + TUT). |
| `PENDING_PAYMENT`, còn hạn | FAILED | booking `EXPIRED`, payment `FAILED`, slot `AVAILABLE`. |
| `PENDING_PAYMENT`, quá hạn / `EXPIRED` | SUCCEEDED | booking giữ/chuyển `EXPIRED`; payment `PAID` → gọi `provider.refund()` → `REFUNDED`; audit log `LATE_PAYMENT_AUTO_REFUND` (AC8). |
| `EXPIRED` | FAILED | Không làm gì (200). |
| `CONFIRMED` | bất kỳ (lặp) | Không làm gì (200) — idempotent (AC9). |
| bất kỳ | amount/providerRef không khớp | 400, không đổi trạng thái, ghi `payment_events.rejected_reason` (US-SYS-01 AC2). |

### 2.5 Huỷ / đổi lịch / hoàn tiền (CEO #2, §3.3)

`CancellationPolicy` và `ReschedulePolicy` là hàm thuần nhận `(booking, actor, nowUtc, config)` → `Allowed | Denied(code)`; unit test đầy đủ biên (đúng 24h, 24h − 1s, …).

- **Học viên huỷ:** `CONFIRMED` và `start_at − now ≥ CANCELLATION_WINDOW_HOURS` → `CANCELLED_BY_STUDENT`, slot `AVAILABLE`, refund 100%. `PENDING_PAYMENT` → `EXPIRED` (không có tiền để hoàn). `< 24h` → 409 `CANCELLATION_WINDOW_CLOSED`.
- **Học viên đổi lịch:** `CONFIRMED`, `≥ 24h`, `reschedule_count = 0`, slot mới `AVAILABLE` của cùng gia sư, cùng thời lượng, ở tương lai, không trùng lịch học viên. Một giao dịch: khoá booking, khoá slot cũ + slot mới theo thứ tự `id` tăng dần (tránh deadlock), đổi `slot_id/start_at/end_at`, slot cũ `AVAILABLE`, slot mới `BOOKED`, `reschedule_count = 1` (CHECK ≤ 1). Lỗi bất kỳ → rollback, booking giữ slot cũ (AC5).
- **Gia sư huỷ:** `CONFIRMED` và `now < start_at` → `CANCELLED_BY_TUTOR`, slot `CLOSED`, refund 100%, lý do bắt buộc.
- **Admin huỷ:** `CONFIRMED` và `now < start_at` → `CANCELLED_BY_ADMIN`, slot `CLOSED`, `refund: true|false` (mặc định true). **Admin hoàn thủ công:** payment `PAID` (booking đã huỷ, hoặc booking đã diễn ra theo đề xuất Q4) → `REFUNDED`; lần hai → 409 `ALREADY_REFUNDED`. Mọi thao tác Admin ghi `audit_logs`.
- Hoàn tiền: đổi trạng thái booking và ghi `payments.refund_requested_at` trong giao dịch; gọi `provider.refund()` (mock: đồng bộ, luôn thành công) với `idempotencyKey = payment.id`; thành công → `REFUNDED`. Nếu provider lỗi, payment vẫn `PAID` + cờ `refund_failed`, Admin thấy trong danh sách và bấm hoàn thủ công (US-ADM-04 AC2).

### 2.6 Email (F7, §3.6) — transactional outbox

Service nghiệp vụ `INSERT email_outbox` **trong cùng giao dịch** với thay đổi trạng thái. `MailOutboxWorker` (15s) lấy bản ghi `PENDING` bằng `SKIP LOCKED`, render template tiếng Việt (giờ đổi sang `Asia/Ho_Chi_Minh`, kèm nhãn "(GMT+7)"), gửi SMTP; lỗi → `attempts+1`, backoff 1/5/15 phút, tối đa 5 lần rồi `FAILED`. Booking không bao giờ rollback vì lỗi mail; không gửi mail cho `PENDING_PAYMENT` ban đầu.

### 2.7 Thời gian và múi giờ (F5, NFR-2)

- DB: mọi cột thời gian là `timestamptz`; kết nối DB đặt `TimeZone=UTC`; container API `TZ=UTC`.
- API: chỉ nhận/trả ISO-8601 có offset (`2026-12-01T02:00:00Z`); DTO từ chối chuỗi không có offset.
- Logic nghiệp vụ dùng `Clock.now()` (UTC, inject được để test 15 phút/24 giờ mà không phải chờ).
- FE: `lib/time.ts` là nơi duy nhất đổi giờ; nhập ngày giờ theo `Asia/Ho_Chi_Minh` → gửi UTC; hiển thị lại theo `Asia/Ho_Chi_Minh`. Bộ lọc "ngày có slot" gửi `availableDate=YYYY-MM-DD` + server quy đổi theo `DISPLAY_TIMEZONE` thành khoảng `[ngày 00:00+07, ngày+1 00:00+07)`.

### 2.8 AuthN / AuthZ cho 3 vai trò (F1, NFR-4)

**Xác thực**
- Đăng ký: email (lưu `citext`, unique) + mật khẩu ≥ 8 ký tự, băm **argon2id**. `role` chỉ nhận `STUDENT | TUTOR`; DTO whitelist nên gửi `ADMIN` → 400 (US-GEN-01 AC4). Admin chỉ có từ seed (A10).
- Đăng nhập: trả **JWT HS256 trong cookie** `tb_session` (`HttpOnly; SameSite=Lax; Secure` khi chạy HTTPS; `Path=/api`), hết hạn 8 giờ. Claim: `sub`, `role`, `tv` (token_version). Không lưu token ở localStorage.
- Mỗi request `JwtAuthGuard` (cố định `HS256`, chỉ đọc token từ cookie) đọc user từ DB (`status`, `role`, `token_version`, `must_change_password`); `role` dùng cho phân quyền lấy từ DB, không lấy từ claim. Khoá user hoặc đổi mật khẩu sẽ tăng `token_version`, mọi phiên cũ mất hiệu lực ngay (US-ADM-02 AC2). Chi phí là 1 query theo PK, chấp nhận được cho MVP.
- Admin seed có `must_change_password = true`: cho tới khi đổi mật khẩu, mọi endpoint trừ `/me`, `/me/password`, `/auth/logout` trả 403 `PASSWORD_CHANGE_REQUIRED`.
- Đăng xuất: xoá cookie **và** tăng `token_version`, tức là đăng xuất mọi thiết bị (Security C1).
- Lỗi đăng nhập trả chung "email hoặc mật khẩu không đúng"; user bị khoá trả 403 `ACCOUNT_LOCKED` **chỉ sau khi** mật khẩu đúng. Khi email không tồn tại vẫn chạy verify với hash giả để thời gian phản hồi như nhau. Rate limit (`@nestjs/throttler`, `trust proxy` 1 hop, nginx ghi đè `X-Forwarded-For`):
  - `/auth/login`: 5 lần/phút/IP+email và 10 lần/giờ/email.
  - `/auth/register`: 3 lần/phút/IP.
  - `POST /bookings`: 10 lần/phút/user.
  - `/me/password`: 5 lần/phút.
  - Webhook: 60 lần/phút/IP.
  - Toàn cục: 100 lần/phút/IP cho khách, 300 lần/phút cho user đã đăng nhập.
- CSRF: cookie `SameSite=Lax`, mọi request ghi bắt buộc `Content-Type: application/json` (riêng upload avatar dùng multipart), `Origin` phải khớp chính xác `APP_BASE_URL` (thiếu `Origin` thì dùng `Referer`; **thiếu cả hai thì từ chối**). Webhook thanh toán không dùng cookie nên nằm ngoài kiểm tra này. GET không đổi trạng thái nghiệp vụ (hết hạn lười chỉ chuẩn hoá trạng thái đã đến hạn).

**Phân quyền — 3 lớp**
1. **Theo route** (`RolesGuard` + decorator `@Roles`): `/api/v1/tutor/**` chỉ `TUTOR`; `/api/v1/bookings/**` (ghi) chỉ `STUDENT`; `/api/v1/admin/**` chỉ `ADMIN`; route công khai đánh dấu `@Public()` rõ ràng (mặc định là cần đăng nhập — deny by default).
2. **Theo trạng thái**: `TutorApprovedGuard` cho tạo/sửa slot (US-TUT-01, §3.4); gia sư chưa duyệt vẫn sửa được hồ sơ.
3. **Theo sở hữu (chống IDOR)** — ở tầng service/repository, không chỉ controller:
   - Truy vấn luôn kèm điều kiện chủ sở hữu: `findFirst({ where: { id, studentId: me } })` cho học viên; `{ id, tutorId: me }` cho gia sư. Không có → **404** `NOT_FOUND` (không lộ tồn tại).
   - Không có endpoint nào nhận `studentId`/`tutorId` từ client cho hành động của chính user; luôn lấy từ phiên.
   - ID là UUID v4 (không đoán được), nhưng **không** coi UUID là biện pháp phân quyền.
   - Endpoint công khai về gia sư chỉ trả gia sư `APPROVED`; slot công khai chỉ trả `AVAILABLE`, ở tương lai, không lộ thông tin học viên.
   - DTO response tách theo vai trò, mapper dạng allow-list (không `return entity`): `StudentBooking`, `TutorBooking` (chỉ tên học viên, giờ, giá, trạng thái; không có payment, hold, lý do huỷ của học viên, email), `AdminBookingDetail`; `PublicReview` không có `bookingId`. Có test snapshot.
   - Quyết định duyệt gia sư với user không phải TUTOR trả 404. `{action}` là enum. Không khoá được Admin.
   - Mỗi resource có test integration "user A truy cập tài nguyên của B → 404/403" (bắt buộc trong DoD P3).

**Ma trận quyền (rút gọn, chi tiết từng endpoint trong OpenAPI `x-roles`)**

| Endpoint nhóm | Khách | STUDENT | TUTOR | ADMIN |
|---|---|---|---|---|
| `GET /tutors`, `/tutors/{id}`, `/tutors/{id}/slots`, `/tutors/{id}/reviews`, `/subjects` | ✔ | ✔ | ✔ | ✔ |
| `/auth/*` | ✔ | ✔ | ✔ | ✔ |
| `/me` | — | ✔ | ✔ | ✔ |
| `POST /bookings`, `/bookings/{id}/cancel`, `/reschedule`, `/review`, `/checkout` | — | ✔ (của mình) | — | — |
| `GET /bookings`, `/bookings/{id}` | — | của mình | — | — |
| `/tutor/profile`, `/tutor/slots/**` | — | — | ✔ (slot: cần APPROVED) | — |
| `/tutor/bookings/**` | — | — | của mình | — |
| `/admin/**` | — | — | — | ✔ |
| `/mock-gateway/payments/{paymentId}`, `…/complete` | — | chủ booking | — | — |
| `POST /payments/webhooks/mock` | HMAC, không cookie | | | |

**Bảo vệ chung:** `helmet`, `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` (chặn mass-assignment như gửi `status`, `price`, `role`), `ParseUUIDPipe` cho mọi `:id`, `q` escape `%`/`_`, `sort` theo whitelist, giới hạn body 100 KB (webhook 4 KB, avatar 2 MB), CSP `default-src 'self'`, tắt CORS, template email escape HTML và bỏ CRLF, Prisma tham số hoá (không nối chuỗi SQL; raw SQL chỉ dùng tagged template), log không chứa mật khẩu/token/secret, lỗi trả dạng `{error:{code,message,details}}` không lộ stack.

### 2.9 Thanh toán: `PaymentProvider`, cổng giả lập, HMAC (F6, CEO #1)

```ts
export interface PaymentProvider {
  readonly name: 'mock' | 'vnpay';
  /** Tạo phiên thanh toán; không đổi trạng thái booking. */
  createPayment(input: {
    paymentId: string; bookingId: string; amountVnd: number;
    description: string; returnUrl: string; expiresAt: Date;
  }): Promise<{ providerRef: string; checkoutUrl: string }>;
  /** Xác thực callback/webhook. Ném InvalidSignatureError nếu sai. Không đụng DB. */
  verifyCallback(req: { headers: Record<string, string>; rawBody: Buffer; query: Record<string, string> }):
    Promise<VerifiedPaymentEvent>;
  /** Hoàn tiền; idempotent theo idempotencyKey. */
  refund(input: { paymentId: string; providerRef: string; amountVnd: number; reason: string; idempotencyKey: string }):
    Promise<{ refundRef: string; status: 'REFUNDED' }>;
}
export interface VerifiedPaymentEvent {
  eventId: string; providerRef: string; outcome: 'SUCCEEDED' | 'FAILED';
  amountVnd: number; occurredAt: Date;
}
```

`PaymentsService` (không phụ thuộc provider cụ thể) nhận `VerifiedPaymentEvent`, đối chiếu `providerRef` + `amountVnd` với bảng `payments`, rồi gọi máy trạng thái. Đổi sang VNPay chỉ cần thêm `VnpayProvider` và đặt `PAYMENT_PROVIDER=vnpay` (US-SYS-01 AC3).

**Webhook mock — định dạng ký**
- Header `X-Mock-Signature: t=<unix_seconds>,v1=<hex(HMAC_SHA256(PAYMENT_WEBHOOK_SECRET, t + "." + rawBody))>`.
- Body JSON: `{ "eventId": "evt_<uuid>", "providerRef": "...", "outcome": "SUCCEEDED|FAILED", "amountVnd": 300000, "occurredAt": "…Z" }`.
- Verify trên **raw body** (NestJS `rawBody: true`) **trước khi** parse JSON, so sánh bằng `crypto.timingSafeEqual` (kiểm độ dài trước). Thiếu header, sai chữ ký hoặc `|now − t| > 300s` trả **401** `INVALID_SIGNATURE`: chỉ ghi log cảnh báo, **không lưu payload** (Security B4). JSON sai schema trả 400.
- Thứ tự trong một giao dịch: `INSERT payment_events … ON CONFLICT (provider, event_id) DO NOTHING` (sự kiện trùng → 200 no-op) → khoá dòng booking → áp máy trạng thái. 20 request trùng gửi song song chỉ áp dụng 1 lần.
- Nginx trả 404 cho `/api/v1/payments/webhooks/mock` từ bên ngoài. Cổng giả lập gửi webhook tới `INTERNAL_WEBHOOK_BASE_URL` (không lấy từ `Host`). Demo webhook sai chữ ký/lặp chạy `scripts/webhook-demo.sh` trong mạng compose.
- Secret chỉ ở server (API ký và verify; trình duyệt **không bao giờ** thấy secret hay chữ ký). Trang cổng giả lập chỉ gọi `POST /api/v1/mock-gateway/payments/{paymentId}/complete`; API mới là bên ký và gửi webhook. Người dùng không tự tạo được webhook hợp lệ.
- Endpoint cổng giả lập: chỉ học viên chủ booking (kiểm sở hữu như §2.8, người khác → 404); chỉ một lần mỗi payment (`gateway_completed_at`); response có `Cache-Control: no-store` và `Referrer-Policy: no-referrer`; tắt được bằng `MOCK_GATEWAY_ENABLED=false` (khi đó trả 404). `providerRef` (dùng trong webhook) là token ngẫu nhiên 128 bit, không xuất hiện trên URL và bị che trong log.
- Thứ tự sự kiện: FAILED rồi SUCCEEDED muộn → xử lý như tiền đến muộn (tự hoàn); SUCCEEDED rồi FAILED → bỏ qua, ghi `rejected_reason`.
- Lưu ý demo: vì cổng giả lập nằm trong cùng hệ thống, "học viên tự bấm thành công" là hành vi mong muốn của mock, không phải lỗ hổng. Khi chuyển sang cổng thật, chỉ webhook đã verify mới đổi trạng thái.

---

## 3. ERD / schema DB (PostgreSQL 16)

### 3.1 ERD

```
users 1───0..1 tutor_profiles 1───* tutor_subjects *───1 subjects
  │                 │
  │ (student)       │ 1
  │                 * slots 1───* bookings (lịch sử; tối đa 1 booking hiệu lực/slot)
  * bookings *──────┘                 │ 1
  │                                   ├──1 payments 1───* payment_events
  │                                   ├──0..1 reviews
  │                                   └──* booking_history
users 1───* audit_logs (actor)        email_outbox (độc lập)
```

### 3.2 Bảng chính (cột rút gọn; kiểu Prisma tương ứng)

**Enum:** `user_role(STUDENT,TUTOR,ADMIN)`, `user_status(ACTIVE,LOCKED)`, `tutor_approval_status(PENDING_APPROVAL,APPROVED,REJECTED,SUSPENDED)`, `slot_status(AVAILABLE,HELD,BOOKED,CLOSED)`, `booking_status(PENDING_PAYMENT,CONFIRMED,EXPIRED,CANCELLED_BY_STUDENT,CANCELLED_BY_TUTOR,CANCELLED_BY_ADMIN)`, `payment_status(PENDING,PAID,FAILED,REFUNDED)`, `email_status(PENDING,SENT,FAILED)`.

| Bảng | Cột | Ràng buộc |
|---|---|---|
| `users` | `id uuid PK`, `email citext`, `password_hash text`, `full_name varchar(100)`, `role user_role`, `status user_status default ACTIVE`, `token_version int default 0`, `must_change_password bool default false`, `created_at`, `updated_at timestamptz` | `UNIQUE(email)` |
| `tutor_profiles` | `user_id uuid PK FK users`, `bio text`, `experience text`, `price_per_session_vnd int null` (gia sư mới đăng ký chưa có giá; hồ sơ phải có giá trước khi được duyệt / nhận đặt lịch), `avatar_url text null`, `approval_status`, `rejection_reason text null`, `reviewed_by uuid null FK users`, `reviewed_at`, `rating_avg numeric(3,2) default 0`, `rating_count int default 0`, `created_at`, `updated_at` | `CHECK(price_per_session_vnd > 0)`; index `(approval_status, price_per_session_vnd)` |
| `subjects` | `id serial PK`, `name varchar(80)`, `slug varchar(80)` | `UNIQUE(slug)` |
| `tutor_subjects` | `tutor_id`, `subject_id` | `PK(tutor_id, subject_id)` |
| `slots` | `id uuid PK`, `tutor_id FK`, `start_at timestamptz`, `end_at timestamptz`, `status slot_status`, `deleted_at timestamptz null`, `created_at`, `updated_at` | `CHECK(end_at > start_at)`; **exclusion: không chồng giờ với slot khác (khác `CLOSED`, chưa xoá) của cùng gia sư**; index `(tutor_id, start_at)`, `(status, start_at)` |
| `bookings` | `id uuid PK`, `code bigint GENERATED ALWAYS AS IDENTITY UNIQUE` (hiển thị `#BK-1024`), `student_id FK users`, `tutor_id FK users`, `slot_id FK slots`, `start_at`, `end_at` (sao từ slot), `price_vnd int`, `status booking_status`, `hold_expires_at timestamptz null`, `reschedule_count smallint default 0`, `cancelled_at`, `cancelled_by uuid null`, `cancel_reason text null`, `created_at`, `updated_at` | `CHECK(reschedule_count BETWEEN 0 AND 1)`; `CHECK(student_id <> tutor_id)`; **unique partial `(slot_id)` khi hiệu lực**; **exclusion: học viên không có 2 booking hiệu lực chồng giờ**; index `(student_id, start_at)`, `(tutor_id, start_at)`, `(status, hold_expires_at)` |
| `payments` | `id uuid PK`, `booking_id FK UNIQUE`, `provider varchar(20)`, `provider_ref varchar(64) UNIQUE`, `amount_vnd int`, `status payment_status`, `failure_reason varchar(30) null` (`DECLINED`/`HOLD_EXPIRED`/`CANCELLED_BY_STUDENT`), `gateway_completed_at null`, `paid_at`, `failed_at`, `refund_requested_at`, `refunded_at`, `refund_ref`, `refund_failed bool default false`, `refunded_by uuid null`, `created_at`, `updated_at` | `CHECK(amount_vnd > 0)` |
| `payment_events` | `id uuid PK`, `provider`, `event_id varchar(64)`, `payment_id uuid null`, `outcome`, `payload jsonb` (chỉ sự kiện đã verify), `rejected_reason text null` (vd. `AMOUNT_MISMATCH`, `OUT_OF_ORDER`), `received_at`, `processed_at` | `UNIQUE(provider, event_id)` |
| `reviews` | `id uuid PK`, `booking_id FK UNIQUE`, `student_id`, `tutor_id`, `rating smallint`, `comment varchar(1000) null`, `is_hidden bool default false`, `created_at` | `CHECK(rating BETWEEN 1 AND 5)` |
| `booking_history` | `id bigserial`, `booking_id`, `from_status`, `to_status`, `from_slot_id`, `to_slot_id`, `actor_id null`, `actor_type (USER/SYSTEM/PROVIDER)`, `note`, `created_at` | Lịch sử cho Admin (US-ADM-03). |
| `audit_logs` | `id bigserial`, `actor_id`, `action varchar(50)`, `entity_type`, `entity_id`, `reason text`, `metadata jsonb`, `created_at` | Admin duyệt/khoá/huỷ/hoàn; tự hoàn khi thanh toán muộn. |
| `email_outbox` | `id uuid`, `to_email`, `template varchar(50)`, `payload jsonb`, `status email_status`, `attempts int`, `next_attempt_at`, `last_error`, `created_at`, `sent_at` | index `(status, next_attempt_at)` |

`rating_avg/rating_count` cập nhật trong cùng giao dịch tạo/ẩn review (denormalized để lọc/sắp xếp nhanh).

### 3.3 Chống trùng lịch ở tầng DB (migration SQL viết tay)

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS citext;

-- (1) Slot của cùng gia sư không chồng giờ (nửa mở [start, end) → 9–10 và 10–11 không trùng)
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
```

- Ứng dụng vẫn khoá dòng (`FOR UPDATE`) và kiểm tra trước để trả lỗi rõ; constraint là **lưới an toàn cuối** khi có race. Lỗi `23P01` (exclusion) / `23505` (unique) được map sang **409** `SLOT_UNAVAILABLE` hoặc `SCHEDULE_CONFLICT`.
- Giao dịch dùng isolation `READ COMMITTED` mặc định + khoá dòng; không cần `SERIALIZABLE`.
- Test bắt buộc: 20 request song song đặt cùng slot → đúng 1 `201`, 19 `409`; học viên đặt 2 slot chồng giờ của 2 gia sư song song → đúng 1 thành công.

### 3.4 Trạng thái booking và payment
Như §2.4. Ánh xạ: `PENDING_PAYMENT`↔payment `PENDING`; `CONFIRMED`↔`PAID`; `EXPIRED`↔`FAILED` (hoặc `REFUNDED` nếu tiền đến muộn); `CANCELLED_*`↔`REFUNDED` (hoặc `PAID` nếu Admin chọn không hoàn / hoàn lỗi). Mọi chuyển trạng thái ghi `booking_history`.

---

## 4. Đặc tả API

Đầy đủ ở tài liệu [openapi](/QUA/issues/QUA-6#document-openapi) (OpenAPI 3.1, sẽ commit thành `docs/openapi.yaml`, là contract giữa BE và FE). Tóm tắt:

- Base path `/api/v1`; JSON **camelCase**; thời gian ISO-8601 UTC; tiền là số nguyên VND; phân trang `?page=1&pageSize=20` → `{ items, page, pageSize, total }`.
- Lỗi (đã thống nhất với P2a): HTTP 4xx/5xx + body `{ "error": { "code", "message", "details"? } }`. `code` là mã ổn định; FE ánh xạ `code` sang text trong `vi.json` và **không** hiện `message` của server. Ví dụ `STUDENT_OVERLAP` có `details.conflictingBooking {id, code, startAt, endAt, tutorName}` cho S-06.
- Mã lỗi: `VALIDATION_FAILED`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `RATE_LIMITED`, `INVALID_CREDENTIALS`, `ACCOUNT_LOCKED`, `EMAIL_TAKEN`, `WRONG_CURRENT_PASSWORD`, `TUTOR_NOT_ACCEPTING`, `SLOT_OVERLAP`, `SLOT_LOCKED`, `SLOT_UNAVAILABLE`, `SLOT_TOO_SOON`, `STUDENT_OVERLAP`, `BOOKING_NOT_PAYABLE`, `GATEWAY_ALREADY_COMPLETED`, `WINDOW_PASSED`, `RESCHEDULE_LIMIT`, `NOT_CONFIRMED`, `SESSION_STARTED`, `NOT_FINISHED`, `ALREADY_REVIEWED`, `INVALID_SIGNATURE`, `AMOUNT_MISMATCH`, `UNKNOWN_PAYMENT`, `ALREADY_REFUNDED`, `PAYMENT_NOT_REFUNDABLE`, `CANNOT_LOCK_ADMIN`, `INVALID_STATE`, `FILE_TOO_LARGE`, `UNSUPPORTED_FILE_TYPE`.
- Booking trả kèm cờ do server tính (UI không tự áp quy tắc, không dựa giờ trình duyệt): `holdExpiresAt`, `cancelDeadline` (= start − N giờ), `isFinished`, `actions.{cancel|reschedule|review}.{allowed, reasonCode}` với `reasonCode ∈ {WINDOW_PASSED, RESCHEDULE_LIMIT, NOT_CONFIRMED, SESSION_STARTED, NOT_FINISHED, ALREADY_REVIEWED}`, và `serverTime` ở response chi tiết để đếm ngược.

| Nhóm | Endpoint |
|---|---|
| Hệ thống | `GET /health`, `GET /config/public` (`cancellationWindowHours`, `holdMinutes`, `slotDurationMinutes`, `minBookingLeadMinutes`, `timezone`, `mockGatewayEnabled`) |
| Auth | `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /me`, `PATCH /me`, `POST /me/password` |
| Công khai | `GET /subjects`, `GET /tutors`, `GET /tutors/{tutorId}`, `GET /tutors/{tutorId}/slots` (status `AVAILABLE`/`UNAVAILABLE`, không lộ người đặt), `GET /tutors/{tutorId}/reviews`, `GET /slots/{slotId}` |
| Gia sư | `GET/PUT /tutor/profile`, `PUT /tutor/profile/avatar` (multipart), `POST /tutor/profile/submit`, `GET/POST /tutor/slots`, `PATCH/DELETE /tutor/slots/{slotId}`, `POST /tutor/slots/{slotId}/reopen`, `GET /tutor/bookings`, `GET /tutor/bookings/{bookingId}`, `POST /tutor/bookings/{bookingId}/cancel`, `GET /tutor/reviews` |
| Học viên | `POST /bookings`, `GET /bookings`, `GET /bookings/{bookingId}`, `POST /bookings/{bookingId}/checkout`, `POST /bookings/{bookingId}/cancel`, `POST /bookings/{bookingId}/reschedule`, `POST /bookings/{bookingId}/review` |
| Thanh toán | `GET /mock-gateway/payments/{paymentId}`, `POST /mock-gateway/payments/{paymentId}/complete` (chủ booking), `POST /payments/webhooks/mock` (HMAC) |
| Admin | `GET /admin/stats`, `GET /admin/users`, `PATCH /admin/users/{userId}/status`, `GET /admin/tutors`, `POST /admin/tutors/{tutorId}/{approve\|reject\|suspend\|reinstate}`, `GET /admin/bookings`, `GET /admin/bookings/{bookingId}`, `POST /admin/bookings/{bookingId}/cancel`, `POST /admin/payments/{paymentId}/refund`, `PATCH /admin/reviews/{reviewId}` (tuỳ chọn), `GET /admin/audit-logs` |

### 4.1 Đối chiếu với flow màn hình P2a (design v1.2)

| Màn hình | API dùng | Ghi chú |
|---|---|---|
| S-02 Danh sách/lọc | `GET /subjects`, `GET /tutors?subjectId&minPrice&maxPrice&minRating&availableDate&sort` | `availableDate` quy đổi theo timezone ở server; `nextAvailableAt` cho "Lịch trống gần nhất". `minRating`/`availableDate` cắt được. |
| S-03 Hồ sơ + slot | `GET /tutors/{id}`, `GET /tutors/{id}/slots?from&to` (≤ 31 ngày), `GET /tutors/{id}/reviews` | Client đổi tuần GMT+7 → UTC. |
| S-04/S-05 | `/auth/login`, `/auth/register` | `?next=` chỉ nhận đường dẫn tương đối (FE). |
| S-06 Xác nhận đặt | `GET /slots/{slotId}`, `POST /bookings` | Lỗi `SLOT_UNAVAILABLE`, `STUDENT_OVERLAP` (+`details.conflictingBooking`), `SLOT_TOO_SOON`, `TUTOR_NOT_ACCEPTING`. |
| S-07 Thanh toán | `GET /bookings/{id}` (`holdExpiresAt`, `serverTime`), `POST /bookings/{id}/checkout`, `POST /bookings/{id}/cancel` (→ `EXPIRED`) | |
| S-08 Cổng giả lập | `GET /mock-gateway/payments/{paymentId}`, `POST …/complete {result: SUCCESS\|FAILURE}` | Cho chọn "Thành công" cả khi đã hết hạn (demo tiền đến muộn). |
| S-09 Kết quả | `GET /bookings/{id}` poll 2s ≤ 30s | 3 biến thể suy từ `status` + `payment.status`. |
| S-10/S-11 Lịch của tôi | `GET /bookings?scope=upcoming\|past\|cancelled`, `GET /bookings/{id}` | `scope=past` = `CONFIRMED` + `isFinished` (cùng quy tắc với Admin S-27). Lịch sử thanh toán từ `payment.paidAt/refundedAt`. |
| S-12/S-13/S-14 | `POST /bookings/{id}/cancel`, `GET /tutors/{tutorId}/slots` + `POST /bookings/{id}/reschedule`, `POST /bookings/{id}/review` | Mốc 24h đổi lịch tính theo **giờ học cũ**. |
| S-15 Tài khoản | `GET/PATCH /me`, `POST /me/password` | |
| S-16/S-17 Gia sư hồ sơ | `GET/PUT /tutor/profile`, `PUT /tutor/profile/avatar`, `POST /tutor/profile/submit` | `me.tutorApprovalStatus` để gate menu. |
| S-18/S-19 Lịch trống | `GET/POST /tutor/slots`, `PATCH/DELETE /tutor/slots/{id}`, `POST /tutor/slots/{id}/reopen` | Trả cả `HELD`/`BOOKED`/`CLOSED`, kèm `booking {id, code, studentName}` khi `BOOKED`. |
| S-20/S-21/S-22 Buổi dạy | `GET /tutor/bookings?scope`, `GET /tutor/bookings/{id}`, `POST /tutor/bookings/{id}/cancel` | Không trả `PENDING_PAYMENT` (Q6). |
| S-23 Đánh giá nhận được | `GET /tutor/reviews` | Tên học viên rút gọn (vd. "Nguyễn A."). |
| S-24 Tổng quan Admin | `GET /admin/stats` | |
| S-25/S-26 | `GET /admin/tutors?approvalStatus&q`, `POST /admin/tutors/{id}/{action}`, `GET /admin/users`, `PATCH /admin/users/{id}/status` | Không khoá được tài khoản Admin (kể cả chính mình). |
| S-27/S-28 | `GET /admin/bookings`, `GET /admin/bookings/{id}`, `POST /admin/bookings/{id}/cancel`, `POST /admin/payments/{id}/refund` | Hoàn thủ công cho booking đã huỷ chưa hoàn **hoặc** `CONFIRMED` đã diễn ra (booking giữ `CONFIRMED`). |

Đã khớp với các cam kết API trong review [QUA-8](/QUA/issues/QUA-8). Tên trường snake_case trong review/design (`hold_expires_at`, `can_cancel`, `details.conflicting_booking`…) tương ứng 1–1 với camelCase ở đây (`holdExpiresAt`, `actions.cancel.allowed`, `details.conflictingBooking`). Đường dẫn chính thức là đường dẫn trong OpenAPI (vd. slot của gia sư là `/tutor/slots`, không phải `/me/slots`).

---

## 5. Góp ý sớm của Security Engineer

Nguồn: [security-review](/QUA/issues/QUA-9#document-security-review) trên [QUA-9](/QUA/issues/QUA-9). Bản review dựa trên rev 1, gồm 2 High, 14 Medium, 13 Low và không có Critical. Rev 3 xử lý như sau:

| # | Mức | Xử lý trong thiết kế (mục) |
|---|---|---|
| **B1** | **High** | **Đã sửa.** Cổng giả lập không còn là trang công khai theo `providerRef`. Cổng giờ là route SPA S-08 gọi `GET`/`POST /api/v1/mock-gateway/payments/{paymentId}[/complete]`. Các endpoint này **bắt buộc phiên học viên chủ booking** (cookie `Path=/api` được gửi kèm) và là request JSON, nên được bảo vệ CSRF bởi các quy tắc C3. Mỗi payment chỉ hoàn tất một lần. Response có `Cache-Control: no-store` và `Referrer-Policy: no-referrer`. `providerRef` không xuất hiện trong URL và bị che trong log. `MOCK_GATEWAY_ENABLED` mặc định `false` khi `NODE_ENV=production` và trả 404 khi tắt (§1.3, §2.9). Chọn ràng buộc theo phiên thay cho nonce (B2) vì chặt hơn và không cần thêm bảng. |
| **C6** | **High** | **Đã sửa.** Mật khẩu Admin seed lấy từ `SEED_ADMIN_PASSWORD`: bắt buộc, ≥ 12 ký tự, không có giá trị mặc định trong code hay README. Admin seed có cờ `must_change_password`, lần đăng nhập đầu bị buộc đổi mật khẩu (403 `PASSWORD_CHANGE_REQUIRED` với mọi endpoint trừ `/me`, `/me/password`, `/auth/logout`). Tài khoản demo không phải Admin chỉ được seed khi `SEED_DEMO_DATA=true` (bật cho demo local, phải tắt khi deploy public) (§1.2, §1.3, §2.8). |
| A1 | Medium | Tách DTO theo vai trò: `StudentBooking`, `TutorBooking` (không có payment, hold, lý do huỷ của học viên, email), `AdminBookingDetail`. Mapper dạng allow-list, có test snapshot (§2.8, OpenAPI). |
| A2, A5 | Low | `PublicReview` bỏ `bookingId` và `hidden`; query công khai lọc `is_hidden=false`. DTO công khai của gia sư không có email, `rejectionReason`, `reviewedBy`. |
| A3 | Medium | `{action}` là enum, giá trị khác trả 400. Gọi quyết định duyệt cho user không phải TUTOR trả 404. Không khoá được bất kỳ Admin nào. Mọi thao tác ghi của Admin vào `audit_logs`. |
| A4 | Medium | Slot đích (đặt hoặc đổi lịch) phải `AVAILABLE`, của gia sư `APPROVED`, khác slot cũ, và được khoá `FOR UPDATE` theo thứ tự id. Giá luôn lấy từ DB (§2.5). |
| A6, A7 | Low | `role`/`status` đọc từ DB mỗi request, claim chỉ để tham khảo. Dùng 403 cho sai vai trò, 404 cho tài nguyên không sở hữu. |
| B3 | Medium | **Giữ nguyên: webhook FAILED → booking `EXPIRED`, nhả slot ngay.** Đây là quyết định CEO #1 và US-STU-03 AC3. Rủi ro phá hoại mà Security nêu chỉ xảy ra khi người lạ kích hoạt được FAILED. B1 đã loại bỏ khả năng này vì chỉ chủ booking mới bấm được. Thứ tự sự kiện: FAILED rồi SUCCEEDED muộn → xử lý như tiền đến muộn và tự hoàn; SUCCEEDED rồi FAILED → bỏ qua và ghi `rejected_reason`. |
| B4 | Medium | Chỉ ghi `payment_events` **sau khi** chữ ký hợp lệ. Request sai chữ ký chỉ ghi log cảnh báo, không lưu payload. Webhook có rate limit 60/phút/IP và body ≤ 4 KB. Bỏ cột `signature_valid`. |
| B5 | Medium | API gửi webhook tới `INTERNAL_WEBHOOK_BASE_URL=http://api:3000` lấy từ config, không lấy từ `Host`. Nginx trả 404 cho `/api/v1/payments/webhooks/mock` từ bên ngoài. Demo webhook sai chữ ký hoặc lặp bằng `scripts/webhook-demo.sh`, chạy trong mạng compose qua `docker compose exec`. |
| B6, B7 | Low | Thứ tự xử lý webhook: verify → `INSERT … ON CONFLICT DO NOTHING` → khoá booking → áp trạng thái, tất cả trong một giao dịch. Hoàn tiền khoá dòng payment và chỉ chạy từ `PAID`. |
| B8 | Low | Chưa làm. Nếu cần xoay secret thì verify với danh sách `[current, previous]`. |
| C1 | Medium | Logout tăng `token_version`, tức là đăng xuất mọi thiết bị. Mức này đủ cho đồ án. |
| C2 | Medium | Đặt `trust proxy` = 1 hop. Nginx ghi đè `X-Forwarded-For $remote_addr`. Thêm trần đăng nhập 10 lần/giờ/email, độc lập với IP. Bộ đếm rate limit lưu in-memory, chấp nhận cho MVP. |
| C3 | Medium | Request ghi thiếu cả `Origin` lẫn `Referer` bị từ chối (trừ webhook). `Origin` phải khớp chính xác `APP_BASE_URL`. GET không đổi trạng thái nghiệp vụ; hết hạn lười chỉ chuẩn hoá trạng thái đã đến hạn và idempotent. |
| C4 | Low | Cố định `algorithms: ['HS256']`. `Secure` cookie bật theo `APP_BASE_URL` là https. Chỉ nhận token từ cookie. |
| C5 | Low | Khi email không tồn tại vẫn chạy `argon2.verify` với hash giả. `EMAIL_TAKEN` khi đăng ký là **rủi ro chấp nhận** vì design yêu cầu thông báo này; đã giới hạn 3 lần/phút/IP. |
| D1 | Medium | Throttler toàn cục: 100/phút/IP cho khách, 300/phút cho user đã đăng nhập. Siết riêng `POST /bookings` 10/phút/user và `/me/password` 5/phút. |
| D2 | Medium | Không còn trường `avatarUrl` do người dùng nhập. Ảnh chỉ upload nội bộ (JPG/PNG ≤ 2 MB, kiểm tra magic bytes, tên file ngẫu nhiên) và server không fetch URL ngoài. |
| D3 | Medium | Template email escape HTML, bỏ `\r\n` ở subject và tên. `to_email` luôn lấy từ DB. |
| D4 | Medium | `ParseUUIDPipe` cho mọi `:id`; `pageSize ≤ 100`; `q` ≤ 100 ký tự và escape `%`/`_`; `sort` theo whitelist. |
| D5 | Medium | Từ chối khởi động nếu secret thiếu, ngắn, là giá trị mẫu hoặc hai secret trùng nhau, ở **mọi môi trường trừ `test`**. Compose không có mật khẩu DB mặc định; cổng DB và SMTP chỉ bind `127.0.0.1`. Có `.dockerignore`. Chạy gitleaks trong CI. |
| D6–D8 | Low | helmet + CSP `default-src 'self'`, HSTS ở nginx khi dùng HTTPS, tắt CORS và `X-Powered-By`. Lỗi DB chỉ trả mã nghiệp vụ. Cố định phiên bản lockfile và image. Container chạy user không phải root. `npm audit` trong CI. |

**Checklist bảo mật cho DoD P3:** áp dụng nguyên 23 mục ở mục E của [security-review](/QUA/issues/QUA-9#document-security-review). Mục 15 đọc theo B1 đã sửa: phiên chủ booking + một lần + `no-referrer`/`no-store` + cờ tắt + nginx chặn webhook. Security Engineer sẽ rà lại nhanh rev 3 khi P3 bắt đầu (ghi trong T11).

---

## 6. Chia việc P3–P6 (sẽ tạo issue con **sau khi** CEO duyệt P2b; P3 không bắt đầu code trước khi P2b được duyệt và P2a đóng)

Mốc theo CEO #4: P3 xong **2026-12-17**; P4 + P5 xong **2026-12-31**; demo **2027-01-08**. Thứ tự cắt khi thiếu thời gian: VNPay sandbox → bộ lọc nâng cao → đổi lịch.

| # | Issue (owner) | Nội dung | Bị chặn bởi | Hạn |
|---|---|---|---|---|
| T1 | [DevOps] P3 Repo skeleton, compose, CI | Monorepo, Dockerfile api/web, `docker-compose.yml` (db, mailpit, api, web), `.env.example`, GitHub Actions (lint, test với Postgres service, build) | — | 11-24 |
| T2 | [Backend] P3 DB schema, migration, seed, auth + RBAC (F1) | Prisma schema + SQL constraint §3.3, seed demo, register/login/logout/me, guards, error format, Clock, config | T1 | 11-28 |
| T3 | [Backend] P3 Hồ sơ gia sư, môn, slot, tìm kiếm (F2, F3) | API gia sư + công khai, bộ lọc (môn, giá; ngày/điểm là phần cắt được) | T2 | 12-03 |
| T4 | [Backend] P3 Đặt lịch + thanh toán giả lập (F4, F5, F6) | Booking, `PaymentProvider`, mock gateway + webhook HMAC, expiry job, huỷ + hoàn (STU/TUT), **test tự động bắt buộc** (unit policy, integration concurrency, webhook ký sai/lặp/muộn) | T3 | 12-10 |
| T5 | [Backend] P3 Đổi lịch, đánh giá, email outbox, Admin API (F4, F7, F8, F9) | Reschedule, review, outbox + template vi, admin users/tutors/bookings/refund, audit log | T4 | 12-15 |
| T6 | [Frontend] P3 App shell, i18n vi, auth, tìm/xem gia sư (F1, F3) | Layout theo P2a, client sinh từ OpenAPI (dùng mock MSW tới khi BE xong), `lib/time.ts` | T1 | 12-03 |
| T7 | [Frontend] P3 Màn hình gia sư (F2, F4) | Hồ sơ, trạng thái duyệt, lịch trống, buổi dạy, huỷ buổi | T6, T3 | 12-10 |
| T8 | [Frontend] P3 Luồng học viên: đặt, thanh toán, lịch của tôi, huỷ/đổi, đánh giá (F4, F6, F8) | Trang kết quả thanh toán poll trạng thái thật | T6, T4 | 12-15 |
| T9 | [Frontend] P3 Màn hình Admin (F9) | Users, duyệt gia sư, booking, huỷ/hoàn | T6, T5 | 12-17 |
| T10 | [QA] P3 Test plan + E2E Playwright cho đặt lịch và thanh toán | Test case từ AC P1; E2E thành công/thất bại/hết hạn, đọc email qua API Mailpit; chạy trong CI | T1 (viết plan ngay), E2E hoàn tất sau T8 | 12-17 |
| T11 | [Tech Lead] P3 Code review + tích hợp, cổng P3 | Review mọi PR, kiểm tra DoD; nhờ Security rà nhanh phần auth/webhook trước khi đóng P3 | T2–T10 | 12-17 |
| T12 | [QA] P4 Kiểm thử hệ thống + regression | Chạy test plan trên build compose, báo lỗi, cổng: 0 lỗi Critical/High | T11 | 12-24 |
| T13 | [Security] P5 Review bảo mật | authN/authZ, IDOR, webhook, input, secret, OWASP Top 10; cổng: 0 finding High | T12 | 12-31 |
| T14 | [DevOps] P6 Đóng gói, runbook, backup, demo | Image cuối, README chạy 1 lệnh, runbook, script backup `pg_dump`, (tuỳ chọn) deploy free tier; CEO nghiệm thu | T13 | 01-08 |

**Definition of Done P3 (áp cho mọi PR):**
- Test pass trong CI.
- Endpoint mới có test phân quyền: khác vai trò → 401/403, không sở hữu → 404.
- Khớp `docs/openapi.yaml`.
- Text giao diện chỉ nằm trong `vi.json`.
- Không có secret trong code (gitleaks).
- Đạt các mục liên quan trong checklist bảo mật 23 mục (mục 5).
- Tech Lead approve.

---

## 7. Rủi ro kỹ thuật và cách giảm

| Rủi ro | Giảm thiểu |
|---|---|
| Prisma không mô tả được exclusion constraint | Viết SQL tay trong migration; test integration bắt buộc kiểm constraint tồn tại và hoạt động. |
| Race webhook ↔ job hết hạn | Khoá dòng booking ở cả hai phía; bảng xử lý §2.4; test đồng thời. |
| Lệch múi giờ | DB/API/Container đều UTC; chỉ `lib/time.ts` ở FE đổi giờ; test biên 24h với Clock giả. |
| Email lỗi làm hỏng booking | Outbox sau commit, retry có giới hạn. |
| Chậm tiến độ | Thứ tự cắt CEO #4; FE dùng MSW theo OpenAPI để không chờ BE. |

