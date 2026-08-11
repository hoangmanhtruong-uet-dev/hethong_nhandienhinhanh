from __future__ import annotations

import base64
import io
import json
import time

import httpx
from fastapi import UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError

from .config import get_settings
from .schemas import AdvancedAnalysisContent, AdvancedAnalysisResponse


ALLOWED_MIME_TYPES = {"image/jpeg", "image/png", "image/webp"}
ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}


class GeminiError(RuntimeError):
    pass


class GeminiNotConfiguredError(GeminiError):
    pass


class GeminiQuotaError(GeminiError):
    pass


class GeminiUpstreamError(GeminiError):
    pass


async def prepare_image(upload: UploadFile) -> tuple[bytes, str]:
    settings = get_settings()
    if upload.content_type not in ALLOWED_MIME_TYPES:
        raise ValueError("Chỉ hỗ trợ ảnh JPEG, PNG và WebP.")

    max_bytes = settings.max_upload_mb * 1024 * 1024
    chunks: list[bytes] = []
    total = 0
    try:
        while chunk := await upload.read(1024 * 1024):
            total += len(chunk)
            if total > max_bytes:
                raise ValueError(f"Ảnh vượt quá giới hạn {settings.max_upload_mb} MB.")
            chunks.append(chunk)
    finally:
        await upload.close()

    raw = b"".join(chunks)
    try:
        with Image.open(io.BytesIO(raw)) as source:
            if source.format not in ALLOWED_FORMATS:
                raise ValueError("Định dạng ảnh thực tế không được hỗ trợ.")
            width, height = source.size
            if width * height > settings.max_image_pixels:
                raise ValueError("Ảnh có quá nhiều pixel để phân tích an toàn.")
            source.verify()
        with Image.open(io.BytesIO(raw)) as source:
            image = ImageOps.exif_transpose(source).convert("RGB")
            image.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
            output = io.BytesIO()
            image.save(output, format="JPEG", quality=84, optimize=True)
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise ValueError("File ảnh bị hỏng hoặc sai định dạng.") from exc
    return output.getvalue(), "image/jpeg"


def _response_schema() -> dict:
    schema = AdvancedAnalysisContent.model_json_schema()
    schema.pop("title", None)
    # generateContent accepts only a subset of JSON Schema. Pydantic emits
    # string length constraints that Gemini currently rejects with HTTP 400,
    # while the same limits are still enforced when validating the response.
    def remove_unsupported(value: object) -> None:
        if isinstance(value, dict):
            value.pop("minLength", None)
            value.pop("maxLength", None)
            value.pop("default", None)
            for child in value.values():
                remove_unsupported(child)
        elif isinstance(value, list):
            for child in value:
                remove_unsupported(child)

    remove_unsupported(schema)
    return schema


async def analyze_with_gemini(image_bytes: bytes, mime_type: str) -> AdvancedAnalysisResponse:
    settings = get_settings()
    if not settings.gemini_api_key:
        raise GeminiNotConfiguredError("Gemini chưa được cấu hình.")

    prompt = (
        "Phân tích chính xác ảnh này và trả lời hoàn toàn bằng tiếng Việt. "
        "Không đoán thương hiệu, model, địa điểm hay danh tính nếu không có bằng chứng nhìn thấy rõ. "
        "primary_label phải là tên ngắn gọn, cụ thể của chủ thể chính. description gồm 1-3 câu hữu ích. "
        "Liệt kê tối đa 20 vật thể nổi bật; box_2d có thứ tự [ymin,xmin,ymax,xmax], chuẩn hóa 0..1000. "
        "visible_text chỉ chứa chữ thực sự đọc được. suggested_actions là hành động hữu ích, không quảng cáo."
    )
    body = {
        "contents": [{
            "role": "user",
            "parts": [
                {"text": prompt},
                {"inline_data": {"mime_type": mime_type, "data": base64.b64encode(image_bytes).decode("ascii")}},
            ],
        }],
        "generationConfig": {
            "maxOutputTokens": 1400,
            "responseFormat": {
                "text": {
                    "mimeType": "application/json",
                    "schema": _response_schema(),
                },
            },
        },
    }
    started = time.perf_counter()
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{settings.gemini_model}:generateContent"
    try:
        async with httpx.AsyncClient(timeout=settings.gemini_timeout_seconds) as client:
            response = await client.post(
                url,
                headers={"x-goog-api-key": settings.gemini_api_key, "Content-Type": "application/json"},
                json=body,
            )
    except httpx.TimeoutException as exc:
        raise GeminiUpstreamError("Gemini phản hồi quá chậm.") from exc
    except httpx.HTTPError as exc:
        raise GeminiUpstreamError("Không kết nối được Gemini.") from exc

    if response.status_code == 429:
        raise GeminiQuotaError("Gemini đã hết quota tạm thời.")
    if response.status_code >= 400:
        raise GeminiUpstreamError(f"Gemini từ chối yêu cầu ({response.status_code}).")

    try:
        payload = response.json()
        parts = payload["candidates"][0]["content"]["parts"]
        text = "".join(str(part.get("text", "")) for part in parts)
        content = AdvancedAnalysisContent.model_validate(json.loads(text))
    except (KeyError, IndexError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise GeminiUpstreamError("Gemini trả về kết quả không hợp lệ.") from exc

    return AdvancedAnalysisResponse(
        **content.model_dump(),
        model=settings.gemini_model,
        processing_time_ms=round((time.perf_counter() - started) * 1000),
    )
