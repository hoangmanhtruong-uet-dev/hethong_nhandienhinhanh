from __future__ import annotations

import io
import json
import os
import tempfile
from pathlib import Path

from PIL import Image
import pytest


TEST_DIR = Path(tempfile.mkdtemp(prefix="vision-ai-tests-"))
os.environ["VISION_AI_DATABASE_URL"] = f"sqlite:///{(TEST_DIR / 'test.db').as_posix()}"
os.environ["VISION_AI_UPLOAD_DIR"] = str(TEST_DIR / "uploads")
os.environ["VISION_AI_CLOUDINARY_URL"] = ""
os.environ["VISION_AI_ENCRYPTION_KEY"] = "test-only-encryption-key-32-characters-long"

from fastapi.testclient import TestClient  # noqa: E402
import pyotp  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402

from app.main import app  # noqa: E402
import app.api as api_module  # noqa: E402
import app.storage as storage_module  # noqa: E402
from app.gemini import _response_schema  # noqa: E402
from app.resilience import reset_rate_limits  # noqa: E402
from app.schemas import AdvancedAnalysisResponse  # noqa: E402
from app.storage import StorageDeletionError, delete_image  # noqa: E402


alembic_config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
command.upgrade(alembic_config, "head")


def png_file() -> bytes:
    stream = io.BytesIO()
    Image.new("RGB", (64, 48), color=(30, 40, 80)).save(stream, format="PNG")
    return stream.getvalue()


def create_scan(client: TestClient) -> dict:
    metadata = {
        "primary_label": "mechanical keyboard",
        "confidence": 0.97,
        "description": "Bàn phím cơ",
        "predictions": [{"className": "keyboard", "probability": 0.97}],
        "detections": [{"class": "keyboard", "score": 0.94, "bbox": [1, 2, 30, 20]}],
        "model_version": "MobileNet + COCO-SSD",
        "processing_time_ms": 180,
    }
    response = client.post(
        "/api/scans",
        files={"file": ("keyboard.png", png_file(), "image/png")},
        data={"metadata": json.dumps(metadata)},
    )
    assert response.status_code == 201, response.text
    return response.json()


def register(client: TestClient, email: str = "tester@example.com") -> dict:
    response = client.post("/api/auth/register", json={
        "email": email,
        "display_name": "Vision Tester",
        "password": "correct-horse-2026",
    }, headers={"x-forwarded-for": f"test-{email}"})
    assert response.status_code == 201, response.text
    return response.json()["user"]


def test_complete_mvp_flow() -> None:
    with TestClient(app) as client:
        assert client.get("/api/health").json()["status"] == "ok"
        assert client.get("/api/scans").status_code == 401
        user = register(client)
        assert user["role"] == "owner"
        assert client.get("/api/auth/me").json()["id"] == user["id"]
        events = client.get("/api/auth/security-events")
        assert events.status_code == 200
        assert any(item["event_type"] == "account_registered" for item in events.json())
        team = client.get("/api/auth/team")
        assert team.status_code == 200
        assert len(team.json()) == 1

        scan = create_scan(client)
        scan_id = scan["id"]
        assert scan["width"] == 64
        assert scan["height"] == 48
        assert client.get(scan["image_url"]).status_code == 200

        page = client.get("/api/scans", params={"search": "keyboard"}).json()
        assert page["total"] == 1

        updated = client.patch(
            f"/api/scans/{scan_id}",
            json={"primary_label": "bàn phím cơ", "favorite": True, "confirmed": True},
        )
        assert updated.status_code == 200
        assert updated.json()["favorite"] is True

        collection_response = client.post(
            "/api/collections",
            json={"name": "Công việc", "description": "Ảnh phục vụ công việc", "color": "#7c6cff"},
        )
        assert collection_response.status_code == 201, collection_response.text
        collection_id = collection_response.json()["id"]
        assert client.post(
            f"/api/collections/{collection_id}/items", json={"scan_id": scan_id}
        ).status_code == 201
        assert client.get(f"/api/collections/{collection_id}/items").json()["total"] == 1

        feedback = client.post(
            "/api/feedback",
            json={
                "scan_id": scan_id,
                "feedback_type": "incorrect_label",
                "original_label": "keyboard",
                "corrected_label": "bàn phím cơ",
            },
        )
        assert feedback.status_code == 201

        settings = client.put(
            "/api/settings/privacy", json={"save_history": True, "theme": "light"}
        )
        assert settings.status_code == 200
        assert settings.json()["theme"] == "light"

        assert client.get(f"/api/scans/{scan_id}/export?format=json").status_code == 200
        csv_response = client.get(f"/api/scans/{scan_id}/export?format=csv")
        assert csv_response.status_code == 200
        assert "text/csv" in csv_response.headers["content-type"]


