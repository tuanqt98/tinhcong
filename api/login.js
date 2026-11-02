"use strict";
const { redis, K, route, readBody, send, normUsername, hashPassword, checkPassword, getUserRecord, setSessionCookie, publicUser, HttpError } = require("./_lib/core");

const MAX_FAIL = 10, LOCK_SEC = 15 * 60;

module.exports = route({
  POST: {
    roles: null,
    fn: async (req, res) => {
      const b = await readBody(req);
      let username;
      try { username = normUsername(b.username); } catch { throw new HttpError(401, "Sai tên đăng nhập hoặc mật khẩu."); }
      const password = String(b.password || "");

      const fails = Number(await redis("GET", K.fail(username)) || 0);
      if (fails >= MAX_FAIL) throw new HttpError(429, "Đăng nhập sai quá nhiều lần. Thử lại sau 15 phút.");

      let rec = await getUserRecord(username);

      // Lần đầu triển khai: chưa có tài khoản nào → tạo admin từ biến môi trường ADMIN_USERNAME / ADMIN_PASSWORD
      if (!rec) {
        const count = Number(await redis("HLEN", K.users));
        const au = (process.env.ADMIN_USERNAME || "").trim().toLowerCase(), ap = process.env.ADMIN_PASSWORD || "";
        if (count === 0 && au && ap.length >= 8 && username === au && password === ap) {
          rec = { username, name: "Quản trị", role: "admin", ...hashPassword(password), createdAt: new Date().toISOString(), createdBy: "bootstrap" };
          await redis("HSET", K.users, username, JSON.stringify(rec));
        }
      }

      if (!rec || rec.disabled || !checkPassword(password, rec)) {
        await redis("INCR", K.fail(username));
        await redis("EXPIRE", K.fail(username), LOCK_SEC);
        throw new HttpError(401, "Sai tên đăng nhập hoặc mật khẩu.");
      }
      await redis("DEL", K.fail(username));
      setSessionCookie(req, res, rec);
      send(res, 200, { user: publicUser(rec) });
    }
  }
});
