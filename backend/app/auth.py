from __future__ import annotations

import hashlib
import base64
import io
import json
import secrets
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Cookie, Depends, HTTPException, Request, Response, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pwdlib import PasswordHash
from cryptography.fernet import Fernet, InvalidToken
import pyotp
import qrcode
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from .config import get_settings
from .database import get_db
from .mailer import send_account_email
from .models import AccountToken, APIKey, Scan, SecurityEvent, TwoFactorRecoveryCode, User, UserSession
from .schemas import (
    APIKeyCreate,
    APIKeyCreatedResponse,
    APIKeyResponse,
    AuthResponse,
    ChangePasswordRequest,
    DeleteAccountRequest,
    ForgotPasswordRequest,
    LoginRequest,
    MessageResponse,
    RegisterRequest,
    ResetPasswordRequest,
    SessionResponse,
    SecurityEventResponse,
    TeamMemberResponse,
    TwoFactorDisableRequest,
    TwoFactorEnableRequest,
    TwoFactorEnableResponse,
    TwoFactorLoginRequest,
    TwoFactorRecoveryCodesResponse,
    TwoFactorRecoveryRegenerateRequest,
    TwoFactorSetupResponse,
    TokenDispatchResponse,
    TokenRequest,
    UserResponse,
    UserRoleUpdate,
)
from .storage import delete_image

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()
password_hash = PasswordHash.recommended()
bearer = HTTPBearer(auto_error=False)
DbSession = Annotated[Session, Depends(get_db)]


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def normalize_email(email: str) -> str:
    return email.strip().casefold()


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    return (forwarded or (request.client.host if request.client else ""))[:80]


def record_security_event(
    db: Session,
    request: Request,
    event_type: str,
    outcome: str,
    user: User | None = None,
    identifier: str = "",
    details: dict | None = None,
) -> None:
    db.add(SecurityEvent(
        user_id=user.id if user else None,
        event_type=event_type,
        outcome=outcome,
        ip_address=client_ip(request),
        identifier_hash=digest(identifier) if identifier else "",
        user_agent=request.headers.get("user-agent", "")[:500],
        details=details or {},
    ))
    db.commit()


def enforce_rate_limit(
    db: Session,
    request: Request,
    event_type: str,
    identifier: str,
    maximum: int,
    window: timedelta,
) -> None:
    since = utc_now() - window
    identifier_hash = digest(identifier) if identifier else ""
    base_filters = [
        SecurityEvent.event_type == event_type,
        SecurityEvent.created_at >= since,
    ]
    if event_type not in {"registration_attempt", "password_reset_requested", "email_verification_requested"}:
        base_filters.append(SecurityEvent.outcome == "failure")
    ip_address = client_ip(request)
    scoped_attempts = db.scalar(select(func.count(SecurityEvent.id)).where(
        *base_filters, SecurityEvent.ip_address == ip_address, SecurityEvent.identifier_hash == identifier_hash,
    )) or 0
    ip_attempts = db.scalar(select(func.count(SecurityEvent.id)).where(
        *base_filters, SecurityEvent.ip_address == ip_address,
    )) or 0
    identifier_attempts = db.scalar(select(func.count(SecurityEvent.id)).where(
        *base_filters, SecurityEvent.identifier_hash == identifier_hash,
    )) or 0
    if scoped_attempts >= maximum or ip_attempts >= maximum * 4 or identifier_attempts >= maximum * 2:
        record_security_event(db, request, "rate_limit_blocked", "blocked", identifier=identifier, details={"scope": event_type})
        raise HTTPException(status_code=429, detail="Quá nhiều lần thử. Vui lòng đợi rồi thử lại.", headers={"Retry-After": str(int(window.total_seconds()))})


def _fernet() -> Fernet:
    if not settings.encryption_key or len(settings.encryption_key) < 32:
        raise HTTPException(status_code=503, detail="Máy chủ chưa cấu hình VISION_AI_ENCRYPTION_KEY cho 2FA.")
    key = base64.urlsafe_b64encode(hashlib.sha256(settings.encryption_key.encode("utf-8")).digest())
    return Fernet(key)


