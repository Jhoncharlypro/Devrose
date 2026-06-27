"""
Backend AI proxy for Google Gemini.

The Gemini API key is read from the GEMINI_API_KEY env var on the Django side,
so it never reaches the React bundle. Frontend components call /api/ai/generate/
with `{prompt, system_instruction, model}` and get back `{text}`.
"""
import logging
import os

from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

logger = logging.getLogger(__name__)

try:
    import google.generativeai as genai  # noqa: E402
    HAS_GENAI = True
except ImportError:
    HAS_GENAI = False

# Restrict callers to a known set of cheap Gemini models so they can't
# quietly burn budget on a future "ultra" tier.
ALLOWED_MODELS = {"gemini-1.5-flash", "gemini-1.5-pro"}
DEFAULT_MODEL = "gemini-1.5-flash"
# 8k chars is plenty for a single prompt — anything bigger is almost
# certainly abuse or accidentally-pasted code that costs real money.
MAX_PROMPT_CHARS = 8000
MAX_SYSTEM_INSTRUCTION_CHARS = 2000


class AIGenerateViewSet(viewsets.ViewSet):
    """Single endpoint that proxies user prompts to Gemini.

    URL:    POST /api/ai/generate/
    Body:   {"prompt": str, "system_instruction": str (optional), "model": str (optional)}
    Reply:  {"text": str}            on success
            {"error": str}           on 400/501/502/429

    Security:
    - IsAuthenticated         → no anonymous abuse.
    - UserRateThrottle        → per-user 30/min cap (configured in settings.REST_FRAMEWORK).
    - ALLOWED_MODELS          → caller cannot pick expensive tiers.
    - MAX_*_CHARS             → prompt / system_instruction size cap.
    - Exception `detail`      → NOT exposed to client (kept in server logs only).
    """

    permission_classes = [permissions.IsAuthenticated]
    throttle_classes = []  # the default UserRateThrottle from settings picks this up via DRF defaults

    @action(detail=False, methods=["post"])
    def generate(self, request):
        if not HAS_GENAI:
            return Response(
                {"error": "google-generativeai SDK not installed on server."},
                status=status.HTTP_501_NOT_IMPLEMENTED,
            )

        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            return Response(
                {"error": "AI not configured on server (GEMINI_API_KEY missing)."},
                status=status.HTTP_501_NOT_IMPLEMENTED,
            )

        prompt = (request.data.get("prompt") or "").strip()
        if not prompt:
            return Response(
                {"error": "prompt is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if len(prompt) > MAX_PROMPT_CHARS:
            return Response(
                {"error": f"prompt too long ({len(prompt)} > {MAX_PROMPT_CHARS} chars)."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        system_instruction = request.data.get("system_instruction") or None
        if system_instruction and len(system_instruction) > MAX_SYSTEM_INSTRUCTION_CHARS:
            return Response(
                {"error": f"system_instruction too long ({len(system_instruction)} > {MAX_SYSTEM_INSTRUCTION_CHARS} chars)."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        model_name = request.data.get("model") or DEFAULT_MODEL
        if model_name not in ALLOWED_MODELS:
            return Response(
                {"error": f"model '{model_name}' not allowed. Choose one of: {sorted(ALLOWED_MODELS)}."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            genai.configure(api_key=api_key)
            model = genai.GenerativeModel(
                model_name=model_name,
                system_instruction=system_instruction,
            )
            result = model.generate_content(prompt)
            return Response({"text": result.text})
        except Exception:
            # Log full traceback server-side, but DO NOT echo internals to the client.
            logger.exception("Gemini generation error")
            return Response(
                {"error": "Upstream AI failure."},
                status=status.HTTP_502_BAD_GATEWAY,
            )
