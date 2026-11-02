"use strict";
const { route, send, readBody, getUserRecord, checkPassword, hashPassword, validatePassword, redis, K, HttpError } = require("./_lib/core");

module.exports = route({
  GET: { roles: undefined, fn: async (req, res, user) => send(res, 200, { user }) },
  // Tự đổi mật khẩu của mình
  PUT: {
    roles: undefined,
    fn: async (req, res, user) => {
      const b = await readBody(req);
      const rec = await getUserRecord(user.username);
      if (!checkPassword(String(b.oldPassword || ""), rec)) throw new HttpError(400, "Mật khẩu hiện tại không đúng.");
      validatePassword(b.password);
      Object.assign(rec, hashPassword(b.password), { updatedAt: new Date().toISOString() });
      await redis("HSET", K.users, rec.username, JSON.stringify(rec));
      send(res, 200, { ok: true });
    }
  }
});