def test_accounts_cannot_access_each_others_data() -> None:
    with TestClient(app) as user_a, TestClient(app) as user_b:
        register(user_a, "isolation-a@example.com")
        register(user_b, "isolation-b@example.com")

        scan_a = create_scan(user_a)
        scan_id = scan_a["id"]
        collection_a = user_a.post("/api/collections", json={"name": "Dùng chung tên"})
        collection_b = user_b.post("/api/collections", json={"name": "Dùng chung tên"})
        assert collection_a.status_code == 201, collection_a.text
        assert collection_b.status_code == 201, collection_b.text
        collection_a_id = collection_a.json()["id"]
        collection_b_id = collection_b.json()["id"]

        assert user_b.get("/api/scans").json()["total"] == 0
        assert [item["id"] for item in user_a.get("/api/collections").json()] == [collection_a_id]
        assert [item["id"] for item in user_b.get("/api/collections").json()] == [collection_b_id]
        assert user_b.get(f"/api/scans/{scan_id}").status_code == 404
        assert user_b.get(f"/api/scans/{scan_id}/image").status_code == 404
        assert user_b.get(f"/api/scans/{scan_id}/export").status_code == 404
        assert user_b.patch(f"/api/scans/{scan_id}", json={"favorite": True}).status_code == 404
        assert user_b.delete(f"/api/scans/{scan_id}").status_code == 404
        assert user_b.post("/api/feedback", json={
            "scan_id": scan_id, "feedback_type": "confirm",
        }).status_code == 404
        assert user_b.post("/api/model-evaluations", json={
            "scan_id": scan_id, "model_name": "forbidden", "predicted_label": "x",
        }).status_code == 404

        assert user_b.get(f"/api/collections/{collection_a_id}").status_code == 404
        assert user_b.patch(f"/api/collections/{collection_a_id}", json={"name": "Chiếm quyền"}).status_code == 404
        assert user_b.delete(f"/api/collections/{collection_a_id}").status_code == 404
        assert user_b.get(f"/api/collections/{collection_a_id}/items").status_code == 404
        assert user_b.post(f"/api/collections/{collection_b_id}/items", json={"scan_id": scan_id}).status_code == 404

        assert user_b.delete("/api/scans").status_code == 200
        assert user_a.get(f"/api/scans/{scan_id}").status_code == 200

        assert user_a.put("/api/settings/privacy", json={"theme": "light"}).status_code == 200
        assert user_b.get("/api/settings/privacy").json()["theme"] == "dark"


def test_rejects_fake_image() -> None:
    with TestClient(app) as client:
        login = client.post("/api/auth/login", json={
            "email": "tester@example.com",
            "password": "correct-horse-2026",
        })
        assert login.status_code == 200
        response = client.post(
            "/api/scans",
            files={"file": ("fake.png", b"not-an-image", "image/png")},
            data={"metadata": json.dumps({"primary_label": "fake", "confidence": 0.5})},
        )
        assert response.status_code == 400


def test_api_key_and_session_revocation() -> None:
    with TestClient(app) as client:
        assert client.post("/api/auth/login", json={
            "email": "tester@example.com", "password": "correct-horse-2026"
        }).status_code == 200
        created = client.post("/api/auth/api-keys", json={"name": "Test automation"})
        assert created.status_code == 201, created.text
        secret = created.json()["key"]
        assert secret.startswith("vai_live_")

        with TestClient(app) as api_client:
            headers = {"Authorization": f"Bearer {secret}"}
            assert api_client.get("/api/scans", headers=headers).status_code == 200

        key_id = created.json()["id"]
        assert client.delete(f"/api/auth/api-keys/{key_id}").status_code == 200
        with TestClient(app) as api_client:
            assert api_client.get("/api/scans", headers={"Authorization": f"Bearer {secret}"}).status_code == 401


def test_pwa_assets_are_served() -> None:
    with TestClient(app) as client:
        manifest = client.get("/manifest.webmanifest")
        assert manifest.status_code == 200
        assert manifest.json()["display"] == "standalone"
        worker = client.get("/sw.js")
        assert worker.status_code == 200
        assert worker.headers["service-worker-allowed"] == "/"
        assert "startsWith('/api/')" in worker.text
        assert client.get("/yolo-runtime.js").status_code == 200
        model = client.get("/assets/models/yolov8n.onnx")
        assert model.status_code == 200
        assert len(model.content) > 10_000_000
        assert client.get("/vendor/ort.webgpu.min.js").status_code == 200
        assert client.get("/vendor/ort.wasm.min.js").status_code == 200


