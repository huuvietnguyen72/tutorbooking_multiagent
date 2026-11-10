# Runbook vận hành

Áp dụng cho bản chạy bằng Docker Compose (`db`, `mailpit`, `api`, `web`). Mọi lệnh chạy ở thư mục gốc repo.

## 1. Khởi động / dừng

```bash
./scripts/init-env.sh              # lần đầu: tạo .env với secret ngẫu nhiên
docker compose up -d --build       # build và chạy nền
docker compose ps                  # tất cả phải healthy/running
curl -fsS http://localhost:8080/api/v1/health   # {"status":"ok"}
docker compose down                # dừng, giữ dữ liệu
docker compose down -v             # dừng VÀ XOÁ pgdata + uploads
```

Khi `api` khởi động: `prisma migrate deploy` → seed (idempotent) → `node dist/main`. Job hết hạn giữ chỗ và worker gửi mail chạy trong tiến trình `api`.

## 2. Cấu hình

Toàn bộ trong `.env` (mode 600, không commit). Biến bắt buộc: `POSTGRES_PASSWORD`, `JWT_SECRET`, `PAYMENT_WEBHOOK_SECRET`, `SEED_ADMIN_PASSWORD`. Danh sách đầy đủ: `docs/architecture.md` mục 1.3. API từ chối khởi động nếu secret thiếu/ngắn/trùng — xem `docker compose logs api`.

Đổi `.env` xong: `docker compose up -d` (recreate service bị ảnh hưởng). Xoay secret: `JWT_SECRET` mới làm mọi phiên đăng nhập hết hiệu lực; `POSTGRES_PASSWORD` chỉ áp dụng khi tạo volume mới, với DB đang chạy phải `ALTER USER` thủ công.

## 3. Backup và restore

```bash
./scripts/backup.sh [thư_mục]     # mặc định ./backups; giữ 14 bản (BACKUP_KEEP)
```

Mỗi lần tạo `db-<UTC>.dump` (pg_dump `-Fc`, đã kiểm `pg_restore --list`) và `uploads-<UTC>.tar.gz` (ảnh đại diện). Lịch gợi ý (cron máy chủ, mỗi đêm 02:00):

```cron
0 2 * * * cd /đường/dẫn/repo && ./scripts/backup.sh /var/backups/tutor >> /var/log/tutor-backup.log 2>&1
```

Sao chép thư mục backup sang nơi khác máy (file chứa dữ liệu cá nhân, giữ quyền 600).

Restore (GHI ĐÈ DB hiện tại):

```bash
./scripts/restore.sh backups/db-<stamp>.dump
```

Script dừng `web`/`api`, `pg_restore --clean --if-exists`, khôi phục uploads cùng dấu thời gian nếu có, rồi bật lại. **Diễn tập restore** trước ngày demo: backup → `docker compose down -v` → `up -d` → restore → đăng nhập kiểm tra dữ liệu.

## 4. Sự cố thường gặp

| Triệu chứng | Kiểm tra / xử lý |
|---|---|
| `api` restart liên tục | `docker compose logs api`: thường là lỗi validate env (secret thiếu/ngắn) hoặc migration lỗi. |
| `POSTGRES_PASSWORD is required` | Chưa có `.env`: chạy `./scripts/init-env.sh`. |
| Đổi `POSTGRES_PASSWORD` rồi `api` báo auth failed | Volume `pgdata` giữ mật khẩu cũ. Hoặc đặt lại mật khẩu trong DB, hoặc `down -v` (mất dữ liệu). |
| Cổng 8080/5432/8025 bị chiếm | Dừng tiến trình đang dùng cổng, hoặc đổi mapping `ports` trong `docker-compose.yml`. |
| Không nhận email | Email demo chỉ vào Mailpit (http://localhost:8025). Worker gửi mail chạy trong `api`; xem log `api`. |
| Booking kẹt `PENDING_PAYMENT` quá 15 phút | Job hết hạn chạy mỗi `EXPIRY_JOB_INTERVAL_SECONDS` (30s). Xem log `api`; restart `api` nếu job dừng. |
| Webhook thanh toán 404 qua cổng 8080 | Đúng thiết kế: webhook chỉ gọi nội bộ `api:3000`. Dùng `./scripts/webhook-demo.sh`. |

## 5. Nâng cấp

```bash
git pull
./scripts/backup.sh               # luôn backup trước
docker compose up -d --build      # migration chạy tự động khi api khởi động
```

Rollback: checkout phiên bản cũ, `up -d --build`; nếu migration đã đổi schema thì `restore.sh` bản backup trước nâng cấp.

## 6. Deploy public (tuỳ chọn)

Chỉ dùng free tier; **mọi chi phí phải hỏi board qua CEO trước**. Bắt buộc khi public: `SEED_DEMO_DATA=false`, `MOCK_GATEWAY_ENABLED=false` (hoặc chấp nhận rõ ràng là demo), secret mới sinh bằng `init-env.sh`, HTTPS ở lớp ngoài (reverse proxy/nền tảng), không mở cổng 5432/1025/8025. Chưa triển khai public tại thời điểm viết tài liệu này.
