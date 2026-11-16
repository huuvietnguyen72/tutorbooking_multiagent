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

## 7. Kiểm tra lỗ hổng phụ thuộc (security-audit)

Workflow `.github/workflows/security-audit.yml` chạy khi có PR và hàng tuần (thứ Hai 02:00 UTC); có thể chạy tay qua *Actions → Security audit → Run workflow*. Dependabot (`.github/dependabot.yml`) mở PR cập nhật npm và GitHub Actions hàng tuần, gom bản minor/patch vào một PR mỗi nhóm.

**Đọc kết quả**
- Job `Dependency audit`: xem log bước `npm audit`; mỗi mục ghi gói, mức độ, đường dẫn phụ thuộc và `fix available`. Job fail khi có lỗ hổng mức `high` trở lên. Chạy lại cục bộ: `npm audit --audit-level=high`.
- Job `Secret scan (gitleaks)`: log nêu rule, file, commit và dòng bị phát hiện.

**Xử lý khi fail**
1. Lỗ hổng phụ thuộc: thử `npm audit fix` (không dùng `--force` khi chưa review), chạy lại lint/test rồi commit lockfile. Nếu cần bản major, merge PR Dependabot tương ứng sau khi test. Nếu là phụ thuộc gián tiếp chưa có bản vá, dùng `overrides` trong `package.json` hoặc thay gói; nếu lỗ hổng không khai thác được trong dự án, ghi lý do vào PR và hỏi board/CEO trước khi bỏ qua.
2. Secret bị lộ: coi là đã lộ — **thu hồi/xoay secret ngay** ở nơi phát hành, rồi gỡ khỏi code. Chỉ thêm vào allowlist `.gitleaks.toml` nếu chắc chắn là giá trị giả (placeholder/CI).
3. Lỗi tạm thời (mạng, registry): chạy lại job trước khi kết luận.
