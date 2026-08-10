from __future__ import annotations

import smtplib
from email.message import EmailMessage

import httpx

from .config import get_settings


def send_account_email(recipient: str, subject: str, action_url: str, action_label: str) -> bool:
    settings = get_settings()
    text = (
        f"{action_label}: {action_url}\n\n"
        f"Liên kết hết hạn sau {settings.account_token_minutes} phút. "
        "Nếu bạn không yêu cầu thao tác này, hãy bỏ qua email."
    )
    if settings.resend_api_key:
        response = httpx.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {settings.resend_api_key}", "User-Agent": "Vision-AI/1.0"},
            json={
                "from": settings.smtp_from_email,
                "to": [recipient],
                "subject": subject,
                "text": text,
            },
            timeout=15,
        )
        response.raise_for_status()
        return True
    if not settings.smtp_host:
        return False
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = settings.smtp_from_email
    message["To"] = recipient
    message.set_content(text)
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
        if settings.smtp_starttls:
            smtp.starttls()
        if settings.smtp_username:
            smtp.login(settings.smtp_username, settings.smtp_password or "")
        smtp.send_message(message)
    return True