def test_two_factor_authenticator_flow() -> None:
    with TestClient(app) as client:
        user = register(client, "twofactor@example.com")
        setup = client.post("/api/auth/2fa/setup")
        assert setup.status_code == 200, setup.text
        setup_data = setup.json()
        assert setup_data["qr_data_url"].startswith("data:image/png;base64,")

        code = pyotp.TOTP(setup_data["secret"]).now()
        enabled = client.post("/api/auth/2fa/enable", json={
            "setup_token": setup_data["setup_token"], "code": code,
        })
        assert enabled.status_code == 200, enabled.text
        assert enabled.json()["user"]["two_factor_enabled"] is True
        recovery_codes = enabled.json()["recovery_codes"]
        assert len(recovery_codes) == 8

        assert client.post("/api/auth/logout").status_code == 200
        login = client.post("/api/auth/login", json={
            "email": user["email"], "password": "correct-horse-2026", "remember": True,
        })
        assert login.status_code == 200, login.text
        assert login.json()["requires_2fa"] is True

        verified = client.post("/api/auth/2fa/verify-login", json={
            "challenge_token": login.json()["challenge_token"],
            "code": recovery_codes[0],
        })
        assert verified.status_code == 200, verified.text
        assert verified.json()["user"]["id"] == user["id"]

        assert client.post("/api/auth/logout").status_code == 200
        second_login = client.post("/api/auth/login", json={
            "email": user["email"], "password": "correct-horse-2026",
        }).json()
        reused = client.post("/api/auth/2fa/verify-login", json={
            "challenge_token": second_login["challenge_token"], "code": recovery_codes[0],
        })
        assert reused.status_code == 401


def test_login_rate_limit_blocks_repeated_failures() -> None:
    with TestClient(app) as client:
        payload = {"email": "rate-limit@example.com", "password": "wrong-password"}
        for _ in range(5):
            assert client.post("/api/auth/login", json=payload).status_code == 401
        blocked = client.post("/api/auth/login", json=payload)
        assert blocked.status_code == 429
        assert blocked.headers["retry-after"] == "900"


def test_readiness_and_model_evaluation_are_account_scoped() -> None:
    with TestClient(app) as user_a, TestClient(app) as user_b:
        ready = user_a.get("/api/health/ready")
        assert ready.status_code == 200
        assert ready.json()["status"] == "ready"
        register(user_a, "metrics-a@example.com")
        register(user_b, "metrics-b@example.com")
        created = user_a.post("/api/model-evaluations", json={
            "model_name": "YOLOv8n ONNX",
            "predicted_label": "cat",
            "expected_label": "cat",
            "confidence": 0.91,
            "latency_ms": 240,
            "memory_mb": 128.5,
            "device": {"platform": "test"},
        })
        assert created.status_code == 201, created.text
        assert created.json()["correct"] is True
        summary = user_a.get("/api/model-evaluations/summary").json()
        assert summary[0]["accuracy"] == 1.0
        assert user_b.get("/api/model-evaluations").json() == []


def test_advanced_analysis_is_authenticated_rate_limited_and_does_not_persist(monkeypatch) -> None:
    async def fake_gemini(_image_bytes: bytes, mime_type: str) -> AdvancedAnalysisResponse:
        assert mime_type == "image/jpeg"
        return AdvancedAnalysisResponse(
            primary_label="Bàn phím cơ",
            description="Một bàn phím cơ màu tối đặt trên bàn.",
            categories=["Công nghệ", "Thiết bị nhập liệu"],
            objects=[{"label": "bàn phím", "box_2d": [120, 80, 880, 920]}],
            visible_text=[],
            suggested_actions=["Kiểm tra bố cục phím"],
            model="gemini-test",
            processing_time_ms=123,
        )

    monkeypatch.setattr(api_module, "analyze_with_gemini", fake_gemini)
    monkeypatch.setattr(api_module.settings, "gemini_requests_per_hour", 1)

    with TestClient(app) as anonymous:
        denied = anonymous.post(
            "/api/analysis/advanced",
            files={"file": ("keyboard.png", png_file(), "image/png")},
        )
        assert denied.status_code == 401

    with TestClient(app) as client:
        register(client, "gemini-analysis@example.com")
        result = client.post(
            "/api/analysis/advanced",
            files={"file": ("keyboard.png", png_file(), "image/png")},
        )
        assert result.status_code == 200, result.text
        assert result.json()["primary_label"] == "Bàn phím cơ"
        assert result.json()["objects"][0]["box_2d"] == [120, 80, 880, 920]
        assert client.get("/api/scans").json()["total"] == 0

        blocked = client.post(
            "/api/analysis/advanced",
            files={"file": ("keyboard.png", png_file(), "image/png")},
        )
        assert blocked.status_code == 429
        events = client.get("/api/auth/security-events").json()
        assert any(item["event_type"] == "gemini_analysis_requested" and item["outcome"] == "success" for item in events)


