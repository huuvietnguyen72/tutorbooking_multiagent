# Đặc tả — Báo cáo thu nhập cho gia sư (QUA-36)

Trạng thái: **Bản nháp để Tech Lead review** · Tác giả: BA · Phạm vi: chỉ đặc tả, không có code.

## 1. Mục tiêu

Gia sư (`TUTOR`) tự xem thu nhập theo tháng: số buổi đã dạy, tổng tiền học viên đã trả, phí nền tảng, tiền thực nhận, và buổi nào đã/chưa đối soát. Màn hình chỉ đọc. Nó không chuyển tiền thật và không đổi trạng thái booking hay payment.

Ngoài phạm vi (xem §7): rút tiền thật, xuất hoá đơn/thuế, báo cáo cho Admin, biểu đồ nâng cao.

## 2. Hiện trạng trong code (để không làm trùng)

| Có sẵn | Không có |
|---|---|
| `Booking.priceVnd` là giá chốt lúc đặt; `startAt`, `endAt`, `status`. | Không có khái niệm phí nền tảng hay hoa hồng, ở cả schema lẫn cấu hình. |
| `Payment.amountVnd`, `status` (`PENDING/PAID/FAILED/REFUNDED`), `paidAt`, `refundedAt`. | Không có đối soát hay chi trả cho gia sư (không có bảng settlement/payout). |
| `isFinished(booking, now)` = `CONFIRMED` và `endAt <= now` (`booking.policy.ts`). Booking không có trạng thái `COMPLETED`. | Gia sư chưa có endpoint tổng hợp thu nhập. |
| `GET /tutor/bookings?scope` và `/tutor/bookings/{id}` có sẵn. Theo kiến trúc §2.8 DTO gia sư **không** trả payment. | Không có `TutorEarnings*` DTO. |
| Múi giờ hiển thị `Asia/Ho_Chi_Minh` (GMT+7). | |

Hệ quả: **phí nền tảng và đối soát là khái niệm mới** cần quyết định (câu hỏi mở Q1, Q2). Bản đặc tả này đề xuất một mặc định đơn giản để làm được ngay, với giả định rõ ràng ở §4.

## 3. User stories và tiêu chí chấp nhận

### US-TUT-EARN-01 — Xem tổng quan thu nhập theo tháng
Là gia sư, tôi muốn chọn một tháng và xem tổng quan thu nhập để biết mình kiếm được bao nhiêu.

- AC1: Mặc định hiện tháng hiện tại (GMT+7). Có thể chọn tháng khác, tối đa 24 tháng gần nhất và không chọn được tháng tương lai.
- AC2: Hiển thị 5 chỉ số: **số buổi đã dạy**, **tổng tiền thu** (gross), **phí nền tảng**, **thực nhận** (net = gross − phí), và **đã đối soát / chưa đối soát** (số tiền net của mỗi nhóm).
- AC3: Thứ tự: net đã đối soát + net chưa đối soát = net tổng (kiểm tra bằng test).
- AC4: Tháng không có buổi nào: hiện trạng thái rỗng "Chưa có buổi dạy nào trong tháng này", mọi số bằng 0, không lỗi.
- AC5: Tiền hiển thị dạng `1.234.000 ₫`; API trả số nguyên VND, không dùng số thực.

### US-TUT-EARN-02 — Xem chi tiết từng buổi tính vào thu nhập
Là gia sư, tôi muốn xem danh sách từng buổi trong tháng để đối chiếu với tổng.

- AC1: Mỗi dòng gồm: mã booking, tên học viên (đúng quy tắc DTO gia sư hiện có, không lộ email), giờ học (GMT+7), giá buổi, phí nền tảng, thực nhận, trạng thái đối soát.
- AC2: Tổng các dòng khớp chính xác các chỉ số ở US-TUT-EARN-01 của cùng tháng.
- AC3: Phân trang (mặc định 20/trang, tối đa 100) và sắp xếp theo `startAt` giảm dần. `sort` chỉ nhận giá trị whitelist, sai → 400.
- AC4: Có bộ lọc theo trạng thái đối soát (`all | settled | unsettled`).
- AC5: Mỗi buổi chỉ xuất hiện trong tháng của `endAt` (§4.1).

