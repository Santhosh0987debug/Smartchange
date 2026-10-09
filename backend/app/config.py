"""Environment-based configuration. No secrets committed — see .env.example."""
import os


def _origins(raw: str) -> list[str]:
    return [o.strip() for o in raw.split(",") if o.strip()]


DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./smartchange.db")
FRONTEND_ORIGINS = _origins(os.getenv(
    "FRONTEND_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"))
APP_NAME = os.getenv("APP_NAME", "SmartChange API")
APP_VERSION = os.getenv("APP_VERSION", "1.0.0")

# --- AI SOP assistant (optional; core app works without any provider) ---
# SMARTCHANGE_AI_PROVIDER: "none" (default) or "openai-compatible".
AI_PROVIDER = os.getenv("SMARTCHANGE_AI_PROVIDER", "none").lower()
AI_BASE_URL = os.getenv("SMARTCHANGE_AI_BASE_URL", "")
AI_API_KEY = os.getenv("SMARTCHANGE_AI_API_KEY", "")
AI_MODEL = os.getenv("SMARTCHANGE_AI_MODEL", "")
AI_TIMEOUT_SECONDS = float(os.getenv("SMARTCHANGE_AI_TIMEOUT_SECONDS", "20"))

# --- Document uploads (extracted text is stored in the DB; files are never kept) ---
DOCS_MAX_MB = float(os.getenv("SMARTCHANGE_DOCS_MAX_MB", "5"))
DOCS_ALLOWED_EXTENSIONS = {".pdf", ".txt"}
