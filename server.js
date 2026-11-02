#!/usr/bin/env node
// Máy chủ tính công chạy trên máy trong công ty.  Chạy:  node server.js   (hoặc bấm start-server.bat)
// Các máy khác trong cùng mạng LAN mở  http://<IP máy này>:3000
// Dữ liệu lưu ở thư mục data/ (db.json + backup hằng ngày). Không cần cài thư viện nào ngoài Node.js.
"use strict";
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const MAX_BODY = 25 * 1024 * 1024;

const store = require("./api/_lib/store");
fs.mkdirSync(store.DATA_DIR, { recursive: true });

/* ---------- khoá ký phiên đăng nhập: tự tạo 1 lần, lưu trong data/ ---------- */
if (!process.env.SESSION_SECRET) {
  const f = path.join(store.DATA_DIR, ".session-secret");
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString("hex"), { mode: 0o600 });
  process.env.SESSION_SECRET = fs.readFileSync(f, "utf8").trim();
}

/* ---------- tài khoản quản trị đầu tiên ---------- */
const hasUsers = Number(store.exec(["HLEN", "tc:users"])) > 0;
if (!hasUsers) {
  process.env.ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
  const f = path.join(store.DATA_DIR, "TAI-KHOAN-ADMIN-LAN-DAU.txt");
  if (!process.env.ADMIN_PASSWORD) {
    if (fs.existsSync(f)) process.env.ADMIN_PASSWORD = (/Mật khẩu: (.+)/.exec(fs.readFileSync(f, "utf8")) || [])[1] || "";
    if (!process.env.ADMIN_PASSWORD) {
      process.env.ADMIN_PASSWORD = crypto.randomBytes(6).toString("base64url");
      fs.writeFileSync(f, `Tài khoản quản trị đầu tiên\nTên đăng nhập: ${process.env.ADMIN_USERNAME}\nMật khẩu: ${process.env.ADMIN_PASSWORD}\n\nĐăng nhập xong hãy đổi mật khẩu (nút Tài khoản) và xoá file này.\n`);
    }
  }
}

/* ---------- thư viện đọc/ghi Excel: dùng bản cài sẵn (npm install) để chạy được cả khi mạng LAN không có Internet ---------- */
const VENDOR = {
  "/vendor/xlsx.full.min.js": ["xlsx/dist/xlsx.full.min.js"],
  "/vendor/jszip.min.js": ["jszip/dist/jszip.min.js"]
};
function vendorFile(p) {
  for (const rel of VENDOR[p] || []) { const f = path.join(ROOT, "node_modules", rel); if (fs.existsSync(f)) return f; }
  return null;
}

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json" };
const API = new Map();
function apiHandler(name) {
  if (!API.has(name)) {
    const f = path.join(ROOT, "api", name + ".js");
    API.set(name, fs.existsSync(f) ? require(f) : null);
  }
  return API.get(name);
}
function serveFile(res, file, cache) {
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": cache || "no-cache", "X-Content-Type-Options": "nosniff" });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");

  if (u.pathname.startsWith("/api/")) {
    const name = u.pathname.slice(5).replace(/\/+$/, "");
    const h = /^[a-z0-9-]+$/i.test(name) ? apiHandler(name) : null;
    if (!h) { res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" }); return res.end('{"error":"Không có API này."}'); }
    if (Number(req.headers["content-length"] || 0) > MAX_BODY) { res.writeHead(413, { "Content-Type": "application/json; charset=utf-8" }); return res.end('{"error":"File quá lớn."}'); }
    req.query = Object.fromEntries(u.searchParams);
    return Promise.resolve(h(req, res)).catch(e => { console.error(e); if (!res.headersSent) { res.writeHead(500); res.end(); } });
  }

  if (VENDOR[u.pathname]) {
    const f = vendorFile(u.pathname);
    if (f) return serveFile(res, f, "public, max-age=86400");
    res.writeHead(404); return res.end();
  }

  let p = path.normalize(path.join(PUBLIC, decodeURIComponent(u.pathname)));
  if (!p.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, "index.html");
  if (!fs.existsSync(p)) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("Không tìm thấy trang."); }
  serveFile(res, p);
});

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === "IPv4" && !a.internal) out.push(a.address);
  return out;
}
server.on("error", e => {
  if (e.code === "EADDRINUSE") console.error(`\n✗ Cổng ${PORT} đang bị chương trình khác dùng. Tắt chương trình đó hoặc chạy với cổng khác: set PORT=3001 rồi chạy lại.\n`);
  else console.error(e);
  process.exit(1);
});
server.listen(PORT, HOST, () => {
  console.log("\n=== Máy chủ tính công đang chạy ===");
  console.log(`  Trên máy này:      http://localhost:${PORT}`);
  for (const ip of lanAddresses()) console.log(`  Máy khác trong LAN: http://${ip}:${PORT}`);
  console.log(`  Dữ liệu lưu tại:   ${store.DATA_DIR}`);
  if (!vendorFile("/vendor/xlsx.full.min.js")) console.log("  (Chưa chạy 'npm install': trình duyệt sẽ tải thư viện Excel từ Internet.)");
  if (!hasUsers) console.log(`\n  Đăng nhập lần đầu: ${process.env.ADMIN_USERNAME} / ${process.env.ADMIN_PASSWORD}\n  (đã ghi vào data/TAI-KHOAN-ADMIN-LAN-DAU.txt — đổi mật khẩu sau khi đăng nhập)`);
  console.log("\n  Giữ cửa sổ này mở trong lúc mọi người dùng. Nhấn Ctrl+C để tắt.\n");
});

function shutdown() { try { store.flush(); } catch (e) { console.error(e); } process.exit(0); }
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
