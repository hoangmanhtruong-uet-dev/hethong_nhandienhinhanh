from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Annotated
from urllib.parse import urlparse

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


BACKEND_DIR = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    app_name: str = "Vision AI API"
    environment: str = "development"
    public_app_url: str = "http://localhost:8000"
    api_prefix: str = "/api"
    database_url: str = f"sqlite:///{(BACKEND_DIR / 'data' / 'vision_ai.db').as_posix()}"
    upload_dir: Path = BACKEND_DIR / "data" / "uploads"
    max_upload_mb: int = Field(default=15, ge=1, le=100)
    max_image_pixels: int = Field(default=20 * 1024 * 1024, ge=1_000_000)
    cors_origins: Annotated[list[str], NoDecode] = ["*"]
    session_cookie_name: str = "vision_session"
    session_hours: int = Field(default=24, ge=1, le=168)
    remember_session_days: int = Field(default=30, ge=1, le=90)
    encryption_key: str | None = None
    cloudinary_url: str | None = Field(
        default=None,
        validation_alias=AliasChoices("VISION_AI_CLOUDINARY_URL", "CLOUDINARY_URL"),
    )
    cloudinary_folder: str = "vision-ai"
    require_cloudinary: bool = False
    smtp_host: str | None = None
    smtp_port: int = Field(default=587, ge=1, le=65535)
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_from_email: str = "Vision AI <no-reply@vision-ai.local>"
    smtp_starttls: bool = True
    require_smtp: bool = False
    resend_api_key: str | None = None
    require_email_provider: bool = False
    account_token_minutes: int = Field(default=30, ge=5, le=1440)
    gemini_api_key: str | None = None
    gemini_model: str = Field(default="gemini-3.5-flash", pattern=r"^[A-Za-z0-9._-]+$")
    gemini_timeout_seconds: int = Field(default=35, ge=5, le=120)
    gemini_requests_per_hour: int = Field(default=20, ge=1, le=200)
    api_timeout_seconds: int = Field(default=60, ge=10, le=180)
    api_requests_per_minute: int = Field(default=300, ge=30, le=5000)
    upload_requests_per_minute: int = Field(default=30, ge=5, le=500)

    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env",
        env_prefix="VISION_AI_",
        extra="ignore",
    )

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @field_validator("database_url")
    @classmethod
    def normalize_database_url(cls, value: str) -> str:
        if value.startswith("postgres://"):
            value = value.replace("postgres://", "postgresql+psycopg://", 1)
        elif value.startswith("postgresql://"):
            value = value.replace("postgresql://", "postgresql+psycopg://", 1)
        if value.startswith("postgresql+psycopg://") and urlparse(value).hostname in {"host", "your_aiven_host"}:
            raise ValueError("Hãy thay HOST bằng hostname thật trong Aiven Service URI.")
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()
