// Lõi dùng chung cho các API (chạy bởi server.js).
// Không dùng thư viện ngoài: dữ liệu lưu trong file trên máy chủ (api/_lib/store.js) theo kiểu lệnh Redis;
// nếu có biến KV_REST_API_URL/TOKEN thì dùng Upstash Redis REST (để sau này có thể chạy trên cloud).
// Mật khẩu băm bằng scrypt, phiên đăng nhập là cookie ký HMAC-SHA256.
"use strict";
const crypto = require("node:crypto");
const localStore = require("./store");

const ROLES = ["admin", "hr", "viewer"];
const SESSION_COOKIE = "tc_session";
const SESSION_TTL_SEC = 12 * 3600;

/* ---------------- lỗi có thông điệp cho người dùng ---------------- */
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/* ---------------- Redis (Upstash REST) ---------------- */
function redisEnv() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/+$/, ""), token } : null;
}
async function redis(...cmd) {
  const env = redisEnv();
  if (!env) return localStore.exec(cmd);
  const { url, token } = env;
  const r = await fetch(url, { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify(cmd) });
  const j = await r.json().catch(() => ({ error: "Phản hồi không hợp lệ (HTTP " + r.status + ")" }));
  if (j.error) throw new Error("Redis " + cmd[0] + ": " + j.error);
  return j.result;
}
async function pipeline(cmds) {
  if (!cmds.length) return [];
  const env = redisEnv();
  if (!env) return cmds.map(c => localStore.exec(c));
  const { url, token } = env;
  const r = await fetch(url + "/pipeline", { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify(cmds) });
  const j = await r.json().catch(() => null);
  if (!Array.isArray(j)) throw new Error("Redis pipeline lỗi (HTTP " + r.status + ")");
  return j.map((x, i) => { if (x.error) throw new Error("Redis " + cmds[i][0] + ": " + x.error); return x.result; });
}
function hashToObject(flat) {
  const o = {};
  if (Array.isArray(flat)) for (let i = 0; i < flat.length; i += 2) o[flat[i]] = flat[i + 1];
  else if (flat && typeof flat === "object") Object.assign(o, flat);
  return o;
}
const K = {
  users: "tc:users",
  cfg: "tc:cfg",
  periods: "tc:periods",
  files: id => "tc:p:" + id + ":files",
  edits: id => "tc:p:" + id + ":edits",
  rev: id => "tc:p:" + id + ":rev",
  fail: u => "tc:fail:" + u
};

/* ---------------- mật khẩu ---------------- */
function hashPassword(pw, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(String(pw), salt, 64).toString("hex");
  return { salt, hash };
}
function checkPassword(pw, rec) {
  const { hash } = hashPassword(pw, rec.salt);
  const a = Buffer.from(hash, "hex"), b = Buffer.from(rec.hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function validatePassword(pw) {
  if (typeof pw !== "string" || pw.length < 8) throw new HttpError(400, "Mật khẩu phải có ít nhất 8 ký tự.");
}
function normUsername(u) {
  u = String(u || "").trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(u)) throw new HttpError(400, "Tên đăng nhập 3–32 ký tự, chỉ gồm chữ không dấu, số, dấu chấm, gạch ngang, gạch dưới.");
  return u;
}

/* ---------------- phiên đăng nhập ---------------- */
function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 24) throw new HttpError(500, "Thiếu SESSION_SECRET (tối thiểu 24 ký tự). Khởi động bằng server.js để tự tạo.");
  return s;
}
function signSession(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  return body + "." + sig;
}
function verifySession(tok) {
  if (!tok || typeof tok !== "string" || !tok.includes(".")) return null;
  const [body, sig] = tok.split(".");
  const exp = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  const a = Buffer.from(sig), b = Buffer.from(exp);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString());
    if (!p.exp || p.exp < Date.now() / 1000) return null;
    return p;
  } catch { return null; }
}
function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || "").split(";").forEach(p => {
    const i = p.indexOf("=");
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function isHttps(req) {
  return (req.headers["x-forwarded-proto"] || "").includes("https") || !!(req.socket && req.socket.encrypted) || process.env.VERCEL === "1";
}
function setSessionCookie(req, res, user) {
  const tok = signSession({ u: user.username, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SEC });
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${tok}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SEC}${isHttps(req) ? "; Secure" : ""}`);
}
function clearSessionCookie(req, res) {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isHttps(req) ? "; Secure" : ""}`);
}
async function getUserRecord(username) {
  const raw = await redis("HGET", K.users, username);
  return raw ? JSON.parse(raw) : null;
}
async function currentUser(req) {
  const p = verifySession(parseCookies(req)[SESSION_COOKIE]);
  if (!p) return null;
  const rec = await getUserRecord(p.u);
  if (!rec || rec.disabled) return null;
  return publicUser(rec);
}
function publicUser(rec) { return { username: rec.username, name: rec.name || rec.username, role: rec.role }; }

/* ---------------- HTTP ---------------- */
function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}
async function readBody(req) {
  if (req.body !== undefined && req.body !== null && !(typeof req.body === "string" && req.body === "")) {
    return typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const s = Buffer.concat(chunks).toString("utf8");
  if (!s) return {};
  try { return JSON.parse(s); } catch { throw new HttpError(400, "Dữ liệu gửi lên không phải JSON hợp lệ."); }
}
function query(req) {
  if (req.query) return req.query;
  const u = new URL(req.url, "http://x");
  return Object.fromEntries(u.searchParams);
}
// Chặn gửi request ghi từ trang khác (CSRF): request ghi phải là JSON và cùng origin
function checkSameOrigin(req) {
  if (req.method === "GET" || req.method === "HEAD") return;
  const origin = req.headers.origin;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  if (origin && host && new URL(origin).host !== host) throw new HttpError(403, "Yêu cầu không hợp lệ (khác nguồn).");
}

/**
 * Bọc handler: kiểm tra đăng nhập, quyền, phương thức; chuyển lỗi thành JSON tiếng Việt.
 * routes: { GET: { roles, fn }, POST: {...} }; roles = null nghĩa là không cần đăng nhập.
 */
function route(routes) {
  return async (req, res) => {
    try {
      const r = routes[req.method];
      if (!r) return send(res, 405, { error: "Phương thức không được hỗ trợ." });
      checkSameOrigin(req);
      let user = null;
      if (r.roles !== null) {
        user = await currentUser(req);
        if (!user) return send(res, 401, { error: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại." });
        if (r.roles && !r.roles.includes(user.role)) return send(res, 403, { error: "Tài khoản của bạn không có quyền thực hiện thao tác này." });
      }
      await r.fn(req, res, user);
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      console.error(e);
      send(res, 500, { error: "Lỗi máy chủ: " + (e && e.message || e) });
    }
  };
}

const PERIOD_ID = /^\d{4}-\d{2}$/;
function periodId(q) {
  const id = String(q.id || "");
  if (!PERIOD_ID.test(id)) throw new HttpError(400, "Mã kỳ công không hợp lệ (dạng YYYY-MM).");
  return id;
}

module.exports = {
  ROLES, HttpError, redis, pipeline, hashToObject, K,
  hashPassword, checkPassword, validatePassword, normUsername,
  setSessionCookie, clearSessionCookie, getUserRecord, publicUser,
  send, readBody, query, route, periodId
};
