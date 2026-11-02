"use strict";
const { route, send, clearSessionCookie } = require("./_lib/core");

module.exports = route({
  POST: { roles: null, fn: async (req, res) => { clearSessionCookie(req, res); send(res, 200, { ok: true }); } }
});