def _seal(payload: dict) -> str:
    return _fernet().encrypt(json.dumps(payload, separators=(",", ":")).encode("utf-8")).decode("ascii")


def _open(token: str) -> dict:
    try:
        payload = json.loads(_fernet().decrypt(token.encode("ascii"), ttl=600))
    except (InvalidToken, ValueError, json.JSONDecodeError):
        raise HTTPException(status_code=401, detail="Mã xác thực đã hết hạn hoặc không hợp lệ.")
    return payload


def _totp_valid(secret: str, code: str) -> bool:
    return pyotp.TOTP(secret).verify(code, valid_window=1)


def _normalize_recovery_code(code: str) -> str:
    return "".join(character for character in code.upper() if character.isalnum())


def _new_recovery_codes(db: Session, user: User) -> list[str]:
    db.execute(delete(TwoFactorRecoveryCode).where(TwoFactorRecoveryCode.user_id == user.id))
    codes: list[str] = []
    for _ in range(8):
        raw = secrets.token_hex(4).upper()
        codes.append(f"{raw[:4]}-{raw[4:]}")
        db.add(TwoFactorRecoveryCode(user_id=user.id, code_hash=digest(raw)))
    return codes


def _consume_recovery_code(db: Session, user: User, code: str) -> bool:
    normalized = _normalize_recovery_code(code)
    if len(normalized) != 8:
        return False
    item = db.scalar(select(TwoFactorRecoveryCode).where(
        TwoFactorRecoveryCode.user_id == user.id,
        TwoFactorRecoveryCode.code_hash == digest(normalized),
        TwoFactorRecoveryCode.used_at.is_(None),
    ))
    if item is None:
        return False
    item.used_at = utc_now()
    db.flush()
    return True


def _issue_account_token(db: Session, user: User, purpose: str) -> str:
    db.execute(delete(AccountToken).where(
        AccountToken.user_id == user.id,
        AccountToken.purpose == purpose,
        AccountToken.used_at.is_(None),
    ))
    raw = secrets.token_urlsafe(48)
    db.add(AccountToken(
        user_id=user.id,
        purpose=purpose,
        token_hash=digest(raw),
        expires_at=utc_now() + timedelta(minutes=settings.account_token_minutes),
    ))
    db.commit()
    return raw


def _consume_account_token(db: Session, raw: str, purpose: str) -> tuple[AccountToken, User]:
    item = db.scalar(select(AccountToken).where(
        AccountToken.token_hash == digest(raw),
        AccountToken.purpose == purpose,
        AccountToken.used_at.is_(None),
    ).with_for_update())
    if item is None:
        raise HTTPException(status_code=400, detail="Token không hợp lệ hoặc đã được sử dụng.")
    expires_at = item.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at <= utc_now():
        raise HTTPException(status_code=400, detail="Token đã hết hạn.")
    user = db.get(User, item.user_id)
    if user is None or not user.is_active:
        raise HTTPException(status_code=400, detail="Tài khoản không còn hoạt động.")
    item.used_at = utc_now()
    return item, user


def _debug_token(raw: str) -> str | None:
    return raw if settings.environment.casefold() != "production" else None


def _decrypt_user_secret(user: User) -> str:
    if not user.two_factor_secret:
        raise HTTPException(status_code=409, detail="Tài khoản chưa thiết lập 2FA.")
    try:
        return _fernet().decrypt(user.two_factor_secret.encode("ascii")).decode("ascii")
    except InvalidToken:
        raise HTTPException(status_code=503, detail="Không thể giải mã cấu hình 2FA của tài khoản.")


def is_https(request: Request) -> bool:
    return request.url.scheme == "https" or request.headers.get("x-forwarded-proto", "").split(",")[0] == "https"


def set_session_cookie(response: Response, request: Request, token: str, max_age: int | None) -> None:
    response.set_cookie(
        key=settings.session_cookie_name,
        value=token,
        max_age=max_age,
        httponly=True,
        secure=is_https(request),
        samesite="lax",
        path="/",
    )


