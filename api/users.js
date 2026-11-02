"use strict";
// Quản lý tài khoản (chỉ admin)
const { ROLES, redis, K, route, readBody, query, send, normUsername, hashPassword, validatePassword, hashToObject, getUserRecord, HttpError } = require("./_lib/core");

const ADMIN = ["admin"];

async function adminCount(exceptUser) {
  const all = hashToObject(await redis("HGETALL", K.users));
  return Object.values(all).map(s => JSON.parse(s)).filter(u => u.role === "admin" && !u.disabled && u.username !== exceptUser).length;
}

module.exports = route({
  GET: {
    roles: ADMIN,
    fn: async (req, res) => {
      const all = hashToObject(await redis("HGETALL", K.users));
      const users = Object.values(all).map(s => JSON.parse(s))
        .map(u => ({ username: u.username, name: u.name, role: u.role, disabled: !!u.disabled, createdAt: u.createdAt }))
        .sort((a, b) => a.username.localeCompare(b.username));
      send(res, 200, { users });
    }
  },
  // Tạo mới hoặc cập nhật (tên, vai trò, khoá, đặt lại mật khẩu)
  POST: {
    roles: ADMIN,
    fn: async (req, res, me) => {
      const b = await readBody(req);
      const username = normUsername(b.username);
      const existing = await getUserRecord(username);
      const role = b.role ?? existing?.role ?? "hr";
      if (!ROLES.includes(role)) throw new HttpError(400, "Vai trò không hợp lệ.");
      const name = String(b.name ?? existing?.name ?? username).trim().slice(0, 80) || username;
      const disabled = !!(b.disabled ?? existing?.disabled);
      if (existing && existing.role === "admin" && (role !== "admin" || disabled) && (await adminCount(username)) === 0)
        throw new HttpError(400, "Phải còn ít nhất một tài khoản admin đang hoạt động.");
      let rec;
      if (existing) {
        rec = { ...existing, name, role, disabled, updatedAt: new Date().toISOString(), updatedBy: me.username };
        if (b.password) { validatePassword(b.password); Object.assign(rec, hashPassword(b.password)); }
      } else {
        validatePassword(b.password);
        rec = { username, name, role, disabled, ...hashPassword(b.password), createdAt: new Date().toISOString(), createdBy: me.username };
      }
      await redis("HSET", K.users, username, JSON.stringify(rec));
      send(res, 200, { user: { username, name, role, disabled } });
    }
  },
  DELETE: {
    roles: ADMIN,
    fn: async (req, res, me) => {
      const username = normUsername(query(req).username);
      if (username === me.username) throw new HttpError(400, "Không thể tự xoá tài khoản đang đăng nhập.");
      const existing = await getUserRecord(username);
      if (!existing) throw new HttpError(404, "Không tìm thấy tài khoản.");
      if (existing.role === "admin" && (await adminCount(username)) === 0) throw new HttpError(400, "Phải còn ít nhất một tài khoản admin.");
      await redis("HDEL", K.users, username);
      send(res, 200, { ok: true });
    }
  }
});
