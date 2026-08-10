# Vision AI FastAPI Backend

Backend MVP cho giao diện Vision AI. TensorFlow.js vẫn nhận diện trên thiết bị; backend nhận ảnh và kết quả để quản lý lịch sử, bộ sưu tập, chỉnh nhãn và cài đặt.

## Chạy local

```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
uvicorn app.main:app --reload
```

- API: `http://127.0.0.1:8000/api`
- Swagger: `http://127.0.0.1:8000/docs`
- Health check: `http://127.0.0.1:8000/api/health`

SQLite được lưu ở `backend/data/vision_ai.db`; ảnh ở `backend/data/uploads`. Hai đường dẫn có thể đổi bằng `.env`.

## Tạo một kết quả quét

`POST /api/scans` dùng `multipart/form-data`:

- `file`: JPEG, PNG hoặc WebP, tối đa 15 MB và 20 megapixel.
- `metadata`: chuỗi JSON.

```json
{
  "primary_label": "mechanical keyboard",
  "confidence": 0.97,
  "description": "Bàn phím cơ với switch tùy chỉnh",
  "predictions": [{"className": "keyboard", "probability": 0.97}],
  "detections": [{"class": "keyboard", "score": 0.94, "bbox": [10, 20, 300, 180]}],
  "model_version": "MobileNet + COCO-SSD",
  "processing_time_ms": 180
}
```

## API chính

- `POST/GET /api/scans`: lưu và tìm lịch sử quét.
- `GET/PATCH/DELETE /api/scans/{id}`: chi tiết, chỉnh nhãn, yêu thích, xác nhận và xóa.
- `GET /api/scans/{id}/image`: lấy ảnh.
- `GET /api/scans/{id}/export?format=json|csv`: xuất kết quả.
- `POST/GET /api/collections`: tạo và liệt kê bộ sưu tập.
- `POST /api/collections/{id}/items`: thêm ảnh vào bộ sưu tập.
- `POST /api/feedback`: xác nhận hoặc sửa nhãn AI.
- `GET/PUT /api/settings/privacy`: lưu cài đặt quyền riêng tư và theme.
- `DELETE /api/scans`: xóa toàn bộ lịch sử cùng file ảnh.

## Kiểm thử

```powershell
pytest -q
```

Backend hiện là chế độ một người dùng, phù hợp MVP/local. Trước khi đưa lên Internet cần bổ sung đăng nhập, phân quyền, migration Alembic, object storage và PostgreSQL.
