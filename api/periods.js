"use strict";
// Danh sách kỳ công đã lưu
const { redis, K, route, send, hashToObject } = require("./_lib/core");

module.exports = route({
  GET: {
    roles: undefined,
    fn: async (req, res) => {
      const all = hashToObject(await redis("HGETALL", K.periods));
      const periods = Object.values(all).map(s => JSON.parse(s)).sort((a, b) => b.id.localeCompare(a.id));
      send(res, 200, { periods });
    }
  }
});
