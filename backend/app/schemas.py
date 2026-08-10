from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class RegisterRequest(BaseModel):
    email: EmailStr
    display_name: str = Field(min_length=2, max_length=120)
    password: str = Field(min_length=8, max_length=128)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)
    remember: bool = False


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: EmailStr
    display_name: str
    role: str
    created_at: datetime


class AuthResponse(BaseModel):
    user: UserResponse


class SessionResponse(BaseModel):
    id: str
    user_agent: str
    ip_address: str
    created_at: datetime
    last_seen_at: datetime
    expires_at: datetime
    current: bool = False


class APIKeyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class APIKeyResponse(BaseModel):
    id: str
    name: str
    prefix: str
    created_at: datetime
    last_used_at: datetime | None = None


class APIKeyCreatedResponse(APIKeyResponse):
    key: str


class TeamMemberResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: EmailStr
    display_name: str
    role: str
    is_active: bool
    created_at: datetime


class UserRoleUpdate(BaseModel):
    role: Literal["owner", "admin", "member", "viewer"]


class ScanCreate(BaseModel):
    primary_label: str = Field(min_length=1, max_length=255)
    confidence: float = Field(ge=0, le=1)
    description: str = Field(default="", max_length=5000)
    predictions: list[dict[str, Any]] = Field(default_factory=list)
    detections: list[dict[str, Any]] = Field(default_factory=list)
    model_version: str = Field(default="TensorFlow.js", max_length=100)
    processing_time_ms: int = Field(default=0, ge=0, le=3_600_000)
    confirmed: bool = False
    favorite: bool = False


class ScanUpdate(BaseModel):
    primary_label: str | None = Field(default=None, min_length=1, max_length=255)
    confidence: float | None = Field(default=None, ge=0, le=1)
    description: str | None = Field(default=None, max_length=5000)
    predictions: list[dict[str, Any]] | None = None
    detections: list[dict[str, Any]] | None = None
    confirmed: bool | None = None
    favorite: bool | None = None


class ScanResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    file_name: str
    image_url: str
    mime_type: str
    file_size: int
    width: int
    height: int
    primary_label: str
    confidence: float
    description: str
    predictions: list[dict[str, Any]]
    detections: list[dict[str, Any]]
    model_version: str
    processing_time_ms: int
    confirmed: bool
    favorite: bool
    created_at: datetime
    updated_at: datetime


class ScanPage(BaseModel):
    items: list[ScanResponse]
    total: int
    page: int
    page_size: int


class CollectionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=1000)
    color: str = Field(default="#7c6cff", pattern=r"^#[0-9a-fA-F]{6}$")

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        return " ".join(value.split())


class CollectionUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=1000)
    color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")


class CollectionResponse(BaseModel):
    id: str
    name: str
    description: str
    color: str
    item_count: int
    cover_image_url: str | None = None
    created_at: datetime
    updated_at: datetime


class AddScanRequest(BaseModel):
    scan_id: str


class FeedbackCreate(BaseModel):
    scan_id: str | None = None
    feedback_type: Literal["confirm", "incorrect_label", "bug", "general"]
    original_label: str = Field(default="", max_length=255)
    corrected_label: str = Field(default="", max_length=255)
    message: str = Field(default="", max_length=5000)


class FeedbackResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    scan_id: str | None
    feedback_type: str
    original_label: str
    corrected_label: str
    message: str
    created_at: datetime


class PrivacySettingsUpdate(BaseModel):
    save_history: bool | None = None
    share_analytics: bool | None = None
    local_processing_preferred: bool | None = None
    theme: Literal["dark", "light", "system"] | None = None


class PrivacySettingsResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    save_history: bool
    share_analytics: bool
    local_processing_preferred: bool
    theme: str
    updated_at: datetime


class MessageResponse(BaseModel):
    message: str
