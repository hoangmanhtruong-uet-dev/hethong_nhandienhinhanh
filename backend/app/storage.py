from __future__ import annotations

import asyncio
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote, urlparse
from uuid import uuid4

import aiofiles
import cloudinary
import cloudinary.uploader
import cloudinary.utils
from fastapi import HTTPException, UploadFile, status
from PIL import Image, UnidentifiedImageError

from .config import get_settings


ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}
FORMAT_INFO = {
    "JPEG": (".jpg", "image/jpeg"),
    "PNG": (".png", "image/png"),
    "WEBP": (".webp", "image/webp"),
}


@dataclass(frozen=True)
class StoredImage:
    stored_name: str
    original_name: str
    mime_type: str
    file_size: int
    width: int
    height: int


def cloudinary_enabled() -> bool:
    return bool(get_settings().cloudinary_url)


def configure_cloudinary() -> None:
    settings = get_settings()
    if settings.cloudinary_url:
        parsed = urlparse(settings.cloudinary_url)
        if parsed.scheme != "cloudinary" or not parsed.hostname or not parsed.username or not parsed.password:
            raise RuntimeError("VISION_AI_CLOUDINARY_URL không đúng định dạng cloudinary://API_KEY:API_SECRET@CLOUD_NAME")
        cloudinary.config(
            cloud_name=parsed.hostname,
            api_key=unquote(parsed.username),
            api_secret=unquote(parsed.password),
            secure=True,
        )


def _cloud_reference(public_id: str, image_format: str) -> str:
    return f"cld:{public_id}|{image_format.lower()}"


def _parse_cloud_reference(stored_name: str) -> tuple[str, str] | None:
    if not stored_name.startswith("cld:"):
        return None
    reference = stored_name[4:]
    public_id, separator, image_format = reference.rpartition("|")
    if not separator or not public_id or not image_format:
        return None
    return public_id, image_format


async def save_image(upload: UploadFile, owner_id: str | None = None) -> StoredImage:
    settings = get_settings()
    if upload.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Chỉ hỗ trợ ảnh JPEG, PNG và WebP.",
        )

    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    temp_path = settings.upload_dir / f".{uuid4()}.upload"
    max_bytes = settings.max_upload_mb * 1024 * 1024
    total = 0

    try:
        async with aiofiles.open(temp_path, "wb") as destination:
            while chunk := await upload.read(1024 * 1024):
                total += len(chunk)
                if total > max_bytes:
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail=f"Ảnh vượt quá giới hạn {settings.max_upload_mb} MB.",
                    )
                await destination.write(chunk)

        try:
            with Image.open(temp_path) as image:
                image_format = image.format
                width, height = image.size
                image.verify()
        except (UnidentifiedImageError, OSError, ValueError) as exc:
            raise HTTPException(status_code=400, detail="File ảnh bị hỏng hoặc sai định dạng.") from exc

        if image_format not in FORMAT_INFO:
            raise HTTPException(status_code=415, detail="Định dạng ảnh thực tế không được hỗ trợ.")
        if width * height > settings.max_image_pixels:
            raise HTTPException(
                status_code=413,
                detail=f"Ảnh quá lớn ({width}×{height}); giới hạn {settings.max_image_pixels} pixel.",
            )

        extension, mime_type = FORMAT_INFO[image_format]
        if cloudinary_enabled():
            configure_cloudinary()
            public_id = f"{settings.cloudinary_folder}/{owner_id or 'anonymous'}/{uuid4()}"
            try:
                result = await asyncio.to_thread(
                    cloudinary.uploader.upload,
                    str(temp_path),
                    public_id=public_id,
                    resource_type="image",
                    type="authenticated",
                    overwrite=False,
                )
            except Exception as exc:
                raise HTTPException(status_code=502, detail="Không thể tải ảnh lên Cloudinary.") from exc
            stored_name = _cloud_reference(result["public_id"], result.get("format") or image_format)
            temp_path.unlink(missing_ok=True)
        else:
            stored_name = f"{uuid4()}{extension}"
            final_path = settings.upload_dir / stored_name
            temp_path.replace(final_path)
        return StoredImage(
            stored_name=stored_name,
            original_name=Path(upload.filename or "image").name[:255],
            mime_type=mime_type,
            file_size=total,
            width=width,
            height=height,
        )
    except Exception:
        temp_path.unlink(missing_ok=True)
        raise
    finally:
        await upload.close()


def image_path(stored_name: str) -> Path:
    if _parse_cloud_reference(stored_name):
        raise HTTPException(status_code=409, detail="Ảnh này được lưu trên Cloudinary.")
    path = get_settings().upload_dir / Path(stored_name).name
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Không tìm thấy file ảnh.")
    return path


def delete_image(stored_name: str) -> None:
    cloud_reference = _parse_cloud_reference(stored_name)
    if cloud_reference:
        configure_cloudinary()
        public_id, _image_format = cloud_reference
        cloudinary.uploader.destroy(public_id, resource_type="image", type="authenticated", invalidate=True)
        return
    (get_settings().upload_dir / Path(stored_name).name).unlink(missing_ok=True)


def image_delivery_url(stored_name: str) -> str | None:
    cloud_reference = _parse_cloud_reference(stored_name)
    if not cloud_reference:
        return None
    configure_cloudinary()
    public_id, image_format = cloud_reference
    url, _options = cloudinary.utils.cloudinary_url(
        public_id,
        resource_type="image",
        type="authenticated",
        format=image_format,
        sign_url=True,
        secure=True,
    )
    return url
