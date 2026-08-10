from __future__ import annotations

import io
import json
import os
import tempfile
from pathlib import Path

from PIL import Image


TEST_DIR = Path(tempfile.mkdtemp(prefix="vision-ai-tests-"))
os.environ["VISION_AI_DATABASE_URL"] = f"sqlite:///{(TEST_DIR / 'test.db').as_posix()}"
os.environ["VISION_AI_UPLOAD_DIR"] = str(TEST_DIR / "uploads")
os.environ["VISION_AI_CLOUDINARY_URL"] = ""
os.environ["VISION_AI_ENCRYPTION_KEY"] = "test-only-encryption-key-32-characters-long"

from fastapi.testclient import TestClient  # noqa: E402
import pyotp  # noqa: E402

from app.main import app  # noqa: E402


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
    })
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
