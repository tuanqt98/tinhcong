// Kho dữ liệu cục bộ: giữ trong bộ nhớ, ghi xuống file data/db.json (ghi an toàn qua file tạm),
// mỗi ngày sao lưu một bản vào data/backup/ (giữ 60 bản gần nhất).
// Hỗ trợ đúng các lệnh kiểu Redis mà API dùng, nên API không phải sửa khi đổi nơi lưu.
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, "..", "..", "data"));
const DB_FILE = path.join(DATA_DIR, "db.json");
const BACKUP_DIR = path.join(DATA_DIR, "backup");
const KEEP_BACKUPS = 60;

let store = null;            // Map<string, string | Map<string,string>>
const expires = new Map();   // key → thời điểm hết hạn (ms)
let saveTimer = null;

function load() {
  if (store) return;
  store = new Map();
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) return;
  const raw = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  for (const [k, v] of Object.entries(raw.data || {})) store.set(k, v && typeof v === "object" ? new Map(Object.entries(v)) : v);
  for (const [k, t] of Object.entries(raw.expires || {})) expires.set(k, t);
}
function serialize() {
  const data = {};
  for (const [k, v] of store) data[k] = v instanceof Map ? Object.fromEntries(v) : v;
  return JSON.stringify({ savedAt: new Date().toISOString(), data, expires: Object.fromEntries(expires) });
}
function saveNow() {
  clearTimeout(saveTimer); saveTimer = null;
  const tmp = DB_FILE + ".tmp";
  fs.writeFileSync(tmp, serialize());
  fs.renameSync(tmp, DB_FILE);
  // sao lưu theo ngày
  const day = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" });
  const bk = path.join(BACKUP_DIR, "db-" + day + ".json");
  if (!fs.existsSync(bk)) {
    fs.copyFileSync(DB_FILE, bk);
    const old = fs.readdirSync(BACKUP_DIR).filter(f => /^db-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
    for (const f of old.slice(0, Math.max(0, old.length - KEEP_BACKUPS))) fs.unlinkSync(path.join(BACKUP_DIR, f));
  }
}
function scheduleSave() {
  if (!saveTimer) saveTimer = setTimeout(() => { try { saveNow(); } catch (e) { console.error("Không ghi được dữ liệu:", e); } }, 200);
}
function flush() { if (saveTimer) saveNow(); }

function alive(key) {
  const t = expires.get(key);
  if (t && t <= Date.now()) { store.delete(key); expires.delete(key); scheduleSave(); return false; }
  return store.has(key);
}
const WRITE = new Set(["SET", "DEL", "INCR", "EXPIRE", "HSET", "HDEL"]);

function exec(cmd) {
  load();
  const [op, key, ...a] = cmd;
  const O = String(op).toUpperCase();
  alive(key);
  const hash = () => { let m = store.get(key); if (!(m instanceof Map)) { m = new Map(); store.set(key, m); } return m; };
  let out;
  switch (O) {
    case "GET": { const v = store.get(key); out = v === undefined || v instanceof Map ? null : v; break; }
    case "SET": store.set(key, String(a[0])); expires.delete(key); out = "OK"; break;
    case "DEL": expires.delete(key); out = store.delete(key) ? 1 : 0; break;
    case "INCR": { const n = Number(store.get(key) || 0) + 1; store.set(key, String(n)); out = n; break; }
    case "EXPIRE": if (store.has(key)) { expires.set(key, Date.now() + Number(a[0]) * 1000); out = 1; } else out = 0; break;
    case "HGET": { const m = store.get(key); out = m instanceof Map && m.has(a[0]) ? m.get(a[0]) : null; break; }
    case "HSET": { const m = hash(); let n = 0; for (let i = 0; i < a.length; i += 2) { if (!m.has(a[i])) n++; m.set(a[i], String(a[i + 1])); } out = n; break; }
    case "HDEL": { const m = store.get(key); out = 0; if (m instanceof Map) for (const f of a) if (m.delete(f)) out++; break; }
    case "HLEN": { const m = store.get(key); out = m instanceof Map ? m.size : 0; break; }
    case "HEXISTS": { const m = store.get(key); out = m instanceof Map && m.has(a[0]) ? 1 : 0; break; }
    case "HGETALL": { const m = store.get(key); out = m instanceof Map ? [...m].flat() : []; break; }
    default: throw new Error("Lệnh chưa hỗ trợ: " + O);
  }
  if (WRITE.has(O)) scheduleSave();
  return out;
}

module.exports = { exec, flush, DATA_DIR, DB_FILE };