def clear_session_cookie(response: Response, request: Request) -> None:
    response.delete_cookie(
        key=settings.session_cookie_name,
        httponly=True,
        secure=is_https(request),
        samesite="lax",
        path="/",
    )


def create_session(db: Session, request: Request, user: User, remember: bool) -> tuple[str, UserSession, int | None]:
    token = secrets.token_urlsafe(48)
    lifetime = timedelta(days=settings.remember_session_days) if remember else timedelta(hours=settings.session_hours)
    session = UserSession(
        user_id=user.id,
        token_hash=digest(token),
        user_agent=request.headers.get("user-agent", "")[:500],
        ip_address=request.client.host[:80] if request.client else "",
        expires_at=utc_now() + lifetime,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return token, session, int(lifetime.total_seconds()) if remember else None


def _session_from_cookie(db: Session, token: str | None) -> UserSession | None:
    if not token:
        return None
    session = db.scalar(select(UserSession).where(UserSession.token_hash == digest(token)))
    if session is None:
        return None
    expires_at = session.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at <= utc_now():
        db.delete(session)
        db.commit()
        return None
    return session


def require_user(
    db: DbSession,
    session_token: Annotated[str | None, Cookie(alias=settings.session_cookie_name)] = None,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)] = None,
) -> User:
    user: User | None = None
    if credentials and credentials.scheme.casefold() == "bearer":
        api_key = db.scalar(select(APIKey).where(APIKey.key_hash == digest(credentials.credentials), APIKey.revoked_at.is_(None)))
        if api_key:
            api_key.last_used_at = utc_now()
            user = db.get(User, api_key.user_id)
            db.commit()
    else:
        session = _session_from_cookie(db, session_token)
        if session:
            session.last_seen_at = utc_now()
            user = db.get(User, session.user_id)
            db.commit()
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Bạn cần đăng nhập để tiếp tục.")
    return user


def require_session_user(
    db: DbSession,
    session_token: Annotated[str | None, Cookie(alias=settings.session_cookie_name)] = None,
) -> User:
    session = _session_from_cookie(db, session_token)
    user = db.get(User, session.user_id) if session else None
    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="Phiên đăng nhập không hợp lệ hoặc đã hết hạn.")
    return user


CurrentUser = Annotated[User, Depends(require_user)]
SessionUser = Annotated[User, Depends(require_session_user)]


def require_admin(user: SessionUser) -> User:
    if user.role not in {"owner", "admin"}:
        raise HTTPException(status_code=403, detail="Bạn không có quyền quản lý thành viên.")
    return user


AdminUser = Annotated[User, Depends(require_admin)]


