// Edge Function quản lý tài khoản nhân sự độc lập cho Thiên Bảo Clothes (project zfawfaqqvfqzydnhrhkq)
import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Body =
  | {
      action: "create";
      email: string;
      password: string;
      full_name: string;
      role?: "super_admin" | "manager" | "staff";
      department?: string;
      worker_code?: string | null;
      phone?: string | null;
    }
  | { action: "set_password"; user_id: string; password: string };

const reply = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: CORS_HEADERS });

const fail = (message: string, status = 400) => reply({ error: message }, status);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return fail("Chỉ nhận POST", 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return fail("Bạn cần đăng nhập", 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const adminClient = createClient(supabaseUrl, serviceKey);

  const { data: isManager, error: mgrErr } = await userClient.rpc("is_manager");
  if (mgrErr) return fail(mgrErr.message, 500);
  if (!isManager) return fail("Chỉ quản lý xưởng được thao tác tài khoản", 403);

  const { data: isSuper } = await userClient.rpc("is_super_admin");
  const callerIsSuper = Boolean(isSuper);

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return fail("Dữ liệu gửi lên không hợp lệ");
  }

  if (body.action === "set_password") {
    if (!body.user_id) return fail("Thiếu mã nhân viên");
    if (!body.password || body.password.length < 6) {
      return fail("Mật khẩu phải có ít nhất 6 ký tự");
    }

    const { data: target } = await userClient
      .from("profiles")
      .select("role, email")
      .eq("id", body.user_id)
      .maybeSingle();

    if (!target) return fail("Không tìm thấy nhân viên", 404);
    if (target.role === "super_admin" && !callerIsSuper) {
      return fail("Chỉ Chủ xưởng mới được đổi mật khẩu tài khoản Chủ xưởng", 403);
    }

    const { error } = await adminClient.auth.admin.updateUserById(body.user_id, {
      password: body.password,
    });
    if (error) return fail(error.message);
    return reply({ ok: true });
  }

  if (body.action !== "create") return fail("Thao tác không hợp lệ");

  const email = (body.email ?? "").trim().toLowerCase();
  const fullName = (body.full_name ?? "").trim();
  const password = body.password ?? "";
  const role = body.role === "super_admin" ? "super_admin" : body.role === "manager" ? "manager" : "staff";
  const department = body.department ?? "May";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("Email không hợp lệ");
  if (!fullName) return fail("Nhập họ tên nhân viên");
  if (password.length < 6) return fail("Mật khẩu phải có ít nhất 6 ký tự");
  if (role === "super_admin" && !callerIsSuper) {
    return fail("Chỉ Chủ xưởng mới được tạo tài khoản Chủ xưởng", 403);
  }

  const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (createErr) {
    const exists = /already|registered|exists/i.test(createErr.message);
    return fail(exists ? "Email này đã có tài khoản trong xưởng" : createErr.message);
  }

  const userId = created.user.id;
  const { error: approveErr } = await userClient.rpc("workshop_approve_user", {
    p_user_id: userId,
    p_role: role,
    p_department: department,
    p_worker_code: body.worker_code ?? null,
    p_phone: body.phone ?? null,
  });

  if (approveErr) {
    await adminClient.auth.admin.deleteUser(userId);
    return fail(approveErr.message);
  }

  return reply({ ok: true, user_id: userId });
});