### US-TUT-EARN-03 — Buổi bị hoàn tiền không tính vào thu nhập
Là gia sư, tôi muốn biết buổi nào bị hoàn tiền để hiểu vì sao thu nhập bị trừ.

- AC1: Buổi có payment `REFUNDED` hoặc booking `CANCELLED_*` **không** tính vào số buổi, gross, phí, net.
- AC2: Các buổi đó hiện ở mục riêng "Buổi bị huỷ/hoàn tiền" (chỉ mã, giờ, giá, lý do hiển thị cho gia sư), không cộng vào tổng.
- AC3: Booking đã diễn ra rồi Admin hoàn thủ công (kiến trúc §2.5, đề xuất Q4 của tài liệu đó): nằm trong mục này; nếu hoàn **sau** khi tháng đã đối soát thì xử lý theo Q3.

### US-TUT-EARN-04 — Phân quyền và riêng tư
- AC1: Chỉ `TUTOR` gọi được. `STUDENT` → 403, chưa đăng nhập → 401.
- AC2: Truy vấn luôn kèm `tutorId` lấy từ phiên. Endpoint không nhận `tutorId` từ client; gửi thừa tham số → 400 (cùng chuẩn `additionalProperties:false`).
- AC3: Gia sư chưa được duyệt (`approvalStatus != APPROVED`) vẫn xem được (kết quả thường rỗng), không chặn bằng `TutorApprovedGuard`.
- AC4: DTO là allow-list; không có thông tin thẻ/provider (`providerRef`, `refundRef`), email học viên.

## 4. Quy tắc tính tiền (dựa trên Booking / Payment hiện có)

### 4.1 Buổi nào được tính "đã dạy"
Một booking được tính vào thu nhập của gia sư khi **đồng thời**:
1. `booking.tutorId = gia sư đang xem`.
2. `booking.status = CONFIRMED` và `endAt <= now` (đúng `isFinished`, không tạo định nghĩa mới).
3. `payment.status = PAID` (không `PENDING/FAILED/REFUNDED`).

Buổi thuộc **tháng của `endAt`** theo `Asia/Ho_Chi_Minh` (giờ cuối tháng vẫn thuộc tháng đó). Booking đã đổi lịch dùng `startAt/endAt` hiện tại; không đếm hai lần vì mỗi booking chỉ một bản ghi.

Không tính: `PENDING_PAYMENT`, `EXPIRED`, `CANCELLED_BY_STUDENT/TUTOR/ADMIN`, và mọi booking có payment `REFUNDED`.

### 4.2 Công thức
Với mỗi buổi hợp lệ:
- `gross = payment.amountVnd` (bằng `booking.priceVnd` vì được kiểm khớp khi nhận webhook).
- `platformFee = round_half_up(gross × FEE_RATE)`, số nguyên VND. `FEE_RATE` là **cấu hình** (đề xuất mặc định 10%, chờ Q1), không phải hằng số trong code.
- `net = gross − platformFee`.

Tổng tháng = tổng từng buổi (cộng số nguyên đã làm tròn theo từng buổi, **không** làm tròn trên tổng) để chi tiết luôn khớp tổng.

Ví dụ: 3 buổi 200.000, 150.000, 333.333 ₫ với 10%: phí 20.000 + 15.000 + 33.333 = 68.333; gross 683.333; net 615.000.

### 4.3 Chốt giá và đổi cấu hình phí
Tỉ lệ phí được **chốt tại thời điểm booking `CONFIRMED`** (lưu vào bản ghi, xem §6), nên đổi `FEE_RATE` sau đó không làm đổi thu nhập quá khứ. Booking cũ chưa có giá trị này được lấp bằng tỉ lệ mặc định khi migrate (Q1).

### 4.4 Đối soát
Giả định (chờ Q2): đối soát là hành động của Admin/hệ thống đánh dấu một buổi đã được chi trả cho gia sư. Trạng thái của mỗi buổi:
- `unsettled`: mặc định cho buổi hợp lệ.
- `settled`: đã đánh dấu, có `settledAt`.

