"use strict";
// Một kỳ công: dữ liệu 2 máy chấm công (đã rút gọn) + các chỉnh sửa của nhân sự.
// Chỉnh sửa lưu theo từng ô (hash field "MãNV|ngày#trường") nên 2 người sửa 2 ô khác nhau không ghi đè nhau.
const { redis, pipeline, K, route, readBody, query, send, periodId, hashToObject, HttpError } = require("./_lib/core");

const EDIT_FIELDS = ["in", "out", "leave", "note", "shift"];
const LEAVES = ["", "NL", "NP", "NKL", "NKP"];

function validDate(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s); }
function validFile(f) {
  if (f === null) return true;
  if (!f || typeof f !== "object" || !Array.isArray(f.emps) || !Array.isArray(f.rows)) return false;
  if (!f.period || !validDate(f.period.from) || !validDate(f.period.to)) return false;
  return f.rows.every(r => Array.isArray(r) && r.length === 4 && Number.isInteger(r[0]) && r[0] >= 0 && r[0] < f.emps.length && validDate(r[1])
    && (r[2] === null || (Number.isInteger(r[2]) && r[2] >= 0 && r[2] < 1440)) && (r[3] === null || (Number.isInteger(r[3]) && r[3] >= 0 && r[3] < 1440)));
}
function validEditValue(field, v) {
  if (field === "in" || field === "out") return v === null || (Number.isInteger(v) && v >= 0 && v < 1440);
  if (field === "leave") return LEAVES.includes(v);
  if (field === "note") return typeof v === "string" && v.length <= 200;
  if (field === "shift") return typeof v === "string" && v.length <= 20;
  return false;
}

module.exports = route({
  // ?id=YYYY-MM            → toàn bộ kỳ
  // ?id=YYYY-MM&rev=1      → chỉ số phiên bản (để các máy khác biết có thay đổi)
  GET: {
    roles: undefined,
    fn: async (req, res) => {
      const q = query(req), id = periodId(q);
      if (q.rev) return send(res, 200, { rev: Number(await redis("GET", K.rev(id)) || 0) });
      const [meta, files, edits, rev] = await pipeline([["HGET", K.periods, id], ["GET", K.files(id)], ["HGETALL", K.edits(id)], ["GET", K.rev(id)]]);
      if (!meta) throw new HttpError(404, "Chưa có kỳ công " + id + ".");
      const e = hashToObject(edits);
      for (const k in e) e[k] = JSON.parse(e[k]);
      send(res, 200, { meta: JSON.parse(meta), files: files ? JSON.parse(files) : { SX: null, VP: null }, edits: e, rev: Number(rev || 0) });
    }
  },
  // Tạo/cập nhật kỳ: { from, to, files?: { SX?, VP? } } — file nào gửi lên thì thay file đó
  PUT: {
    roles: ["admin", "hr"],
    fn: async (req, res, user) => {
      const id = periodId(query(req));
      const b = await readBody(req);
      if (!validDate(b.from) || !validDate(b.to) || b.from > b.to) throw new HttpError(400, "Kỳ công không hợp lệ.");
      const curRaw = await redis("GET", K.files(id));
      const files = curRaw ? JSON.parse(curRaw) : { SX: null, VP: null };
      if (b.files) {
        for (const src of ["SX", "VP"]) {
          if (!(src in b.files)) continue;
          if (!validFile(b.files[src])) throw new HttpError(400, "Dữ liệu file " + src + " không hợp lệ.");
          files[src] = b.files[src] ? { ...b.files[src], uploadedBy: user.username, uploadedAt: new Date().toISOString() } : null;
        }
      }
      const meta = {
        id, from: b.from, to: b.to,
        fileNames: { SX: files.SX && files.SX.name || null, VP: files.VP && files.VP.name || null },
        updatedBy: user.username, updatedAt: new Date().toISOString()
      };
      const out = await pipeline([
        ["SET", K.files(id), JSON.stringify(files)],
        ["HSET", K.periods, id, JSON.stringify(meta)],
        ["INCR", K.rev(id)]
      ]);
      send(res, 200, { meta, rev: out[2] });
    }
  },
  // Sửa một ô: { key: "NV0001|2026-10-05", field: "out", value: 422 }
  PATCH: {
    roles: ["admin", "hr"],
    fn: async (req, res, user) => {
      const id = periodId(query(req));
      const b = await readBody(req);
      const list = Array.isArray(b.edits) ? b.edits : [b];
      if (!list.length || list.length > 500) throw new HttpError(400, "Số ô sửa không hợp lệ.");
      if (!(await redis("HEXISTS", K.periods, id))) throw new HttpError(404, "Chưa có kỳ công " + id + ".");
      const at = new Date().toISOString();
      const cmds = [];
      for (const e of list) {
        if (typeof e.key !== "string" || !/^[^|#]{1,40}\|\d{4}-\d{2}-\d{2}$/.test(e.key)) throw new HttpError(400, "Khoá dòng không hợp lệ.");
        if (!EDIT_FIELDS.includes(e.field)) throw new HttpError(400, "Trường không hợp lệ.");
        if (!validEditValue(e.field, e.value)) throw new HttpError(400, "Giá trị không hợp lệ cho " + e.field + ".");
        cmds.push(["HSET", K.edits(id), e.key + "#" + e.field, JSON.stringify({ v: e.value, by: user.username, at })]);
      }
      cmds.push(["INCR", K.rev(id)]);
      const out = await pipeline(cmds);
      send(res, 200, { rev: out[out.length - 1], by: user.username, at });
    }
  },
  DELETE: {
    roles: ["admin"],
    fn: async (req, res) => {
      const id = periodId(query(req));
      await pipeline([["DEL", K.files(id)], ["DEL", K.edits(id)], ["DEL", K.rev(id)], ["HDEL", K.periods, id]]);
      send(res, 200, { ok: true });
    }
  }
});
