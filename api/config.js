"use strict";
// Cấu hình quy tắc tính công dùng chung cho mọi người. Đọc: mọi tài khoản; ghi: admin.
const { redis, K, route, readBody, send, HttpError } = require("./_lib/core");

module.exports = route({
  GET: {
    roles: undefined,
    fn: async (req, res) => {
      const raw = await redis("GET", K.cfg);
      send(res, 200, { cfg: raw ? JSON.parse(raw) : null });
    }
  },
  PUT: {
    roles: ["admin"],
    fn: async (req, res, user) => {
      const b = await readBody(req);
      const cfg = b.cfg;
      if (!cfg || typeof cfg !== "object" || !cfg.ca || typeof cfg.ca !== "object") throw new HttpError(400, "Cấu hình không hợp lệ.");
      const s = JSON.stringify({ ...cfg, _updatedBy: user.username, _updatedAt: new Date().toISOString() });
      if (s.length > 200000) throw new HttpError(400, "Cấu hình quá lớn.");
      await redis("SET", K.cfg, s);
      send(res, 200, { ok: true });
    }
  },
  // Khôi phục mặc định = xoá cấu hình đã lưu
  DELETE: {
    roles: ["admin"],
    fn: async (req, res) => { await redis("DEL", K.cfg); send(res, 200, { ok: true }); }
  }
});
