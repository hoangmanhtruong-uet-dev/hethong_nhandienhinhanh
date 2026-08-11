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
    two_factor_enabled: bool
    email_verified_at: datetime | None = None
    created_at: datetime


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=10, max_length=128)


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str = Field(min_length=32, max_length=256)
    new_password: str = Field(min_length=10, max_length=128)


class TokenRequest(BaseModel):
    token: str = Field(min_length=32, max_length=256)


class TokenDispatchResponse(BaseModel):
    message: str
    debug_token: str | None = None


class DeleteAccountRequest(BaseModel):
    password: str = Field(min_length=1, max_length=128)
    confirmation: Literal["DELETE"]


class AuthResponse(BaseModel):
    user: UserResponse | None = None
    requires_2fa: bool = False
    challenge_token: str | None = None


class TwoFactorCodeRequest(BaseModel):
    code: str = Field(min_length=6, max_length=20)


class TwoFactorLoginRequest(TwoFactorCodeRequest):
    challenge_token: str


class TwoFactorEnableRequest(TwoFactorCodeRequest):
    setup_token: str


class TwoFactorDisableRequest(TwoFactorCodeRequest):
    password: str = Field(min_length=1, max_length=128)


class TwoFactorRecoveryRegenerateRequest(TwoFactorCodeRequest):
    password: str = Field(min_length=1, max_length=128)


class TwoFactorSetupResponse(BaseModel):
    setup_token: str
    secret: str
    qr_data_url: str


class TwoFactorEnableResponse(BaseModel):
    user: UserResponse
    recovery_codes: list[str]


class TwoFactorRecoveryCodesResponse(BaseModel):
    recovery_codes: list[str]


class SessionResponse(BaseModel):
    id: str
    user_agent: str
    ip_address: str
    created_at: datetime
    last_seen_at: datetime
    expires_at: datetime
    current: bool = False


class SecurityEventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    event_type: str
    outcome: str
    ip_address: str
    details: dict[str, Any]
    created_at: datetime


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


class AdvancedAnalysisObject(BaseModel):
    label: str = Field(min_length=1, max_length=160)
    box_2d: list[int] = Field(min_length=4, max_length=4)

    @field_validator("box_2d")
    @classmethod
    def validate_box(cls, value: list[int]) -> list[int]:
        if any(point < 0 or point > 1000 for point in value):
            raise ValueError("Tọa độ box_2d phải nằm trong khoảng 0..1000.")
        ymin, xmin, ymax, xmax = value
        if ymin >= ymax or xmin >= xmax:
            raise ValueError("box_2d không tạo thành hình chữ nhật hợp lệ.")
        return value


class AdvancedAnalysisContent(BaseModel):
    primary_label: str = Field(min_length=1, max_length=255)
    description: str = Field(min_length=1, max_length=2000)
    categories: list[str] = Field(default_factory=list, max_length=8)
    objects: list[AdvancedAnalysisObject] = Field(default_factory=list, max_length=20)
    visible_text: list[str] = Field(default_factory=list, max_length=20)
    suggested_actions: list[str] = Field(default_factory=list, max_length=6)


class AdvancedAnalysisResponse(AdvancedAnalysisContent):
    model: str
    processing_time_ms: int = Field(ge=0, le=3_600_000)


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
    model_version: str | None = Field(default=None, min_length=1, max_length=100)
    processing_time_ms: int | None = Field(default=None, ge=0, le=3_600_000)
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


class ModelEvaluationCreate(BaseModel):
    scan_id: str | None = None
    model_name: str = Field(min_length=1, max_length=100)
    predicted_label: str = Field(default="", max_length=255)
    expected_label: str = Field(default="", max_length=255)
    confidence: float = Field(default=0, ge=0, le=1)
    latency_ms: int = Field(default=0, ge=0, le=3_600_000)
    memory_mb: float | None = Field(default=None, ge=0, le=100_000)
    device: dict[str, Any] = Field(default_factory=dict)


class ModelEvaluationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    scan_id: str | None
    model_name: str
    predicted_label: str
    expected_label: str
    confidence: float
    latency_ms: int
    memory_mb: float | None
    correct: bool | None
    device: dict[str, Any]
    created_at: datetime


class ModelEvaluationSummary(BaseModel):
    model_name: str
    samples: int
    labeled_samples: int
    correct_samples: int
    accuracy: float | None
    average_latency_ms: float
    average_memory_mb: float | None
