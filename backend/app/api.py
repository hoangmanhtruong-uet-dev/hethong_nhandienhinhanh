from __future__ import annotations

import csv
import io
import json
from datetime import timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile, status
from fastapi.responses import FileResponse, RedirectResponse
from pydantic import ValidationError
from sqlalchemy import delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .auth import CurrentUser
from .config import get_settings
from .database import get_db
from .models import Collection, CollectionItem, Feedback, ModelEvaluation, Scan, User, UserSettings, utc_now
from .schemas import (
    AddScanRequest,
    CollectionCreate,
    CollectionResponse,
    CollectionUpdate,
    FeedbackCreate,
    FeedbackResponse,
    MessageResponse,
    ModelEvaluationCreate,
    ModelEvaluationResponse,
    ModelEvaluationSummary,
    PrivacySettingsResponse,
    PrivacySettingsUpdate,
    ScanCreate,
    ScanPage,
    ScanResponse,
    ScanUpdate,
)
from .storage import cloudinary_enabled, configure_cloudinary, delete_image, image_delivery_url, image_path, save_image


router = APIRouter()
DbSession = Annotated[Session, Depends(get_db)]
settings = get_settings()


def get_scan_or_404(db: Session, scan_id: str, user_id: str) -> Scan:
    scan = db.scalar(select(Scan).where(Scan.id == scan_id, Scan.user_id == user_id))
    if scan is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy kết quả quét.")
    return scan


def get_collection_or_404(db: Session, collection_id: str, user_id: str) -> Collection:
    collection = db.scalar(select(Collection).where(Collection.id == collection_id, Collection.user_id == user_id))
    if collection is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy bộ sưu tập.")
    return collection


def scan_response(scan: Scan) -> ScanResponse:
    return ScanResponse(
        id=scan.id,
        file_name=scan.file_name,
        image_url=f"/api/scans/{scan.id}/image",
        mime_type=scan.mime_type,
        file_size=scan.file_size,
        width=scan.width,
        height=scan.height,
        primary_label=scan.primary_label,
        confidence=scan.confidence,
        description=scan.description,
        predictions=scan.predictions or [],
        detections=scan.detections or [],
        model_version=scan.model_version,
        processing_time_ms=scan.processing_time_ms,
        confirmed=scan.confirmed,
        favorite=scan.favorite,
        created_at=scan.created_at,
        updated_at=scan.updated_at,
    )


def collection_response(db: Session, collection: Collection) -> CollectionResponse:
    count = db.scalar(
        select(func.count(CollectionItem.id))
        .join(Scan, Scan.id == CollectionItem.scan_id)
        .where(CollectionItem.collection_id == collection.id, Scan.user_id == collection.user_id)
    ) or 0
    cover_scan_id = db.scalar(
        select(CollectionItem.scan_id)
        .join(Scan, Scan.id == CollectionItem.scan_id)
        .where(CollectionItem.collection_id == collection.id, Scan.user_id == collection.user_id)
        .order_by(CollectionItem.added_at.desc())
        .limit(1)
    )
    return CollectionResponse(
        id=collection.id,
        name=collection.name,
        description=collection.description,
        color=collection.color,
        item_count=count,
        cover_image_url=f"/api/scans/{cover_scan_id}/image" if cover_scan_id else None,
        created_at=collection.created_at,
        updated_at=collection.updated_at,
    )


@router.get("/health", tags=["system"])
def health(db: DbSession) -> dict:
    db.execute(select(1))
    return {
        "status": "ok",
        "database": db.bind.dialect.name if db.bind is not None else "connected",
        "storage": "cloudinary" if cloudinary_enabled() else "local",
    }


@router.get("/health/ready", tags=["system"])
def readiness(db: DbSession) -> dict:
    checks: dict[str, dict[str, str]] = {}
    try:
        db.execute(select(1))
        checks["database"] = {"status": "ok", "driver": db.bind.dialect.name if db.bind else "unknown"}
    except Exception as exc:
        raise HTTPException(status_code=503, detail={"status": "not_ready", "database": type(exc).__name__}) from exc

    try:
        if cloudinary_enabled():
            configure_cloudinary()
            checks["storage"] = {"status": "ok", "provider": "cloudinary"}
        elif settings.require_cloudinary:
            raise RuntimeError("Cloudinary is required but VISION_AI_CLOUDINARY_URL is missing.")
        else:
            checks["storage"] = {"status": "ok", "provider": "local"}
    except Exception as exc:
        raise HTTPException(status_code=503, detail={"status": "not_ready", "storage": str(exc)}) from exc
    email_provider = "resend" if settings.resend_api_key else "smtp" if settings.smtp_host else "none"
    if (settings.require_smtp and not settings.smtp_host) or (settings.require_email_provider and email_provider == "none"):
        raise HTTPException(status_code=503, detail={"status": "not_ready", "email": "Email provider is required but not configured."})
    checks["email"] = {"status": "ok" if email_provider != "none" else "optional", "provider": email_provider}
    return {"status": "ready", "checks": checks}


