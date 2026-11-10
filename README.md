# Tutor Booking Management

MVP Web Tutor Booking Management (đồ án). Monorepo TypeScript gồm API NestJS và
SPA React + Vite, chạy toàn bộ bằng Docker Compose.

Tài liệu nguồn:

- [`docs/architecture.md`](docs/architecture.md) — kiến trúc, stack, schema DB, chia việc P3–P6 (rev 3).
- [`docs/openapi.yaml`](docs/openapi.yaml) — đặc tả OpenAPI 3.1, là nguồn chuẩn của hợp đồng API.

## Yêu cầu

- Docker Engine 24+ và Docker Compose v2.
- (Tuỳ chọn, để phát triển ngoài Docker) Node.js 20, npm 10.

## Chạy nhanh bằng Docker Compose

```bash
# 1. Tạo .env với secret ngẫu nhiên (không có mật khẩu mặc định trong repo)
./scripts/init-env.sh

# 2. Build và chạy 4 service
docker compose up --build
```

Nếu `.env` đã tồn tại, `init-env.sh` từ chối ghi đè; dùng `./scripts/init-env.sh --force`
khi muốn tạo lại toàn bộ secret.

| Service | Địa chỉ | Ghi chú |
|---|---|---|
| `web` | http://localhost:8080 | nginx phục vụ SPA và reverse proxy `/api/*` |
| `api` | nội bộ `api:3000` | chỉ truy cập qua `web`; health check tại `/api/v1/health` |
| `db` | `127.0.0.1:5432` | PostgreSQL 16, volume `pgdata` |
| `mailpit` | SMTP `127.0.0.1:1025`, UI http://localhost:8025 | xem email demo |

Kiểm tra nhanh:

```bash
curl -fsS http://localhost:8080/api/v1/health
# {"status":"ok"}
curl -fsS http://localhost:8080/ >/dev/null   # SPA
```

Dừng và xoá dữ liệu:

```bash
docker compose down            # giữ volume
docker compose down -v         # xoá cả pgdata và uploads
```

Chạy bộ biến thể dùng DB test:

```bash
docker compose -f docker-compose.yml -f docker-compose.test.yml up --build
```

## Vận hành, backup, demo

- [`docs/runbook.md`](docs/runbook.md) — khởi động, cấu hình, sự cố thường gặp, nâng cấp.
- `./scripts/backup.sh` / `./scripts/restore.sh` — `pg_dump` (+ ảnh đại diện) và khôi phục.
- [`docs/demo.md`](docs/demo.md) — kịch bản demo và tài khoản seed.

## Phát triển ngoài Docker

```bash
npm install
./scripts/init-env.sh

npm run dev:api   # NestJS, http://localhost:3000/api/v1
npm run dev:web   # Vite, http://localhost:5173 (proxy /api sang cổng 3000)
npm run dev:mock --workspace @tutor/web   # Vite + MSW theo docs/openapi.yaml, không cần API (hocvien@/giasu@/admin@example.test, mật khẩu mock-pass-1234)
npm run gen:api --workspace @tutor/web    # sinh lại apps/web/src/api/schema.d.ts từ docs/openapi.yaml
```

Các lệnh ở thư mục gốc:

| Lệnh | Việc |
|---|---|
| `npm run lint` | ESLint toàn repo |
| `npm test` | Jest unit + e2e của API |
| `npm run build` | build API (tsc) và web (tsc + Vite) |

## CI

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) chạy trên mọi pull request và push lên `main`:

- lint;
- test với PostgreSQL 16 service;
- build API + web;
- kiểm tra `docker compose config`;
- quét secret bằng gitleaks;
- `npm audit --audit-level=high`.

## Bảo mật

- `.env` chứa secret thật và không được commit; `.env.example` chỉ có giá trị rỗng kèm hướng dẫn.
- API validate biến môi trường khi khởi động và từ chối secret thiếu, ngắn, trùng nhau hoặc là placeholder.
- Cổng DB (5432) và SMTP (1025), Mailpit UI (8025) chỉ bind `127.0.0.1`.
- nginx chặn `/api/v1/payments/webhooks/mock` từ bên ngoài và luôn ghi đè `X-Forwarded-For` bằng địa chỉ client thực.
- Container API chạy bằng user `node`, web dùng image nginx unprivileged.

## Cấu trúc

```
apps/api        NestJS API (health endpoint, config validation)
apps/web        React + Vite SPA, text tiếng Việt trong src/i18n/vi.json
docs            architecture.md, openapi.yaml, runbook.md, demo.md
scripts         init-env.sh, webhook-demo.sh, backup.sh, restore.sh
```
