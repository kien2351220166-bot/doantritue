# Ngón Số

Ứng dụng web nhận diện số ngón tay đang giơ từ 0 đến 10 bằng webcam, hỗ trợ tối đa hai bàn tay cùng lúc. Sau khi được cấp quyền, trình duyệt gửi từng khung hình đến máy chủ Python chạy cục bộ. MediaPipe phát hiện các điểm khớp bàn tay; ứng dụng phân tích trạng thái từng ngón, rồi cộng số ngón đang giơ của các bàn tay. Khung hình chỉ được xử lý trong bộ nhớ, không ghi vào đĩa hoặc gửi đến dịch vụ mạng.

## Yêu cầu

- Windows 10/11, Python 3.10 hoặc 3.11 64-bit.
- Webcam được hệ điều hành nhận diện.
- Trình duyệt Chrome hoặc Edge hỗ trợ webcam trên địa chỉ localhost.

## Cài đặt và chạy

Mở PowerShell trong thư mục dự án:

```powershell
py -3.10 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe .\app.py
```

Nếu project đã có môi trường `.venv`, dùng môi trường đó để cài các thư viện còn thiếu. Mở `http://127.0.0.1:8000` trong trình duyệt. Dừng máy chủ bằng `Ctrl+C`.

## Cách sử dụng

1. Mở trang qua `http://127.0.0.1:8000`, sau đó bấm **Bật camera** và cho phép trang truy cập webcam. Chrome/Edge cho phép camera trên localhost.
2. Đưa một hoặc hai bàn tay vào khung hình, lòng bàn tay hướng về camera và các ngón tay cách nhau vừa đủ.
3. Màn hình camera hiển thị trực tiếp tổng số ngón đang giơ (0–10); bên dưới còn có số đếm riêng của từng bàn tay và trạng thái từng ngón.

## Cách nhận diện và giới hạn

MediaPipe tìm 21 điểm mốc trên mỗi bàn tay. Ứng dụng dùng độ thẳng, góc khớp và vị trí tương đối với lòng bàn tay để xác định từng ngón đang giơ hay đang gập. Bộ phân loại Decision Tree ánh xạ trạng thái năm ngón thành số ngón trên mỗi bàn tay; kết quả của tối đa hai bàn tay được cộng lại. Đây là bộ đếm ngón tay, không nhận dạng ngôn ngữ ký hiệu hay các ký hiệu số đặc biệt.

Độ chính xác phụ thuộc vào ánh sáng, góc bàn tay và việc các ngón có bị che khuất hay không. Hãy hướng lòng bàn tay về camera và giữ bàn tay trong khung hình. Khi kết nối đến bộ nhận diện gặp lỗi tạm thời, ứng dụng sẽ tự thử lại mà không tắt camera. Máy chủ chỉ lắng nghe trên `127.0.0.1` và cung cấp giao diện cùng API nhận diện/trạng thái.