@router.post("/scans", response_model=ScanResponse, status_code=status.HTTP_201_CREATED, tags=["scans"])
async def create_scan(
    db: DbSession,
    user: CurrentUser,
    file: Annotated[UploadFile, File(description="JPEG, PNG hoặc WebP; tối đa 15 MB")],
    metadata: Annotated[str, Form(description="JSON theo schema ScanCreate")],
) -> ScanResponse:
    recent_scans = db.scalar(select(func.count(Scan.id)).where(
        Scan.user_id == user.id,
        Scan.created_at >= utc_now() - timedelta(hours=1),
    )) or 0
    if recent_scans >= 60:
        raise HTTPException(status_code=429, detail="Bạn đã đạt giới hạn 60 lượt lưu ảnh mỗi giờ.", headers={"Retry-After": "3600"})

    try:
        payload = ScanCreate.model_validate_json(metadata)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=json.loads(exc.json())) from exc

    stored = await save_image(file, user.id)
    scan = Scan(
        user_id=user.id,
        file_name=stored.original_name,
        stored_name=stored.stored_name,
        mime_type=stored.mime_type,
        file_size=stored.file_size,
        width=stored.width,
        height=stored.height,
        **payload.model_dump(),
    )
    try:
        db.add(scan)
        db.commit()
        db.refresh(scan)
    except Exception:
        db.rollback()
        delete_image(stored.stored_name)
        raise
    return scan_response(scan)


