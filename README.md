# Ngón Số

Ứng dụng nhận diện số ngón tay đang giơ từ 0 đến 10 bằng webcam, hỗ trợ tối đa hai bàn tay cùng lúc. MediaPipe chạy trực tiếp trong trình duyệt; hình ảnh camera không được gửi đến máy chủ. Giao diện có thể được cài như PWA trên iPhone.

## Yêu cầu

- Trình duyệt hiện đại có hỗ trợ camera và WebAssembly.
- Dùng `http://localhost` để thử trên cùng máy tính, hoặc HTTPS để cài PWA và dùng camera trên iPhone.
- Kết nối Internet lần đầu để tải thư viện MediaPipe và mô hình nhận diện. Khung hình webcam vẫn được xử lý cục bộ trên thiết bị.

## Cài đặt và chạy

Để chạy thử trên máy tính Windows, mở PowerShell trong thư mục dự án:

```powershell
py -3.10 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe .\app.py
```

Nếu project đã có môi trường `.venv`, dùng môi trường đó để cài các thư viện còn thiếu. Mở `http://127.0.0.1:8000` trong trình duyệt. Dừng máy chủ bằng `Ctrl+C`.

Việc nhận diện chạy trong trình duyệt; máy chủ Python chỉ phục vụ trang thử nghiệm, không nhận ảnh webcam.

## Cách sử dụng

1. Mở trang trên HTTPS hoặc localhost, sau đó bấm **Bật camera** và cho phép quyền truy cập webcam.
2. Đưa một hoặc hai bàn tay vào khung hình, lòng bàn tay hướng về camera và các ngón tay cách nhau vừa đủ.
3. Màn hình camera hiển thị trực tiếp tổng số ngón đang giơ (0–10); bên dưới còn có số đếm riêng của từng bàn tay và trạng thái từng ngón.

## Quyền riêng tư và giới hạn

MediaPipe tìm 21 điểm mốc trên mỗi bàn tay. Ứng dụng dùng độ thẳng, góc khớp và vị trí tương đối với lòng bàn tay để xác định từng ngón đang giơ hay đang gập; kết quả của tối đa hai bàn tay được cộng lại. Đây là bộ đếm ngón tay, không nhận dạng ngôn ngữ ký hiệu hay các ký hiệu số đặc biệt.

Hình ảnh và việc nhận diện được xử lý trực tiếp trên thiết bị, không tải ảnh camera lên server. Ứng dụng cần Internet để tải thư viện và mô hình nhận diện. Độ chính xác phụ thuộc vào ánh sáng, góc bàn tay và việc các ngón có bị che khuất hay không.

## Đưa lên GitHub Pages miễn phí và cài trên iPhone

Ứng dụng là nội dung tĩnh và có thể được host miễn phí trên GitHub Pages cho repository công khai. Workflow tự động xuất bản đã được thêm vào dự án:

1. Trong repository, mở **Settings → Pages**, đặt **Source** thành **GitHub Actions**, rồi lưu. Đây là thao tác cần làm một lần vì GitHub không cho workflow tự bật Pages trong repository này.
2. Đưa các tệp ứng dụng mới nhất lên nhánh `main`; workflow **Deploy PWA to GitHub Pages** sẽ tự xuất bản.
3. Trong **Actions**, chờ workflow chạy thành công rồi mở URL HTTPS dạng `https://<tên-tài-khoản>.github.io/<tên-repository>/` bằng Safari trên iPhone.
4. Chọn **Chia sẻ → Thêm vào MH chính**.

Không cần Google Cloud, máy chủ chạy liên tục, thẻ thanh toán hay App Store. Lần đầu cần Internet để tải MediaPipe và mô hình; trình duyệt lưu các tệp này để có thể dùng lại. Camera được xử lý trên iPhone.

Biểu tượng ứng dụng được thiết kế riêng theo hình bàn tay đếm ngón và dùng nhất quán cho PWA lẫn iPhone.
