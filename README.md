# Tính công

Công cụ tính công từ file Excel xuất ra từ 2 máy chấm công (sản xuất và văn phòng). Một máy trong công ty chạy server; các máy khác trong cùng mạng LAN mở trình duyệt vào `http://<IP máy chủ>:3000` để dùng chung.

- Nạp file Excel của 2 máy chấm công, tự ghép theo mã nhân viên và ngày.
- Cảnh báo dòng thiếu giờ vào/ra, ngày vắng chưa có lý do; nhân sự sửa trực tiếp trên bảng. Mỗi ô sửa được lưu ngay kèm tên người sửa và thời điểm sửa.
- Nhiều người dùng cùng lúc: mỗi máy tự cập nhật thay đổi của người khác sau tối đa 15 giây.
- Xuất bảng công chi tiết cho từng nhân viên (ZIP mỗi người 1 file .xlsx), file tổng hợp, và danh sách cần bổ sung.
- Phân quyền: **Quản trị** (đổi quy tắc tính công, quản lý tài khoản, xoá kỳ công), **Nhân sự** (nạp file, sửa giờ, xuất file), **Chỉ xem** (xem, xuất file).

## Cài trên máy làm server (Windows)

1. Cài **Node.js bản LTS** từ https://nodejs.org (bản 20 trở lên).
2. Tải mã nguồn: `git clone https://github.com/tuanqt98/tinhcong.git`, hoặc tải ZIP trên GitHub rồi giải nén.
3. Bấm đúp **`start-server.bat`**. Lần đầu, file này tự chạy `npm install` để tải thư viện đọc/ghi Excel về máy, nên cần Internet một lần. Sau đó server vẫn chạy được khi mạng LAN không có Internet.
4. Cửa sổ hiện ra địa chỉ truy cập, ví dụ:

   ```
   Trên máy này:      http://localhost:3000
   Máy khác trong LAN: http://192.168.1.25:3000
   Đăng nhập lần đầu: admin / xxxxxxxx
   ```

   Mật khẩu admin lần đầu được tạo ngẫu nhiên và ghi vào `data/TAI-KHOAN-ADMIN-LAN-DAU.txt`. Đăng nhập xong, bấm **Tài khoản** để đổi mật khẩu và tạo tài khoản cho nhân sự, rồi xoá file đó.
5. **Mở tường lửa** để máy khác vào được. Chạy một lần trong PowerShell với quyền Administrator:

   ```powershell
   New-NetFirewallRule -DisplayName "Tinh cong 3000" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -Profile Private,Domain
   ```

   Nếu Windows tự hỏi "Allow access" khi chạy lần đầu, chọn **Private networks**.

Giữ cửa sổ server mở trong lúc mọi người dùng. Tắt bằng `Ctrl+C`.

### Nên làm thêm

- **Đặt IP tĩnh cho máy server** (trong router hoặc cài đặt mạng của Windows), để địa chỉ không đổi sau khi khởi động lại.
- **Tự chạy khi bật máy**: tạo shortcut tới `start-server.bat` trong thư mục `shell:startup`, hoặc dùng Task Scheduler (trigger "At log on").
- Đổi cổng: `set PORT=8080` trước khi chạy `node server.js`.

## Dữ liệu và sao lưu

- Toàn bộ dữ liệu nằm trong thư mục **`data/`** cạnh `server.js`: `db.json` (tài khoản, kỳ công, các chỉnh sửa, cấu hình) và `backup/db-YYYY-MM-DD.json` (tự sao lưu mỗi ngày, giữ 60 bản gần nhất).
- `data/` **không** được đưa lên Git, vì có dữ liệu nhân viên và mật khẩu đã băm. Nên chép định kỳ thư mục này sang ổ khác hoặc ổ mạng.
- Khôi phục: tắt server, chép bản backup đè lên `data/db.json`, chạy lại server.
- Khi nạp lại file của cùng tháng, các ô nhân sự đã sửa vẫn được giữ và ưu tiên hơn dữ liệu file.

## Quy tắc tính công mặc định

Xem và chỉnh trong mục **Quy tắc tính công và cài đặt** trên giao diện (chỉ tài khoản Quản trị). Thay đổi được lưu trên server và áp dụng cho mọi người.

| | Ngày thường | Chủ nhật | Đi muộn |
|---|---|---|---|
| Ca ngày SX 07:00–16:00 (nghỉ 11–12h) | 8h đầu 100%, sau 16:00 tăng ca 150% | toàn bộ 200% | từ 08:01, tính 1 lượt |
| Ca đêm SX 19:00–07:00 (nghỉ 23–24h) | 4h 100%, 4h 130%, sau 04:00 tăng ca 210% | toàn bộ 230% | từ 22:01, tính 1 lượt |
| Hành chính VP 08:00–17:00 (nghỉ 12–13h) | 8h 100%, sau 17:00 tăng ca 150% | toàn bộ 200% | từ 08:01, tính 1 lượt |

- Phút lẻ sau số giờ chẵn: dưới 30 phút thì bỏ, từ 30 phút tính đúng số phút. Ví dụ ra 14:20 tính đến 14:00, ra 14:40 tính đến 14:40.
- Tăng ca dưới 30 phút trong ngày không được tính.
- Đi muộn chỉ đếm lượt, không trừ giờ công. Đến trước giờ vào ca thì không tính thêm.
- Ngày lễ (cấu hình được) không đi làm thì tự ghi NL = 8h.

## Cấu trúc mã

```
server.js            máy chủ HTTP: phục vụ giao diện + API, in địa chỉ LAN
start-server.bat     chạy trên Windows (tự npm install lần đầu)
public/index.html    giao diện: đọc Excel (SheetJS), tính công, xuất .xlsx (tự ghi bằng JSZip)
api/*.js             login, logout, me, users, config, periods, period
api/_lib/core.js     phiên đăng nhập (cookie ký HMAC), băm mật khẩu (scrypt), phân quyền
api/_lib/store.js    lưu dữ liệu vào data/db.json, sao lưu hằng ngày
```

Server không dùng thư viện npm nào. `npm install` chỉ tải 2 thư viện chạy trong trình duyệt (SheetJS, JSZip) để phục vụ khi LAN không có Internet; thiếu thì trình duyệt tự tải từ CDN.

Mở thẳng `public/index.html` bằng trình duyệt (không qua server) thì công cụ chạy chế độ offline một người dùng, dữ liệu lưu trong trình duyệt.
