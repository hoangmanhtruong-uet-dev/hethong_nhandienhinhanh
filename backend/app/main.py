from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .api import router
from .auth import router as auth_router
from .config import get_settings
from .database import init_db


settings = get_settings()
frontend_dist = Path(__file__).resolve().parents[2] / "dist"


@asynccontextmanager
async def lifespan(_app: FastAPI):
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    init_db()
    yield


app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
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


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
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


@app.get("/style.css", include_in_schema=False)
def frontend_styles() -> FileResponse:
    return FileResponse(frontend_dist / "style.css", media_type="text/css")


@app.get("/script.js", include_in_schema=False)
def frontend_script() -> FileResponse:
    return FileResponse(frontend_dist / "script.js", media_type="application/javascript")


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
