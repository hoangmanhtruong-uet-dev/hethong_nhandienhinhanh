from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.exc import SQLAlchemyError

from .api import router
from .auth import router as auth_router
from .config import get_settings
from .resilience import rate_limit_retry_after


settings = get_settings()
frontend_dist = Path(__file__).resolve().parents[2] / "dist"
logger = logging.getLogger("vision_ai")


def error_response(request: Request, status_code: int, detail: object, code: str, headers: dict | None = None) -> JSONResponse:
    request_id = getattr(request.state, "request_id", uuid4().hex)
    return JSONResponse(
        status_code=status_code,
        content={"detail": detail, "code": code, "request_id": request_id},
        headers={**(headers or {}), "X-Request-ID": request_id},
    )


@asynccontextmanager
async def lifespan(_app: FastAPI):
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    yield


app = FastAPI(
    title=settings.app_name,
    version="1.1.0",
    description="Backend lưu lịch sử, bộ sưu tập và phản hồi cho ứng dụng Vision AI.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=settings.cors_origins != ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router, prefix=settings.api_prefix)
app.include_router(auth_router, prefix=settings.api_prefix)


@app.exception_handler(HTTPException)
async def http_error(request: Request, exc: HTTPException) -> JSONResponse:
    return error_response(request, exc.status_code, exc.detail, f"http_{exc.status_code}", dict(exc.headers or {}))


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
    return error_response(request, 422, exc.errors(), "validation_error")


@app.exception_handler(SQLAlchemyError)
async def database_error(request: Request, exc: SQLAlchemyError) -> JSONResponse:
    logger.exception("Database failure request_id=%s", getattr(request.state, "request_id", "unknown"), exc_info=exc)
    return error_response(request, 503, "Cơ sở dữ liệu tạm thời không phản hồi. Vui lòng thử lại.", "database_unavailable", {"Retry-After": "10"})


@app.exception_handler(Exception)
async def unexpected_error(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled failure request_id=%s", getattr(request.state, "request_id", "unknown"), exc_info=exc)
    return error_response(request, 500, "Máy chủ gặp lỗi ngoài dự kiến.", "internal_error")


@app.middleware("http")
async def security_headers(request: Request, call_next):
    request.state.request_id = uuid4().hex
    retry_after = rate_limit_retry_after(request)
    if retry_after is not None:
        return error_response(
            request, 429, "Hệ thống đang nhận quá nhiều yêu cầu. Vui lòng thử lại sau.",
            "rate_limited", {"Retry-After": str(retry_after)},
        )
    try:
        response = await asyncio.wait_for(call_next(request), timeout=settings.api_timeout_seconds)
    except TimeoutError:
        return error_response(
            request, 504, "Máy chủ xử lý quá thời gian cho phép. Vui lòng thử lại.",
            "request_timeout", {"Retry-After": "5"},
        )
    response.headers["X-Request-ID"] = request.state.request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "camera=(self), microphone=()"
    if request.url.path.startswith(f"{settings.api_prefix}/auth"):
        response.headers["Cache-Control"] = "no-store"
    if request.url.scheme == "https" or request.headers.get("x-forwarded-proto", "").startswith("https"):
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response

if (frontend_dist.is_dir()):
    app.mount("/assets", StaticFiles(directory=frontend_dist / "assets"), name="frontend-assets")
    if (frontend_dist / "vendor").is_dir():
        app.mount("/vendor", StaticFiles(directory=frontend_dist / "vendor"), name="frontend-vendor")


@app.get("/style.css", include_in_schema=False)
def frontend_styles() -> FileResponse:
    return FileResponse(frontend_dist / "style.css", media_type="text/css")


@app.get("/script.js", include_in_schema=False)
def frontend_script() -> FileResponse:
    return FileResponse(frontend_dist / "script.js", media_type="application/javascript")


@app.get("/yolo-runtime.js", include_in_schema=False)
def frontend_yolo_runtime() -> FileResponse:
    return FileResponse(frontend_dist / "yolo-runtime.js", media_type="application/javascript")


@app.get("/manifest.webmanifest", include_in_schema=False)
def frontend_manifest() -> FileResponse:
    return FileResponse(frontend_dist / "manifest.webmanifest", media_type="application/manifest+json")


@app.get("/sw.js", include_in_schema=False)
def frontend_service_worker() -> FileResponse:
    return FileResponse(
        frontend_dist / "sw.js",
        media_type="application/javascript",
        headers={"Service-Worker-Allowed": "/", "Cache-Control": "no-cache"},
    )


@app.get("/favicon.ico", include_in_schema=False)
def frontend_favicon() -> FileResponse:
    return FileResponse(frontend_dist / "assets" / "icons" / "icon-192.png", media_type="image/png")


@app.get("/", include_in_schema=False)
def root():
    index = frontend_dist / "index.html"
    if index.is_file():
        return FileResponse(index, media_type="text/html")
    return {"name": settings.app_name, "docs": "/docs", "health": f"{settings.api_prefix}/health"}
