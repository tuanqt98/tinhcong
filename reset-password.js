#!/usr/bin/env node
// Đặt lại mật khẩu khi quên — chạy trên máy server (người có quyền vào máy server mới làm được).
//   node reset-password.js                    → liệt kê tài khoản
//   node reset-password.js <tên đăng nhập>    → đặt mật khẩu ngẫu nhiên mới, mở khoá tài khoản
//   node reset-password.js <tên> <mật khẩu>   → đặt mật khẩu chỉ định
// Tên đăng nhập chưa tồn tại sẽ được tạo mới với vai trò Quản trị.
// Phải TẮT server trước khi chạy, vì server giữ dữ liệu trong bộ nhớ và sẽ ghi đè thay đổi.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const store = require("./api/_lib/store");
const { hashPassword, normUsername } = require("./api/_lib/core");

function fail(msg) { console.error("\n✗ " + msg + "\n"); process.exit(1); }

const pidFile = path.join(store.DATA_DIR, ".server.pid");
if (fs.existsSync(pidFile)) {
  const pid = Number(fs.readFileSync(pidFile, "utf8"));
  let running = false;
  try { process.kill(pid, 0); running = true; } catch (e) { running = e.code === "EPERM"; }
  if (running) fail("Server đang chạy (PID " + pid + "). Tắt cửa sổ server (Ctrl+C) rồi chạy lại lệnh này.");
}

const [, , rawUser, rawPw] = process.argv;
const all = store.exec(["HGETALL", "tc:users"]);
const users = [];
for (let i = 0; i < all.length; i += 2) users.push(JSON.parse(all[i + 1]));

if (!rawUser) {
  console.log("\nCác tài khoản hiện có:");
  if (!users.length) console.log("  (chưa có tài khoản nào)");
  for (const u of users) console.log(`  ${u.username.padEnd(20)} ${u.role.padEnd(7)} ${u.disabled ? "ĐANG KHOÁ " : ""}${u.name || ""}`);
  console.log("\nĐặt lại mật khẩu:  node reset-password.js <tên đăng nhập> [mật khẩu mới]\n");
  process.exit(0);
}

let username;
try { username = normUsername(rawUser); } catch (e) { fail(e.message); }
const password = rawPw || crypto.randomBytes(6).toString("base64url");
if (password.length < 8) fail("Mật khẩu phải có ít nhất 8 ký tự.");

const existing = users.find(u => u.username === username);
const rec = existing
  ? { ...existing, ...hashPassword(password), disabled: false, updatedAt: new Date().toISOString(), updatedBy: "reset-password" }
  : { username, name: "Quản trị", role: "admin", ...hashPassword(password), createdAt: new Date().toISOString(), createdBy: "reset-password" };
store.exec(["HSET", "tc:users", username, JSON.stringify(rec)]);
store.exec(["DEL", "tc:fail:" + username]);   // gỡ khoá do đăng nhập sai nhiều lần
store.flush();

console.log(`\n✓ ${existing ? "Đã đặt lại mật khẩu" : "Đã tạo tài khoản quản trị"} cho: ${username}${existing ? " (" + existing.role + ")" : ""}`);
console.log(`  Mật khẩu mới: ${password}`);
console.log("  Chạy lại server, đăng nhập rồi đổi mật khẩu trong mục Tài khoản.\n");