def test_gemini_schema_only_uses_supported_string_constraints() -> None:
    serialized = json.dumps(_response_schema())
    assert "minLength" not in serialized
    assert "maxLength" not in serialized
    assert "default" not in serialized


def test_cloudinary_delete_requires_provider_confirmation(monkeypatch) -> None:
    monkeypatch.setattr(storage_module, "configure_cloudinary", lambda: None)
    monkeypatch.setattr(storage_module.cloudinary.uploader, "destroy", lambda *args, **kwargs: {"result": "ok"})
    delete_image("cld:vision-ai/user/image-id|jpg")
    monkeypatch.setattr(storage_module.cloudinary.uploader, "destroy", lambda *args, **kwargs: {"result": "not found"})
    delete_image("cld:vision-ai/user/image-id|jpg")
    monkeypatch.setattr(storage_module.cloudinary.uploader, "destroy", lambda *args, **kwargs: {"result": "pending"})
    with pytest.raises(StorageDeletionError):
        delete_image("cld:vision-ai/user/image-id|jpg")


def test_failed_storage_delete_keeps_scan_for_retry(monkeypatch) -> None:
    with TestClient(app) as client:
        register(client, "storage-retry@example.com")
        scan = create_scan(client)
        monkeypatch.setattr(api_module, "delete_image", lambda _stored_name: (_ for _ in ()).throw(StorageDeletionError("offline")))
        failed = client.delete(f"/api/scans/{scan['id']}")
        assert failed.status_code == 502
        assert failed.json()["request_id"]
        assert client.get(f"/api/scans/{scan['id']}").status_code == 200


def test_request_ids_and_global_rate_limit(monkeypatch) -> None:
    reset_rate_limits()
    original = api_module.settings.api_requests_per_minute
    monkeypatch.setattr(api_module.settings, "api_requests_per_minute", 1)
    try:
        with TestClient(app) as client:
            first = client.get("/api/scans", headers={"x-forwarded-for": "resilience-test"})
            assert first.status_code == 401
            assert first.headers["x-request-id"] == first.json()["request_id"]
            blocked = client.get("/api/scans", headers={"x-forwarded-for": "resilience-test"})
            assert blocked.status_code == 429
            assert blocked.json()["code"] == "rate_limited"
            assert int(blocked.headers["retry-after"]) >= 1
    finally:
        monkeypatch.setattr(api_module.settings, "api_requests_per_minute", original)
        reset_rate_limits()


def test_account_email_password_and_deletion_lifecycle() -> None:
    with TestClient(app) as owner, TestClient(app) as client:
        register(owner, "lifecycle-owner@example.com")
        register(client, "lifecycle-user@example.com")

        verification = client.post("/api/auth/email-verification/request")
        assert verification.status_code == 200, verification.text
        verification_token = verification.json()["debug_token"]
        verified = client.post("/api/auth/email-verification/confirm", json={"token": verification_token})
        assert verified.status_code == 200
        assert verified.json()["email_verified_at"] is not None
        assert client.post("/api/auth/email-verification/confirm", json={"token": verification_token}).status_code == 400

        changed = client.post("/api/auth/change-password", json={
            "current_password": "correct-horse-2026",
            "new_password": "changed-horse-2026",
        })
        assert changed.status_code == 200, changed.text
        assert client.post("/api/auth/logout").status_code == 200
        assert client.post("/api/auth/login", json={
            "email": "lifecycle-user@example.com", "password": "correct-horse-2026",
        }).status_code == 401
        assert client.post("/api/auth/login", json={
            "email": "lifecycle-user@example.com", "password": "changed-horse-2026",
        }).status_code == 200

        forgot = client.post("/api/auth/forgot-password", json={"email": "lifecycle-user@example.com"})
        reset_token = forgot.json()["debug_token"]
        reset = client.post("/api/auth/reset-password", json={
            "token": reset_token, "new_password": "reset-horse-2026",
        })
        assert reset.status_code == 200, reset.text
        assert client.get("/api/auth/me").status_code == 401
        assert client.post("/api/auth/login", json={
            "email": "lifecycle-user@example.com", "password": "reset-horse-2026",
        }).status_code == 200
        create_scan(client)
        deleted = client.request("DELETE", "/api/auth/account", json={
            "password": "reset-horse-2026", "confirmation": "DELETE",
        })
        assert deleted.status_code == 200, deleted.text
        assert client.get("/api/auth/me").status_code == 401
