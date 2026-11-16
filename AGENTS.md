# AGENTS.md — Quy tắc chung cho toàn bộ Agent & Subagent

Tài liệu này là hợp đồng kỷ luật bắt buộc cho mọi Agent, Subagent hoặc quy trình tự động hoá làm việc trên codebase **web-nhap-lieu**.

---

## 1. Nguyên tắc làm việc cốt lõi

1. **Hiểu rõ ranh giới & Phạm vi**:
   - Chỉ sửa đổi những file thực sự liên quan đến mục tiêu được giao.
   - Không tự ý tái cấu trúc (refactor) lan man sang các module khác ngoài phạm vi yêu cầu.
   - Bảo tồn toàn bộ ghi chú (comments) và docstrings hiện có nếu không trực tiếp thay đổi logic đó.

2. **Kỷ luật kiểm thử trước khi báo cáo hoàn thành**:
   Mọi Agent khi thực hiện code hoặc refactor **bắt buộc** phải tự chạy và xác nhận 5 lệnh kiểm tra sau đạt trạng thái hoàn toàn sạch trước khi bàn giao:
   ```bash
   yarn tsc -b
   yarn lint
   yarn test
   yarn i18n:check
   yarn build
   ```

3. **Nguyên tắc an toàn Hooks tuyệt đối**:
   - Tuyệt đối không đặt Hook (`useMemo`, `useState`, `useEffect`, `useCallback`) sau bất kỳ lệnh `return` sớm nào hoặc bên trong các khối điều kiện `if`.
   - Luôn đặt toàn bộ Hook ở cấp cao nhất của component.

4. **Nguyên tắc an toàn dữ liệu & Database**:
   - Không chạy bất kỳ câu lệnh nào trực tiếp can thiệp phá huỷ dữ liệu Supabase.
   - Mọi thay đổi schema đều phải qua file SQL trong `supabase/migrations/` và tuân theo chuẩn Postgres idempotent (`IF NOT EXISTS`, `OR REPLACE`).

5. **Nguyên tắc an toàn Git**:
   - Không bao giờ thêm các file cấu hình máy dev hoặc secret (`.agents/`, `.claude/settings.local.json`, `skills-lock.json`, `.env*`) vào git commit.
   - Không dùng cờ `--force`.
   - Không can thiệp vào `~/.ssh`, `~/.gitconfig` hay cấu hình remote của người dùng.

---

## 2. Phân chia vai trò Subagents

| Subagent | Trách nhiệm chính | Công cụ cấp phép |
|---|---|---|
| `research` | Khảo sát codebase, tra cứu logic hiện có, đọc log và tài liệu | Chỉ đọc (Read-only) |
| `code-reviewer` | Đánh giá chất lượng code, kiểm tra vi phạm Rules of Hooks, kiểm tra type và hiệu năng | Đọc code, chạy linter, chạy test |
| `visual-designer` | Thiết kế minh hoạ vector SVG cho món ăn, tối ưu CSS giao diện | Tạo/sửa SVG, render headless Chrome kiểm tra |
| `database-guard` | Soạn thảo migration SQL, kiểm tra RLS policies, index tối ưu | Đọc/viết migrations, tuân thủ supabase-postgres-best-practices |

---

## 3. Quy trình phản hồi & Bàn giao

- Giữ nội dung phản hồi ngắn gọn, súc tích, định dạng Markdown rõ ràng.
- Luôn tạo clickable link cho các file và biểu tượng code theo chuẩn `[ten-file](file:///duong/dan/tuyet/doi)`.
- Liệt kê minh bạch kết quả từng lệnh kiểm tra và mã commit (nếu có).

---

## 4. Bộ kỹ năng Agent tích hợp (Project Skills)

Dự án và toàn bộ Agent trên máy được hỗ trợ 3 bộ kỹ năng tiêu chuẩn:

1. **`impeccable`** (Frontend UI/UX Craft & Anti-Slop):
   - **Vị trí**: `.agents/skills/impeccable`, `.agent/skills/impeccable`, `.claude/skills/impeccable` (và global `~/.gemini/config/skills/impeccable`, `~/.claude/skills/impeccable`).
   - **Ứng dụng**: Thẩm định UX (`critique`), kiểm tra a11y & contrast (`audit`), tinh chỉnh giao diện (`polish`, `bolder`, `quieter`). Quét anti-patterns: `npx impeccable detect <target>`.
   - **Nguyên tắc**: Giữ chuẩn chất lượng cao (craft floor), bảo tồn tokens và tài liệu ngữ cảnh thiết kế.

2. **`design-taste-frontend`** (taste-skill - Chuẩn thẩm mỹ cao cấp):
   - **Vị trí**: `.agents/skills/design-taste-frontend`, `.agent/skills/design-taste-frontend`, `.claude/skills/design-taste-frontend`.
   - **Ứng dụng**: Áp dụng khi thiết kế hoặc cải thiện trang giao diện (landing page, shop, dashboard), tránh giao diện generic AI slop.
   - **House rules**: 1 section/màn hình; đối xứng lề trái/phải; micro-interactions nhã nhặn (hover card nâng 2px, zoom 1.02); visual render đầy đủ trên 1440, 1024, 768, 390; không dùng caption thừa dưới visual.

3. **`agent-reach`** (Social & Media Read-Only Web Reach):
   - **Vị trí**: `.agents/skills/agent-reach`, `.agent/skills/agent-reach`, `.claude/skills/agent-reach`.
   - **Ứng dụng**: Tra cứu và đọc nội dung chỉ đọc từ các nền tảng xã hội/video/developer (GitHub, Twitter/X, Reddit, YouTube transcript/phụ đề, B站, V2EX, Xiaohongshu...) khi các công cụ web fetch thông thường bị giới hạn. Lệnh: `agent-reach <channel> <action> ...`.

