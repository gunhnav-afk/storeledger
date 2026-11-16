# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

1. **Chủ quán & Quản trị viên (Admin)**:
   - Điều hành các cửa hàng ẩm thực nhỏ / hộ kinh doanh (điển hình: **Hogi Food** — sữa chua hũ handmade, sữa chua Hy Lạp, bánh flan caramel; và **Bún đậu Em Thúy** — quán ăn truyền thống).
   - Cần theo dõi nhập hàng, phân phối ra quầy, hàng huỷ, doanh thu đa kênh, chi phí, lợi nhuận thực tế theo từng lô nhập (FIFO), điểm hoà vốn và quản lý nhân sự.
2. **Nhân viên bán hàng & vận hành (Staff)**:
   - Thao tác trực tiếp tại quầy hoặc kho trên điện thoại / máy tính bảng: ghi nhận đơn bán hàng ngày, nhập kho, chuyển hàng từ kho ra quầy, ghi nhận hàng huỷ và kiểm tra tồn kho hiện tại.
3. **Khách đặt hàng trực tuyến (Khách văn phòng / công ty & khách lẻ)**:
   - Truy cập trang đặt hàng công khai (`/hogi`, `/shop/<mã-quán>` hoặc tên miền riêng `hogifood.*`) để chọn món theo set 4/6 hũ (tự phối vị) hoặc mua lẻ (sữa chua Hy Lạp 110g/400g, nước whey 220ml), điền `domain` nội bộ và tầng giao hàng, quét mã QR thanh toán động và lưu hoá đơn ảnh.

## Product Purpose

**Sổ Xanh (`web-nhap-lieu`)** là hệ thống sổ sách bán hàng, quản trị tồn kho và trang đặt món trực tuyến kết hợp trong một ứng dụng web duy nhất cho cửa hàng F&B nhỏ. Sản phẩm giúp:
- Thay thế sổ ghi chép rời rạc và file bảng tính thủ công bằng quy trình khép kín: **Nhập hàng → Phân phối ra quầy → Bán hàng / Đơn đặt trước → Báo cáo lãi lỗ & Hoà vốn tự động**.
- Cung cấp kênh đặt hàng tự phục vụ minh bạch cho khách văn phòng và khách lẻ, kết nối trực tiếp đơn đặt trước của khách vào luồng ghi nhận doanh thu của cửa hàng chỉ với 1 chạm.

## Positioning

Khác với phần mềm POS đa năng cồng kềnh hoặc biểu mẫu đặt hàng rời rạc (Google Forms / tin nhắn thủ công):
- **Hai chế độ sổ sách thích ứng theo mô hình quán trong cùng một nền tảng**:
  - Mô hình bán theo món có kho & lô nhập (**Hogi Food**): quản lý tồn kho 2 tầng (Kho nhập ⇄ Quầy bán), tính giá vốn & lãi lỗ theo phương pháp **FIFO (nhập trước xuất trước)** và hạch toán hàng huỷ theo lô.
  - Mô hình nhập doanh thu & định lượng (**Bún đậu Em Thúy**): tổng hợp doanh thu theo ngày/kênh (tiền mặt, chuyển khoản, GrabFood, ShopeeFood, bán dầu đen), quản lý chi phí nguyên liệu và định lượng món.
- **Cơ chế đặt hàng theo Set thông minh & Thanh toán nội bộ văn phòng**:
  - Tự động tính giá ưu đãi cho set 4 hoặc set 6 hũ (set đồng vị vs set mix nhiều vị) tách biệt theo từng dòng sản phẩm (sữa chua vs bánh flan), kết hợp mượt mà với món bán lẻ trong cùng giỏ hàng.
  - Tự động chuẩn hoá nội dung chuyển khoản nội bộ (`<domain> - F<tầng>`), sinh mã **VietQR EMVCo chuẩn Napas** động tại trình duyệt và kết xuất hoá đơn ảnh PNG bằng HTML5 Canvas không cần máy chủ render.

## Operating Context

- **Vận hành tại quầy & kho**: Nhân viên và chủ quán thường xuyên sử dụng trên điện thoại di động trong lúc bận rộn; giao diện chia rõ hai phân khu độc lập: **Nhập liệu** (những gì người dùng nhập tay hoặc tải file lên) và **Báo cáo** (số liệu hệ thống tự tính, không có thao tác nhập).
- **Đặt hàng văn phòng (Kênh Công ty)**: Khách hàng dùng điện thoại hoặc máy tính tại văn phòng, nhập tài khoản `domain` công ty (tự động cắt bỏ phần `@...` nếu gõ thừa) và số tầng (`F6`, `B1`...). Đơn đặt trước đẩy thông báo thời gian thực (Realtime + âm thanh chuông báo) tới màn hình quản trị và gửi thẻ thông báo qua Google Chat Space webhook.
- **Đa ngôn ngữ & Giao diện**: Hỗ trợ 5 ngôn ngữ (`vi`, `en`, `ko`, `zh`, `ja`) và chế độ Sáng/Tối (Light/Dark mode) đồng bộ.

