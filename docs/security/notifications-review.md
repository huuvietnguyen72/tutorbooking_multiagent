# Rà soát bảo mật module thông báo (QUA-37)

**Đối tượng:** code `apps/api/src/notifications/*`, migration `20261116000000_notifications`, và các điểm gọi trong `booking-state-machine.ts`, `reviews.service.ts` — đọc từ nhánh `feat/QUA-32-notifications` (working tree, **chưa có PR** tại thời điểm rà soát). Cần đối chiếu lại khi PR mở.

**Kết luận:** không có lỗ hổng mức cao/trung bình. 4 khuyến nghị nhỏ.

## 1. Phân quyền — Đạt
- Mọi route mặc định yêu cầu đăng nhập (`JwtAuthGuard`, deny-by-default); controller thêm `@Roles('STUDENT','TUTOR')`; role đọc từ DB mỗi request.
- Mọi truy vấn đều ràng buộc `userId` lấy từ phiên (`@CurrentUser`), không nhận `userId` từ client. `markRead` dùng `findFirst({id, userId})` và `updateManyAndReturn({id, userId, readAt:null})` → id của người khác trả 404 giống id không tồn tại (không lộ sự tồn tại, không có IDOR). `read-all` chỉ cập nhật `userId` của chính mình.
- `:id` được kiểm `uuidParam`. POST đi qua OriginGuard (CSRF).
- Đánh dấu đã đọc idempotent, giữ `readAt` đầu tiên.

## 2. Dữ liệu nhạy cảm trong nội dung — Đạt, có lưu ý
- Lý do huỷ **không** được đưa vào thông báo (có comment rõ trong code). Chỉ gồm mã booking, tên đối phương, giờ; `link` là đường dẫn nội bộ do server sinh (`/bookings/<id>`), không có input người dùng tự do → không có open-redirect/XSS từ link; title/body là template cố định.
- Cột có giới hạn độ dài (title 120, body 300, link 200).
- Thông báo ghi trong cùng transaction với thay đổi trạng thái → không có thông báo "ma".
- **[Thấp] N1:** `reviewNotification` dùng `fullName` đầy đủ của học viên, trong khi review công khai dùng `abbreviateName`. Gia sư vốn đã thấy tên học viên qua booking nên rủi ro thấp; nên dùng `abbreviateName` cho nhất quán (nếu review ẩn danh với gia sư thì bắt buộc).
- **[Thấp] N2:** `fullName` do người dùng tự đặt được chèn vào `body`; client phải render dạng text (React mặc định escape), không dùng `dangerouslySetInnerHTML`/markdown. Template email (`mail`) cần escape riêng nếu tái sử dụng body.

## 3. Phân trang / chống lạm dụng — Đạt, có lưu ý
- `pageSize` 1–100 (mặc định 20), `page` 1–100000 đều validate bằng zod; sắp xếp ổn định `createdAt desc, id asc`; có index `(userId, createdAt)` và `(userId, readAt)`.
- Có throttler toàn cục (`AppThrottlerGuard`) áp cho các route này.
- **[Thấp] N3:** `list` chạy 3 truy vấn (findMany + 2 count) mỗi lần; `skip` tối đa ~10 triệu bản ghi với page=100000 → offset lớn tốn kém dù đã scoped theo user. Khuyến nghị hạ `page` tối đa (vd. 1000) hoặc chuyển sang cursor.
- **[Thấp] N4:** Chưa có chính sách lưu giữ/dọn thông báo cũ → bảng tăng vô hạn; nên có job xoá thông báo đã đọc > 90 ngày. FK `ON DELETE RESTRICT` cần tính tới khi xoá/ẩn danh user.

## 4. Test
Chưa thấy test cho module (trong working tree). Đề nghị bổ sung: user A không đọc/đánh dấu được thông báo của B (404), `read-all` không ảnh hưởng user khác, `pageSize=101` bị 400, thông báo huỷ không chứa lý do.