@router.get("/scans", response_model=ScanPage, tags=["scans"])
def list_scans(
    db: DbSession,
    user: CurrentUser,
    search: str | None = Query(default=None, max_length=100),
    favorite: bool | None = None,
    confirmed: bool | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
) -> ScanPage:
    filters = [Scan.user_id == user.id]
    if search:
        pattern = f"%{search.strip()}%"
        filters.append(or_(Scan.primary_label.ilike(pattern), Scan.file_name.ilike(pattern)))
    if favorite is not None:
        filters.append(Scan.favorite == favorite)
    if confirmed is not None:
        filters.append(Scan.confirmed == confirmed)

    total = db.scalar(select(func.count(Scan.id)).where(*filters)) or 0
    scans = db.scalars(
        select(Scan)
        .where(*filters)
        .order_by(Scan.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return ScanPage(items=[scan_response(item) for item in scans], total=total, page=page, page_size=page_size)


@router.get("/scans/{scan_id}", response_model=ScanResponse, tags=["scans"])
def get_scan(scan_id: str, db: DbSession, user: CurrentUser) -> ScanResponse:
    return scan_response(get_scan_or_404(db, scan_id, user.id))


@router.get("/scans/{scan_id}/image", tags=["scans"], response_model=None)
def get_scan_image(scan_id: str, db: DbSession, user: CurrentUser) -> Response:
    scan = get_scan_or_404(db, scan_id, user.id)
    cloud_url = image_delivery_url(scan.stored_name)
    if cloud_url:
        return RedirectResponse(cloud_url, status_code=307, headers={"Cache-Control": "private, max-age=300"})
    return FileResponse(image_path(scan.stored_name), media_type=scan.mime_type, filename=scan.file_name)


@router.patch("/scans/{scan_id}", response_model=ScanResponse, tags=["scans"])
def update_scan(scan_id: str, payload: ScanUpdate, db: DbSession, user: CurrentUser) -> ScanResponse:
    scan = get_scan_or_404(db, scan_id, user.id)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(scan, key, value)
    db.commit()
    db.refresh(scan)
    return scan_response(scan)


@router.delete("/scans/{scan_id}", response_model=MessageResponse, tags=["scans"])
def remove_scan(scan_id: str, db: DbSession, user: CurrentUser) -> MessageResponse:
    scan = get_scan_or_404(db, scan_id, user.id)
    stored_name = scan.stored_name
    db.delete(scan)
    db.commit()
    delete_image(stored_name)
    return MessageResponse(message="Đã xóa kết quả quét.")


@router.delete("/scans", response_model=MessageResponse, tags=["scans"])
def clear_scan_history(db: DbSession, user: CurrentUser) -> MessageResponse:
    stored_names = db.scalars(select(Scan.stored_name).where(Scan.user_id == user.id)).all()
    db.execute(delete(Scan).where(Scan.user_id == user.id))
    db.commit()
    for stored_name in stored_names:
        delete_image(stored_name)
    return MessageResponse(message="Đã xóa toàn bộ lịch sử quét.")


@router.get("/scans/{scan_id}/export", tags=["scans"])
def export_scan(
    scan_id: str,
    db: DbSession,
    user: CurrentUser,
    format: Literal["json", "csv"] = Query(default="json"),
) -> Response:
    scan = get_scan_or_404(db, scan_id, user.id)
    payload = scan_response(scan).model_dump(mode="json")
    if format == "json":
        content = json.dumps(payload, ensure_ascii=False, indent=2)
        return Response(
            content=content,
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="scan-{scan.id}.json"'},
        )

    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(["id", "label", "confidence", "file_name", "width", "height", "model", "created_at"])
    writer.writerow([
        scan.id,
        scan.primary_label,
        scan.confidence,
        scan.file_name,
        scan.width,
        scan.height,
        scan.model_version,
        scan.created_at.isoformat(),
    ])
    return Response(
        content="\ufeff" + output.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="scan-{scan.id}.csv"'},
    )


@router.post("/collections", response_model=CollectionResponse, status_code=201, tags=["collections"])
def create_collection(payload: CollectionCreate, db: DbSession, user: CurrentUser) -> CollectionResponse:
    collection = Collection(user_id=user.id, **payload.model_dump())
    try:
        db.add(collection)
        db.commit()
        db.refresh(collection)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Tên bộ sưu tập đã tồn tại.") from exc
    return collection_response(db, collection)


@router.get("/collections", response_model=list[CollectionResponse], tags=["collections"])
def list_collections(db: DbSession, user: CurrentUser) -> list[CollectionResponse]:
    collections = db.scalars(select(Collection).where(Collection.user_id == user.id).order_by(Collection.updated_at.desc())).all()
    return [collection_response(db, item) for item in collections]


@router.get("/collections/{collection_id}", response_model=CollectionResponse, tags=["collections"])
def get_collection(collection_id: str, db: DbSession, user: CurrentUser) -> CollectionResponse:
    return collection_response(db, get_collection_or_404(db, collection_id, user.id))


@router.patch("/collections/{collection_id}", response_model=CollectionResponse, tags=["collections"])
def update_collection(collection_id: str, payload: CollectionUpdate, db: DbSession, user: CurrentUser) -> CollectionResponse:
    collection = get_collection_or_404(db, collection_id, user.id)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(collection, key, value)
    try:
        db.commit()
        db.refresh(collection)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Tên bộ sưu tập đã tồn tại.") from exc
    return collection_response(db, collection)


@router.delete("/collections/{collection_id}", response_model=MessageResponse, tags=["collections"])
def remove_collection(collection_id: str, db: DbSession, user: CurrentUser) -> MessageResponse:
    db.delete(get_collection_or_404(db, collection_id, user.id))
    db.commit()
    return MessageResponse(message="Đã xóa bộ sưu tập; ảnh gốc vẫn còn trong lịch sử.")


@router.post("/collections/{collection_id}/items", response_model=MessageResponse, status_code=201, tags=["collections"])
def add_scan_to_collection(collection_id: str, payload: AddScanRequest, db: DbSession, user: CurrentUser) -> MessageResponse:
    get_collection_or_404(db, collection_id, user.id)
    get_scan_or_404(db, payload.scan_id, user.id)
    link = CollectionItem(collection_id=collection_id, scan_id=payload.scan_id)
    try:
        db.add(link)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Kết quả đã có trong bộ sưu tập.") from exc
    return MessageResponse(message="Đã lưu vào bộ sưu tập.")


@router.get("/collections/{collection_id}/items", response_model=ScanPage, tags=["collections"])
def list_collection_scans(
    collection_id: str,
    db: DbSession,
    user: CurrentUser,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
) -> ScanPage:
    get_collection_or_404(db, collection_id, user.id)
    condition = CollectionItem.collection_id == collection_id
    total = db.scalar(
        select(func.count(CollectionItem.id))
        .join(Scan, Scan.id == CollectionItem.scan_id)
        .where(condition, Scan.user_id == user.id)
    ) or 0
    scans = db.scalars(
        select(Scan)
        .join(CollectionItem, CollectionItem.scan_id == Scan.id)
        .where(condition, Scan.user_id == user.id)
        .order_by(CollectionItem.added_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return ScanPage(items=[scan_response(item) for item in scans], total=total, page=page, page_size=page_size)


@router.delete("/collections/{collection_id}/items/{scan_id}", response_model=MessageResponse, tags=["collections"])
def remove_scan_from_collection(collection_id: str, scan_id: str, db: DbSession, user: CurrentUser) -> MessageResponse:
    get_collection_or_404(db, collection_id, user.id)
    get_scan_or_404(db, scan_id, user.id)
    link = db.scalar(
        select(CollectionItem).where(
            CollectionItem.collection_id == collection_id,
            CollectionItem.scan_id == scan_id,
        )
    )
    if link is None:
        raise HTTPException(status_code=404, detail="Kết quả không có trong bộ sưu tập.")
    db.delete(link)
    db.commit()
    return MessageResponse(message="Đã bỏ khỏi bộ sưu tập.")


@router.post("/feedback", response_model=FeedbackResponse, status_code=201, tags=["feedback"])
def create_feedback(payload: FeedbackCreate, db: DbSession, user: CurrentUser) -> Feedback:
    scan = get_scan_or_404(db, payload.scan_id, user.id) if payload.scan_id else None
    feedback = Feedback(user_id=user.id, **payload.model_dump())
    if scan and payload.feedback_type == "confirm":
        db.add(ModelEvaluation(
            user_id=user.id, scan_id=scan.id, model_name=scan.model_version,
            predicted_label=scan.primary_label, expected_label=scan.primary_label,
            confidence=scan.confidence, latency_ms=scan.processing_time_ms, correct=True,
            device={"source": "scan_feedback"},
        ))
        scan.confirmed = True
    elif scan and payload.feedback_type == "incorrect_label" and payload.corrected_label.strip():
        corrected = payload.corrected_label.strip()
        db.add(ModelEvaluation(
            user_id=user.id, scan_id=scan.id, model_name=scan.model_version,
            predicted_label=payload.original_label.strip() or scan.primary_label,
            expected_label=corrected, confidence=scan.confidence,
            latency_ms=scan.processing_time_ms, correct=False,
            device={"source": "scan_feedback"},
        ))
        scan.primary_label = corrected
        scan.confirmed = True
    db.add(feedback)
    db.commit()
    db.refresh(feedback)
    return feedback


def load_settings(db: Session, user_id: str) -> UserSettings:
    item = db.scalar(select(UserSettings).where(UserSettings.user_id == user_id))
    if item is None:
        item = UserSettings(user_id=user_id)
        db.add(item)
        db.commit()
        db.refresh(item)
    return item


@router.get("/settings/privacy", response_model=PrivacySettingsResponse, tags=["settings"])
def get_privacy_settings(db: DbSession, user: CurrentUser) -> UserSettings:
    return load_settings(db, user.id)


@router.put("/settings/privacy", response_model=PrivacySettingsResponse, tags=["settings"])
def update_privacy_settings(payload: PrivacySettingsUpdate, db: DbSession, user: CurrentUser) -> UserSettings:
    item = load_settings(db, user.id)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(item, key, value)
    db.commit()
    db.refresh(item)
    return item


@router.post("/model-evaluations", response_model=ModelEvaluationResponse, status_code=201, tags=["models"])
def create_model_evaluation(payload: ModelEvaluationCreate, db: DbSession, user: CurrentUser) -> ModelEvaluation:
    if payload.scan_id:
        get_scan_or_404(db, payload.scan_id, user.id)
    expected = " ".join(payload.expected_label.split())
    predicted = " ".join(payload.predicted_label.split())
    item = ModelEvaluation(
        user_id=user.id,
        **payload.model_dump(exclude={"expected_label", "predicted_label"}),
        expected_label=expected,
        predicted_label=predicted,
        correct=(predicted.casefold() == expected.casefold()) if expected else None,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.get("/model-evaluations", response_model=list[ModelEvaluationResponse], tags=["models"])
def list_model_evaluations(
    db: DbSession,
    user: CurrentUser,
    model_name: str | None = Query(default=None, max_length=100),
    limit: int = Query(default=100, ge=1, le=500),
) -> list[ModelEvaluation]:
    query = select(ModelEvaluation).where(ModelEvaluation.user_id == user.id)
    if model_name:
        query = query.where(ModelEvaluation.model_name == model_name)
    return list(db.scalars(query.order_by(ModelEvaluation.created_at.desc()).limit(limit)).all())


@router.get("/model-evaluations/summary", response_model=list[ModelEvaluationSummary], tags=["models"])
def model_evaluation_summary(db: DbSession, user: CurrentUser) -> list[ModelEvaluationSummary]:
    items = db.scalars(select(ModelEvaluation).where(ModelEvaluation.user_id == user.id)).all()
    grouped: dict[str, list[ModelEvaluation]] = {}
    for item in items:
        grouped.setdefault(item.model_name, []).append(item)
    result: list[ModelEvaluationSummary] = []
    for name, samples in sorted(grouped.items()):
        labeled = [item for item in samples if item.correct is not None]
        memory = [item.memory_mb for item in samples if item.memory_mb is not None]
        correct = sum(item.correct is True for item in labeled)
        result.append(ModelEvaluationSummary(
            model_name=name,
            samples=len(samples),
            labeled_samples=len(labeled),
            correct_samples=correct,
            accuracy=(correct / len(labeled)) if labeled else None,
            average_latency_ms=sum(item.latency_ms for item in samples) / len(samples),
            average_memory_mb=(sum(memory) / len(memory)) if memory else None,
        ))
    return result