## Capabilities and Constraints

- **Kiến trúc kỹ thuật**: SPA với React 19, Vite 8, TypeScript, React Router 7, Recharts, kết nối trực tiếp tới Supabase (Postgres Database, Auth với Google OAuth + Hàng chờ phê duyệt tài khoản `pending`, Edge Functions `admin-users` và `chat-assistant`).
- **Bảo mật Zero-Trust & Đa cửa hàng (Multi-tenant RLS)**:
  - 100% bảng dữ liệu nghiệp vụ bật Row Level Security (RLS) phân tách theo cửa hàng và vai trò (`admin` / `staff` / `anon`).
  - Thông tin nhạy cảm (email quản trị gốc, tên miền email công ty, Google Chat Space webhook) được lưu trữ mã hoá trong **Supabase Vault**, tuyệt đối không lộ trong mã nguồn frontend.
- **Kỷ luật chất lượng bắt buộc**:
  - Mọi thay đổi phải vượt qua 5 bước kiểm tra sạch: `yarn tsc -b`, `yarn lint` (oxlint, tuân thủ tuyệt đối React Rules of Hooks), `yarn test` (Vitest), `yarn i18n:check` (đồng bộ 100% khoá dịch trên 5 ngôn ngữ `vi/en/ko/zh/ja`) và `yarn build`.

## Brand Commitments

- **Sổ Xanh** (phân hệ quản trị nội bộ): Ngôn ngữ rõ ràng, thực dụng, bình dân dễ hiểu với người bán hàng; ưu tiên tốc độ nhập liệu và độ chính xác của con số tài chính.
- **Hogi Food** (phân hệ trang khách `/hogi`): Thủ công, tươi mới, thân thiện và chỉn chu. Toàn bộ hình ảnh món ăn trên Storefront sử dụng bộ minh hoạ vector **SVG thiết kế riêng** đồng bộ nhận diện thương hiệu (`public/shop/*.svg`), không sử dụng emoji hệ thống thay cho minh hoạ sản phẩm.

## Evidence on Hand

- **Tài sản hình ảnh & thương hiệu (`public/shop/`)**:
  - Logo thương hiệu: `hogi-logo.svg`, `hogi-logo.png`.
  - Tranh minh hoạ banner: `hero.svg`.
  - Bộ sưu tập SVG từng vị món ăn: `flavor-truyen-thong.svg`, `flavor-pho-mai.svg`, `flavor-nep-cam.svg`, `flavor-matcha.svg`, `flavor-ca-cao.svg`, `flavor-banh-flan.svg`, `flavor-hy-lap.svg` (110g), `flavor-hy-lap-400.svg` (400g), `flavor-whey.svg` (220ml).
- **Nghiệp vụ & Kiểm thử thực tế**:
  - Hệ thống tính giá set, tạo mã QR EMVCo (`src/lib/emvQr.ts`), vẽ ảnh hoá đơn (`src/lib/invoiceImage.ts`), phân tích hàng huỷ và lịch tháng bán hàng đã được kiểm chứng bằng bộ unit test trong `src/lib/`.
- **Giới hạn trung thực**: Không tự bịa đặt số liệu đánh giá khách hàng (testimonials), chứng nhận an toàn thực phẩm hay chương trình khuyến mãi khi chưa có dữ liệu cấu hình thực từ cửa hàng.

## Product Principles

1. **Tách bạch Nhập liệu và Báo cáo**: Màn hình Nhập liệu tập trung tối đa vào thao tác ghi chép nhanh, ít bước; màn hình Báo cáo hoàn toàn tự động tổng hợp từ dữ liệu gốc mà không yêu cầu nhập lặp lại.
2. **Chính xác đến từng lô hàng và từng hũ**: Mọi biến động từ nhập kho, chuyển quầy, bán lẻ/bán set cho đến hàng huỷ đều phải khớp số lượng tồn và phản ánh đúng vào giá vốn FIFO cũng như tiến độ hoà vốn.
3. **Trải nghiệm đặt món tự nhiên, không ma sát**: Khách đặt hàng trên Storefront thấy ngay giá trị từng set khi phối vị, nhận mã QR đúng số tiền + cú pháp chuyển khoản và gửi đơn chỉ trong vài giây mà không cần tạo tài khoản.
4. **An toàn dữ liệu và đồng bộ đa ngôn ngữ mặc định**: Bảo mật dữ liệu cửa hàng qua RLS/Vault và tính toàn vẹn 5 ngôn ngữ là tiêu chuẩn bắt buộc ở mọi tính năng, không phải bước bổ sung sau cùng.