Quy tắc: đối soát chỉ áp cho buổi hợp lệ (§4.1); không đảo ngược từ giao diện gia sư; đã `settled` mà sau đó payment bị hoàn → xử lý theo Q3. Việc đánh dấu `settled` không thuộc màn hình gia sư (màn này chỉ đọc) và là một task riêng (§8).

## 5. Màn hình

Đánh số tiếp theo kiến trúc (S-23 là "Đánh giá nhận được"):

- **S-29 Thu nhập** (menu gia sư, cạnh "Buổi dạy"): bộ chọn tháng, thẻ 5 chỉ số (AC US-01), nhóm đã/chưa đối soát, trạng thái rỗng, trạng thái lỗi có nút thử lại, skeleton khi tải.
- **S-30 Chi tiết thu nhập tháng** (tab/phần dưới S-29): bảng buổi dạy (US-02), lọc đối soát, phân trang; mục thu gọn "Buổi bị huỷ/hoàn tiền" (US-03).
- Dòng giải thích dưới số liệu: "Phí nền tảng là X% giá buổi" lấy từ API, không hard-code; chú thích rằng buổi tính vào tháng kết thúc buổi học.
- Tất cả chữ tiếng Việt, giờ GMT+7. Truy cập được bằng bàn phím, dùng nhãn cho số liệu (không chỉ màu để phân biệt đã/chưa đối soát).

## 6. Gợi ý về dữ liệu và API (để Tech Lead cân nhắc, không bắt buộc)

- API đọc: `GET /tutor/earnings?month=YYYY-MM` (tổng quan) và `GET /tutor/earnings/items?month=&settlement=&page=&pageSize=&sort=`. Theo mẫu `tutor/*` hiện có.
- Cần lưu: tỉ lệ/phí chốt theo booking (`platformFeeVnd` hoặc `feeRate`), và trạng thái đối soát (`settledAt`, người đánh dấu). Có thể là cột mới trên `Payment` hoặc bảng settlement riêng (Q2).
- Truy vấn dùng index `bookings(tutorId, startAt)` hiện có; cần kiểm tra thêm khi lọc theo `endAt`.

## 7. Câu hỏi còn mở

| # | Câu hỏi | Đề xuất của BA | Ai quyết |
|---|---|---|---|
| Q1 | Tỉ lệ phí nền tảng là bao nhiêu, cố định hay theo gia sư? Booking cũ tính thế nào? | 10% cố định toàn hệ thống, cấu hình qua biến môi trường; booking cũ dùng cùng tỉ lệ. | CEO |
| Q2 | "Đối soát" nghĩa là gì ở MVP: Admin đánh dấu thủ công, hay tự động theo chu kỳ (vd. sau N ngày kể từ buổi học)? Ai thực hiện? | Admin đánh dấu theo tháng; màn gia sư chỉ đọc. | CEO |
| Q3 | Hoàn tiền sau khi đã đối soát: trừ vào kỳ sau (số âm) hay chỉ cảnh báo? | Hiện mục "điều chỉnh" ở tháng của lần hoàn, không sửa số tháng đã chốt. | CEO + Tech Lead |
| Q4 | Có cho gia sư thấy buổi chưa diễn ra (dự kiến thu nhập) không? | Không ở bản đầu; chỉ buổi đã kết thúc. | CEO |
| Q5 | Cần xuất CSV/PDF không? | Ngoài phạm vi bản đầu. | CEO |
| Q6 | Tháng tính theo `endAt` hay `startAt` (buổi qua nửa đêm cuối tháng)? | `endAt` (§4.1). | BA/Tech Lead |

Mặc định ở cột "Đề xuất" được dùng cho các AC trên cho đến khi có quyết định khác.

## 8. Việc đề xuất tách thêm

1. Migration + cấu hình `FEE_RATE`, chốt phí lúc `CONFIRMED`.
2. Hai endpoint đọc + DTO allow-list + test (đơn vị công thức §4.2, tích hợp phân quyền §US-04, tổng khớp chi tiết).
3. Màn S-29/S-30 + test giao diện.
4. Chức năng Admin đánh dấu đối soát (phụ thuộc Q2).
5. Cập nhật `docs/openapi.yaml`, `docs/test-plan.md`, `docs/architecture.md` §2.8.