@router.post("/register", response_model=AuthResponse, status_code=201)
def register(payload: RegisterRequest, request: Request, response: Response, db: DbSession) -> AuthResponse:
    email = normalize_email(str(payload.email))
    enforce_rate_limit(db, request, "registration_attempt", client_ip(request), 5, timedelta(hours=1))
    if db.scalar(select(User.id).where(User.email == email)):
        record_security_event(db, request, "registration_attempt", "failure", identifier=client_ip(request), details={"reason": "email_exists"})
        raise HTTPException(status_code=409, detail="Email này đã được sử dụng.")
    first_account = (db.scalar(select(func.count(User.id))) or 0) == 0
    user = User(
        email=email,
        display_name=" ".join(payload.display_name.split()),
        password_hash=password_hash.hash(payload.password),
        role="owner" if first_account else "member",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    token, _session, max_age = create_session(db, request, user, remember=True)
    set_session_cookie(response, request, token, max_age)
    record_security_event(db, request, "account_registered", "success", user=user)
    record_security_event(db, request, "registration_attempt", "success", user=user, identifier=client_ip(request))
    return AuthResponse(user=UserResponse.model_validate(user))


@router.post("/login", response_model=AuthResponse)
def login(payload: LoginRequest, request: Request, response: Response, db: DbSession) -> AuthResponse:
    email = normalize_email(str(payload.email))
    enforce_rate_limit(db, request, "login_failure", email, 5, timedelta(minutes=15))
    user = db.scalar(select(User).where(User.email == email))
    if user is None or not password_hash.verify(payload.password, user.password_hash) or not user.is_active:
        record_security_event(db, request, "login_failure", "failure", user=user, identifier=email, details={"reason": "invalid_credentials"})
        raise HTTPException(status_code=401, detail="Email hoặc mật khẩu không đúng.")
    if user.two_factor_enabled:
        challenge = _seal({"purpose": "login", "user_id": user.id, "remember": payload.remember})
        record_security_event(db, request, "login_password_verified", "success", user=user)
        return AuthResponse(requires_2fa=True, challenge_token=challenge)
    token, _session, max_age = create_session(db, request, user, payload.remember)
    set_session_cookie(response, request, token, max_age)
    record_security_event(db, request, "login_success", "success", user=user)
    return AuthResponse(user=UserResponse.model_validate(user))


@router.post("/2fa/setup", response_model=TwoFactorSetupResponse)
def setup_two_factor(user: SessionUser) -> TwoFactorSetupResponse:
    secret = pyotp.random_base32()
    uri = pyotp.TOTP(secret).provisioning_uri(name=user.email, issuer_name="Vision AI")
    image = qrcode.make(uri)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return TwoFactorSetupResponse(
        setup_token=_seal({"purpose": "setup", "user_id": user.id, "secret": secret}),
        secret=secret,
        qr_data_url=f"data:image/png;base64,{base64.b64encode(buffer.getvalue()).decode('ascii')}",
    )


@router.post("/2fa/enable", response_model=TwoFactorEnableResponse)
def enable_two_factor(payload: TwoFactorEnableRequest, request: Request, user: SessionUser, db: DbSession) -> TwoFactorEnableResponse:
    setup = _open(payload.setup_token)
    if setup.get("purpose") != "setup" or setup.get("user_id") != user.id:
        raise HTTPException(status_code=401, detail="Phiên thiết lập 2FA không hợp lệ.")
    secret = str(setup.get("secret", ""))
    if not _totp_valid(secret, payload.code):
        raise HTTPException(status_code=400, detail="Mã Authenticator không đúng.")
    user.two_factor_secret = _fernet().encrypt(secret.encode("ascii")).decode("ascii")
    user.two_factor_enabled = True
    recovery_codes = _new_recovery_codes(db, user)
    db.commit()
    db.refresh(user)
    record_security_event(db, request, "two_factor_enabled", "success", user=user)
    return TwoFactorEnableResponse(user=UserResponse.model_validate(user), recovery_codes=recovery_codes)


@router.post("/2fa/verify-login", response_model=AuthResponse)
def verify_two_factor_login(payload: TwoFactorLoginRequest, request: Request, response: Response, db: DbSession) -> AuthResponse:
    challenge = _open(payload.challenge_token)
    if challenge.get("purpose") != "login":
        raise HTTPException(status_code=401, detail="Yêu cầu đăng nhập không hợp lệ.")
    user = db.get(User, challenge.get("user_id"))
    if user is None or not user.is_active or not user.two_factor_enabled:
        raise HTTPException(status_code=401, detail="Tài khoản không hợp lệ.")
    enforce_rate_limit(db, request, "two_factor_failure", user.id, 5, timedelta(minutes=10))
    used_recovery_code = False
    if not _totp_valid(_decrypt_user_secret(user), payload.code):
        used_recovery_code = _consume_recovery_code(db, user, payload.code)
    if not _totp_valid(_decrypt_user_secret(user), payload.code) and not used_recovery_code:
        record_security_event(db, request, "two_factor_failure", "failure", user=user, identifier=user.id)
        raise HTTPException(status_code=401, detail="Mã Authenticator hoặc mã khôi phục không đúng.")
    token, _session, max_age = create_session(db, request, user, bool(challenge.get("remember")))
    set_session_cookie(response, request, token, max_age)
    record_security_event(db, request, "recovery_code_used" if used_recovery_code else "login_success", "success", user=user)
    return AuthResponse(user=UserResponse.model_validate(user))


@router.post("/2fa/disable", response_model=UserResponse)
def disable_two_factor(payload: TwoFactorDisableRequest, request: Request, user: SessionUser, db: DbSession) -> User:
    if not password_hash.verify(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Mật khẩu không đúng.")
    if not _totp_valid(_decrypt_user_secret(user), payload.code):
        raise HTTPException(status_code=400, detail="Mã Authenticator không đúng.")
    user.two_factor_enabled = False
    user.two_factor_secret = None
    db.execute(delete(TwoFactorRecoveryCode).where(TwoFactorRecoveryCode.user_id == user.id))
    db.commit()
    db.refresh(user)
    record_security_event(db, request, "two_factor_disabled", "success", user=user)
    return user


@router.post("/2fa/recovery-codes/regenerate", response_model=TwoFactorRecoveryCodesResponse)
def regenerate_recovery_codes(payload: TwoFactorRecoveryRegenerateRequest, request: Request, user: SessionUser, db: DbSession) -> TwoFactorRecoveryCodesResponse:
    if not user.two_factor_enabled:
        raise HTTPException(status_code=409, detail="Tài khoản chưa bật 2FA.")
    if not password_hash.verify(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Mật khẩu không đúng.")
    if not _totp_valid(_decrypt_user_secret(user), payload.code):
        raise HTTPException(status_code=400, detail="Mã Authenticator không đúng.")
    recovery_codes = _new_recovery_codes(db, user)
    db.commit()
    record_security_event(db, request, "recovery_codes_regenerated", "success", user=user)
    return TwoFactorRecoveryCodesResponse(recovery_codes=recovery_codes)


@router.post("/logout", response_model=MessageResponse)
def logout(
    request: Request,
    response: Response,
    db: DbSession,
    session_token: Annotated[str | None, Cookie(alias=settings.session_cookie_name)] = None,
) -> MessageResponse:
    session = _session_from_cookie(db, session_token)
    if session:
        db.delete(session)
        db.commit()
    clear_session_cookie(response, request)
    return MessageResponse(message="Đã đăng xuất.")


@router.get("/me", response_model=UserResponse)
def me(user: CurrentUser) -> User:
    return user


@router.post("/forgot-password-legacy", response_model=MessageResponse, include_in_schema=False)
def forgot_password() -> MessageResponse:
    return MessageResponse(message="Nếu email tồn tại, hướng dẫn đặt lại mật khẩu sẽ được gửi.")


@router.post("/change-password", response_model=MessageResponse)
def change_password(
    payload: ChangePasswordRequest,
    request: Request,
    user: SessionUser,
    db: DbSession,
    session_token: Annotated[str | None, Cookie(alias=settings.session_cookie_name)] = None,
) -> MessageResponse:
    if not password_hash.verify(payload.current_password, user.password_hash):
        raise HTTPException(status_code=401, detail="Mật khẩu hiện tại không đúng.")
    if password_hash.verify(payload.new_password, user.password_hash):
        raise HTTPException(status_code=409, detail="Mật khẩu mới phải khác mật khẩu hiện tại.")
    user.password_hash = password_hash.hash(payload.new_password)
    current_hash = digest(session_token) if session_token else ""
    db.execute(delete(UserSession).where(UserSession.user_id == user.id, UserSession.token_hash != current_hash))
    db.commit()
    record_security_event(db, request, "password_changed", "success", user=user)
    return MessageResponse(message="Đã đổi mật khẩu và đăng xuất các thiết bị khác.")


@router.post("/email-verification/request", response_model=TokenDispatchResponse)
def request_email_verification(
    request: Request,
    background_tasks: BackgroundTasks,
    user: SessionUser,
    db: DbSession,
) -> TokenDispatchResponse:
    if user.email_verified_at:
        return TokenDispatchResponse(message="Email đã được xác minh.")
    enforce_rate_limit(db, request, "email_verification_requested", user.id, 5, timedelta(hours=1))
    raw = _issue_account_token(db, user, "verify_email")
    url = f"{settings.public_app_url.rstrip('/')}/#/verify-email?token={raw}"
    background_tasks.add_task(send_account_email, user.email, "Xác minh email Vision AI", url, "Xác minh email")
    record_security_event(db, request, "email_verification_requested", "success", user=user)
    return TokenDispatchResponse(message="Đã gửi liên kết xác minh email.", debug_token=_debug_token(raw))


@router.post("/email-verification/confirm", response_model=UserResponse)
def confirm_email_verification(payload: TokenRequest, request: Request, db: DbSession) -> User:
    _item, user = _consume_account_token(db, payload.token, "verify_email")
    user.email_verified_at = utc_now()
    db.commit()
    db.refresh(user)
    record_security_event(db, request, "email_verified", "success", user=user)
    return user


@router.post("/forgot-password", response_model=TokenDispatchResponse)
def forgot_password(
    payload: ForgotPasswordRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: DbSession,
) -> TokenDispatchResponse:
    email = normalize_email(str(payload.email))
    enforce_rate_limit(db, request, "password_reset_requested", email, 5, timedelta(hours=1))
    user = db.scalar(select(User).where(User.email == email, User.is_active.is_(True)))
    debug_token = None
    if user:
        raw = _issue_account_token(db, user, "reset_password")
        url = f"{settings.public_app_url.rstrip('/')}/#/reset-password?token={raw}"
        background_tasks.add_task(send_account_email, user.email, "Đặt lại mật khẩu Vision AI", url, "Đặt lại mật khẩu")
        debug_token = _debug_token(raw)
        record_security_event(db, request, "password_reset_requested", "success", user=user, identifier=email)
    else:
        record_security_event(db, request, "password_reset_requested", "success", identifier=email)
    return TokenDispatchResponse(
        message="Nếu email tồn tại, hướng dẫn đặt lại mật khẩu sẽ được gửi.",
        debug_token=debug_token,
    )


@router.post("/reset-password", response_model=MessageResponse)
def reset_password(payload: ResetPasswordRequest, request: Request, db: DbSession) -> MessageResponse:
    _item, user = _consume_account_token(db, payload.token, "reset_password")
    user.password_hash = password_hash.hash(payload.new_password)
    db.execute(delete(UserSession).where(UserSession.user_id == user.id))
    db.execute(delete(APIKey).where(APIKey.user_id == user.id))
    db.commit()
    record_security_event(db, request, "password_reset_completed", "success", user=user)
    return MessageResponse(message="Đã đặt lại mật khẩu. Hãy đăng nhập lại trên các thiết bị.")


@router.delete("/account", response_model=MessageResponse)
def delete_account(
    payload: DeleteAccountRequest,
    request: Request,
    response: Response,
    user: SessionUser,
    db: DbSession,
) -> MessageResponse:
    if not password_hash.verify(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Mật khẩu không đúng.")
    if user.role == "owner":
        owner_count = db.scalar(select(func.count(User.id)).where(User.role == "owner", User.is_active.is_(True))) or 0
        user_count = db.scalar(select(func.count(User.id)).where(User.is_active.is_(True))) or 0
        if owner_count <= 1 and user_count > 1:
            raise HTTPException(status_code=409, detail="Hãy chuyển quyền Owner trước khi xóa tài khoản.")
    stored_names = list(db.scalars(select(Scan.stored_name).where(Scan.user_id == user.id)).all())
    for stored_name in stored_names:
        try:
            delete_image(stored_name)
        except Exception as exc:
            raise HTTPException(status_code=502, detail="Không thể xóa hết ảnh trên kho lưu trữ; tài khoản chưa bị xóa.") from exc
    db.delete(user)
    db.commit()
    clear_session_cookie(response, request)
    return MessageResponse(message="Tài khoản và toàn bộ dữ liệu liên quan đã được xóa.")


@router.get("/sessions", response_model=list[SessionResponse])
def list_sessions(
    user: SessionUser,
    db: DbSession,
    session_token: Annotated[str | None, Cookie(alias=settings.session_cookie_name)] = None,
) -> list[SessionResponse]:
    current_hash = digest(session_token) if session_token else ""
    sessions = db.scalars(select(UserSession).where(UserSession.user_id == user.id).order_by(UserSession.last_seen_at.desc())).all()
    return [SessionResponse(
        id=item.id, user_agent=item.user_agent, ip_address=item.ip_address,
        created_at=item.created_at, last_seen_at=item.last_seen_at, expires_at=item.expires_at,
        current=item.token_hash == current_hash,
    ) for item in sessions]


@router.get("/security-events", response_model=list[SecurityEventResponse])
def list_security_events(user: SessionUser, db: DbSession) -> list[SecurityEvent]:
    return list(db.scalars(
        select(SecurityEvent)
        .where(SecurityEvent.user_id == user.id)
        .order_by(SecurityEvent.created_at.desc())
        .limit(50)
    ).all())


@router.delete("/sessions/{session_id}", response_model=MessageResponse)
def revoke_session(session_id: str, user: SessionUser, db: DbSession) -> MessageResponse:
    session = db.scalar(select(UserSession).where(UserSession.id == session_id, UserSession.user_id == user.id))
    if session is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy phiên đăng nhập.")
    db.delete(session)
    db.commit()
    return MessageResponse(message="Đã thu hồi phiên đăng nhập.")


@router.get("/api-keys", response_model=list[APIKeyResponse])
def list_api_keys(user: SessionUser, db: DbSession) -> list[APIKey]:
    return list(db.scalars(select(APIKey).where(APIKey.user_id == user.id, APIKey.revoked_at.is_(None)).order_by(APIKey.created_at.desc())).all())


@router.post("/api-keys", response_model=APIKeyCreatedResponse, status_code=201)
def create_api_key(payload: APIKeyCreate, user: SessionUser, db: DbSession) -> APIKeyCreatedResponse:
    secret = f"vai_live_{secrets.token_urlsafe(32)}"
    item = APIKey(user_id=user.id, name=" ".join(payload.name.split()), prefix=secret[:16], key_hash=digest(secret))
    db.add(item)
    db.commit()
    db.refresh(item)
    return APIKeyCreatedResponse(
        id=item.id, name=item.name, prefix=item.prefix, created_at=item.created_at,
        last_used_at=item.last_used_at, key=secret,
    )


@router.delete("/api-keys/{key_id}", response_model=MessageResponse)
def revoke_api_key(key_id: str, user: SessionUser, db: DbSession) -> MessageResponse:
    item = db.scalar(select(APIKey).where(APIKey.id == key_id, APIKey.user_id == user.id, APIKey.revoked_at.is_(None)))
    if item is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy API key.")
    item.revoked_at = utc_now()
    db.commit()
    return MessageResponse(message="Đã thu hồi API key.")


@router.get("/team", response_model=list[TeamMemberResponse])
def list_team(_admin: AdminUser, db: DbSession) -> list[User]:
    return list(db.scalars(select(User).order_by(User.created_at.asc())).all())


@router.patch("/team/{user_id}/role", response_model=TeamMemberResponse)
def update_team_role(user_id: str, payload: UserRoleUpdate, admin: AdminUser, db: DbSession) -> User:
    member = db.get(User, user_id)
    if member is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy thành viên.")
    if member.role == "owner" and payload.role != "owner":
        owner_count = db.scalar(select(func.count(User.id)).where(User.role == "owner")) or 0
        if owner_count <= 1:
            raise HTTPException(status_code=409, detail="Workspace phải còn ít nhất một Owner.")
    if admin.role == "admin" and (member.role == "owner" or payload.role == "owner"):
        raise HTTPException(status_code=403, detail="Admin không thể thay đổi quyền Owner.")
    member.role = payload.role
    db.commit()
    db.refresh(member)
    return member
