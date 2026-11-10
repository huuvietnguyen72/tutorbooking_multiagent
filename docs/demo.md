# Kịch bản demo (≈10 phút)

Chuẩn bị: `./scripts/init-env.sh && docker compose up -d --build`; chờ `docker compose ps` healthy. Mở 2 tab: app http://localhost:8080 và email http://localhost:8025.

Tài khoản (`SEED_DEMO_DATA=true`): mật khẩu mọi tài khoản = `SEED_ADMIN_PASSWORD` trong `.env` (`grep SEED_ADMIN_PASSWORD .env`).

| Vai trò | Email |
|---|---|
| Admin | `admin@tutor.local` (đổi mật khẩu ở lần đăng nhập đầu) |
| Học viên | `hoc-vien@demo.local` |
| Gia sư | `gia-su-toan@demo.local`, `gia-su-anh@demo.local` |

Luồng:
1. **Học viên** tìm gia sư theo môn → xem hồ sơ/slot → đặt slot (PENDING_PAYMENT, giữ chỗ 15 phút).
2. Thanh toán qua **cổng giả lập** → booking CONFIRMED; kiểm tra email xác nhận ở Mailpit.
3. **Gia sư** đăng nhập → thấy booking, quản lý slot.
4. **Học viên** đổi lịch/huỷ (quy tắc 24 giờ), sau buổi học để lại đánh giá.
5. **Admin** duyệt gia sư mới, xem tổng quan, tra cứu booking/payment.
6. Bảo mật: `./scripts/webhook-demo.sh` (webhook 404 ngoài, 401 khi không ký).
7. Vận hành: `./scripts/backup.sh` rồi nêu `docs/runbook.md`.

Dự phòng: nếu hết slot demo, đăng nhập gia sư tạo thêm slot ở tương lai (≥ 60 phút kể từ giờ).
