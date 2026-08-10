# Chạy Vision AI hoàn chỉnh

## 1. Chạy backend

Mở PowerShell thứ nhất:

```powershell
cd D:\JavaProjects\My_project\Hethong_nhandien_hinhanh\backend
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --reload --host 0.0.0.0
```

Swagger: <http://127.0.0.1:8000/docs>

## 2. Build frontend

Mở PowerShell thứ hai:

```powershell
cd D:\JavaProjects\My_project\Hethong_nhandien_hinhanh
npm run build
```

Mở <http://127.0.0.1:8000>. FastAPI phục vụ cả UI và API.

Trên điện thoại cùng Wi-Fi, mở `http://IP-MAY-TINH:8000`. Camera trên điện thoại chỉ hoạt động khi trang dùng HTTPS; upload ảnh vẫn dùng được qua HTTP nội bộ.

## 17 màn hình

Menu góc trái trong ứng dụng cho phép mở trực tiếp toàn bộ 17 màn UI. Các route dùng dạng `#/scanner`, `#/history`, `#/collections`, `#/settings` và các state tương ứng.
