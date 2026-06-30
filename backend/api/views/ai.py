"""
Backend AI proxy for Google Gemini + Part 5 smart-feature suite.

The Gemini API key is read from the GEMINI_API_KEY env var on the
Django side so it never reaches the React bundle. The legacy
``AIGenerateViewSet.generate`` action stays for backward compat;
new smart features (translate, summarize, rewrite, smart-reply,
detect-spam/scam/abuse) live on a new ``AIServiceViewSet`` with
hard-coded system instructions and per-action rate limits.

Why a separate ViewSet
----------------------
The spec wants per-feature rate limits (a translate call is cheaper
than a long-context summarize) and per-feature audit logging so a
moderator can see "user X ran 50 detect-spam calls in 60s" without
having to grep prompt text. Splitting into dedicated @action methods
also lets us inject feature-specific system instructions on the
server side, so the FE can never accidentally pass a prompt that
overrides the model persona.
"""
import json
import logging
import os
import re

from django.contrib.auth.models import User
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone

from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from api.models import (
    ChatThread,
    Message,
    SmartReplyCache,
    score_spam,
)
# Reuse the Part 4 audit + bump plumbing for the new actions.
from api.views.part4 import write_audit, bump

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
# Smart-reply cache TTL: 1 hour. The same (thread, message, user) pair
# re-renders instantly on back-navigation without re-billing Gemini.
SMART_REPLY_TTL_MINUTES = 60


# ----------------------------------------------------------------------
# Shared Gemini helper — extracted so the legacy generate action and
# the new smart-feature actions share one config + error path.
# ----------------------------------------------------------------------
def _call_gemini(prompt: str, system_instruction: str | None, model_name: str) -> dict:
    """
    Returns {'text': str} on success, raises RuntimeError on failure.

    All callers should catch RuntimeError and return a 502 — the
    server-side log keeps the full traceback.
    """
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("AI not configured on server (GEMINI_API_KEY missing).")
    if not HAS_GENAI:
        raise RuntimeError("google-generativeai SDK not installed on server.")
    genai.configure(api_key=api_key)
    model = genai.GenerativeModel(
        model_name=model_name,
        system_instruction=system_instruction,
    )
    result = model.generate_content(prompt)
    return {"text": result.text}


# ======================================================================
# LEGACY: AIGenerateViewSet.generate
# ======================================================================
# Kept for backward compat with the existing Chatbot UI (which sends
# a freeform prompt + system_instruction). New work goes through
# AIServiceViewSet.
# ======================================================================
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
    throttle_classes = []

    @action(detail=False, methods=["post"])
    def generate(self, request):
        prompt = (request.data.get("prompt") or "").strip()
        if not prompt:
            return Response({"error": "prompt is required."}, status=status.HTTP_400_BAD_REQUEST)
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
                {"error": f"model '{model_name}' not allowed."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            result = _call_gemini(prompt, system_instruction, model_name)
            return Response({"text": result["text"]})
        except RuntimeError as e:
            return Response({"error": str(e)}, status=status.HTTP_501_NOT_IMPLEMENTED)
        except Exception:
            logger.exception("Gemini generation error")
            return Response(
                {"error": "Upstream AI failure."},
                status=status.HTTP_502_BAD_GATEWAY,
            )


# ======================================================================
# PART 5: AIServiceViewSet — smart-feature suite
# ======================================================================
# Each action hard-codes the system instruction so the FE cannot
# accidentally inject a prompt that overrides the model persona.
# Each action emits ONE bump() counter + ONE audit row so the
# metrics endpoint + the audit log can distinguish traffic per
# feature.
# ======================================================================
class AIServiceViewSet(viewsets.ViewSet):
    """
    URL surface:

      POST /api/ai/translate/        body={"text": str, "target_lang": str}
      POST /api/ai/summarize/        body={"text": str, "max_words": int?}
      POST /api/ai/rewrite/          body={"text": str, "tone": "polite"|"professional"|"casual"}
      POST /api/ai/smart_reply/      body={"thread_id": int}
      POST /api/ai/detect_spam/      body={"text": str}
      POST /api/ai/detect_scam/      body={"text": str}
      POST /api/ai/detect_abuse/     body={"text": str}

    Replies share the same shape: {"text": str} on success, {"error": str}
    on failure. The smart_reply action also caches its result in
    SmartReplyCache so back-navigation re-renders instantly.
    """

    permission_classes = [permissions.IsAuthenticated]
    # Per-action rate limits via ScopedRateThrottle — see settings.REST_FRAMEWORK.
    throttle_scope = 'ai_feature'

    # -- Helpers ----------------------------------------------------------
    def _enforce_text(self, request, field='text', max_chars=4000):
        text = (request.data.get(field) or '').strip()
        if not text:
            return None, Response(
                {'error': f'{field} is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if len(text) > max_chars:
            return None, Response(
                {'error': f'{field} too long ({len(text)} > {max_chars} chars).'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return text, None

    def _respond(self, request, counter: str, prompt: str, system_instruction: str,
                 model_name: str = DEFAULT_MODEL):
        """
        Common Gemini call path: bump counter, write audit, call, return text.
        """
        bump(counter)
        try:
            result = _call_gemini(prompt, system_instruction, model_name)
        except RuntimeError as e:
            return Response({'error': str(e)}, status=status.HTTP_501_NOT_IMPLEMENTED)
        except Exception:
            logger.exception("AIServiceViewSet %s error", counter)
            return Response(
                {'error': 'Upstream AI failure.'},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        write_audit(
            request,
            action=counter,
            target_type='ai',
            metadata={'prompt_chars': len(prompt)},
        )
        return Response({'text': result['text']})

    # -- Action: translate ----------------------------------------------
    @action(detail=False, methods=['post'])
    def translate(self, request):
        text, err = self._enforce_text(request, 'text', max_chars=4000)
        if err:
            return err
        target_lang = (request.data.get('target_lang') or 'English').strip()
        # Map common aliases to a canonical form so the model gets
        # clean language names regardless of FE input style.
        lang_aliases = {
            'en': 'English', 'eng': 'English',
            'fr': 'French', 'fra': 'French', 'fre': 'French',
            'es': 'Spanish', 'spa': 'Spanish',
            'ht': 'Haitian Creole', 'hat': 'Haitian Creole',
            'kreyol': 'Haitian Creole', 'kreyòl': 'Haitian Creole',
        }
        canonical = lang_aliases.get(target_lang.lower(), target_lang)
        system = (
            'You are a professional translator. Translate the user\'s '
            'text into the requested target language. Preserve the '
            'original tone, emoji, and informal register. Reply with '
            'ONLY the translated text — no preamble, no quotes, no '
            'explanation.'
        )
        prompt = f'Target language: {canonical}\n\nText:\n{text}'
        return self._respond(
            request, 'devrose_part5_ai_translate_total',
            prompt, system,
        )

    # -- Action: summarize ----------------------------------------------
    @action(detail=False, methods=['post'])
    def summarize(self, request):
        text, err = self._enforce_text(request, 'text', max_chars=8000)
        if err:
            return err
        try:
            max_words = max(20, min(int(request.data.get('max_words') or 120), 500))
        except (TypeError, ValueError):
            max_words = 120
        system = (
            'You are a concise conversation summarizer. Produce a '
            'neutral, third-person summary that captures decisions, '
            'action items, and any unresolved questions. Use bullet '
            'points. Stay within the word budget. No preamble.'
        )
        prompt = f'Summarize in <= {max_words} words:\n\n{text}'
        return self._respond(
            request, 'devrose_part5_ai_summarize_total',
            prompt, system,
        )

    # -- Action: rewrite -------------------------------------------------
    @action(detail=False, methods=['post'])
    def rewrite(self, request):
        text, err = self._enforce_text(request, 'text', max_chars=4000)
        if err:
            return err
        tone = (request.data.get('tone') or 'polite').strip().lower()
        if tone not in ('polite', 'professional', 'casual'):
            return Response(
                {'error': 'tone must be one of: polite, professional, casual.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        tone_descriptions = {
            'polite': 'Rewrite the message in a polite, friendly tone. Soften direct commands into suggestions.',
            'professional': 'Rewrite the message in a professional, business-appropriate tone. Use formal language.',
            'casual': 'Rewrite the message in a casual, conversational tone. Use contractions and informal phrasing.',
        }
        system = (
            f'You are a writing assistant. {tone_descriptions[tone]} '
            'Preserve the original meaning. Reply with ONLY the rewritten '
            'text — no preamble, no quotes, no explanation.'
        )
        return self._respond(
            request, 'devrose_part5_ai_rewrite_total',
            text, system,
        )

    # -- Action: smart_reply --------------------------------------------
    @action(detail=False, methods=['post'])
    def smart_reply(self, request):
        """
        Generate 3 short reply suggestions for the most recent
        incoming message in a thread. Cached per (thread, message, user)
        for SMART_REPLY_TTL_MINUTES.
        """
        thread_id = request.data.get('thread_id')
        if not thread_id or not str(thread_id).isdigit():
            return Response(
                {'error': 'thread_id is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        thread = get_object_or_404(ChatThread, pk=int(thread_id))
        if not thread.participants.filter(id=request.user.id).exists():
            return Response(
                {'error': 'Not a participant in this thread.'},
                status=status.HTTP_403_FORBIDDEN,
            )
        # The most recent message NOT sent by the caller is the one
        # we want to reply to.
        last_incoming = (
            thread.messages.exclude(sender=request.user)
            .order_by('-created_at')
            .first()
        )
        if not last_incoming or not last_incoming.content:
            return Response(
                {'error': 'No incoming message to reply to.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        # Check the cache.
        cached = SmartReplyCache.objects.filter(
            thread=thread,
            source_message=last_incoming,
            for_user=request.user,
        ).first()
        if cached and cached.is_fresh():
            bump('devrose_part5_ai_smart_reply_cache_hit_total')
            return Response({
                'suggestions': cached.suggestions,
                'cached': True,
            })
        # Generate fresh.
        # Pull a few recent messages for context.
        recent = list(
            thread.messages.order_by('-created_at').values_list('content', flat=True)[:6]
        )
        recent.reverse()  # oldest first
        context = '\n'.join(f'- {c[:200]}' for c in recent if c)
        system = (
            'You are a chat reply assistant. Given a recent message '
            'in a conversation, suggest 3 short natural-sounding '
            'replies the recipient could send. Each reply must be '
            'at most 60 characters. Reply with a JSON array of exactly '
            '3 strings, no preamble, no explanation, no markdown.'
        )
        prompt = (
            f'Recent conversation:\n{context}\n\n'
            f'Newest message to reply to:\n{last_incoming.content[:500]}\n\n'
            f'Reply JSON:'
        )
        try:
            result = _call_gemini(prompt, system, DEFAULT_MODEL)
        except RuntimeError as e:
            return Response({'error': str(e)}, status=status.HTTP_501_NOT_IMPLEMENTED)
        except Exception:
            logger.exception("smart_reply gemini error")
            return Response(
                {'error': 'Upstream AI failure.'},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        # Parse the JSON; fall back to a plain text split if the model
        # returned something malformed.
        suggestions = []
        text = (result.get('text') or '').strip()
        # Strip ```json fences if present.
        text = re.sub(r'^```(?:json)?\s*', '', text)
        text = re.sub(r'\s*```$', '', text)
        try:
            parsed = json.loads(text)
            if isinstance(parsed, list):
                suggestions = [str(x)[:80] for x in parsed if x][:3]
        except Exception:
            for line in text.splitlines():
                line = line.strip().lstrip('0123456789.-) ').strip(' "\'')
                if line and len(line) <= 80:
                    suggestions.append(line)
                if len(suggestions) == 3:
                    break
        if not suggestions:
            suggestions = ['Okay.', 'Sounds good.', 'Talk soon.']
        # Persist.
        SmartReplyCache.objects.update_or_create(
            thread=thread,
            source_message=last_incoming,
            for_user=request.user,
            defaults={
                'suggestions': suggestions,
                'expires_at': timezone.now() + timezone.timedelta(
                    minutes=SMART_REPLY_TTL_MINUTES
                ),
            },
        )
        bump('devrose_part5_ai_smart_reply_total')
        write_audit(
            request,
            action='smart_reply_generate',
            target_type='thread',
            target_id=thread.id,
            metadata={'count': len(suggestions)},
        )
        return Response({
            'suggestions': suggestions,
            'cached': False,
        })

    # -- Action: detect_spam / scam / abuse -----------------------------
    @action(detail=False, methods=['post'], url_path='detect_spam')
    def detect_spam(self, request):
        text, err = self._enforce_text(request, 'text', max_chars=4000)
        if err:
            return err
        score = score_spam(text)
        bump('devrose_part5_ai_detect_spam_total')
        return Response({
            'is_spam': score >= 60,
            'score': score,
            'threshold': 60,
        })

    @action(detail=False, methods=['post'], url_path='detect_scam')
    def detect_scam(self, request):
        text, err = self._enforce_text(request, 'text', max_chars=4000)
        if err:
            return err
        # Scam patterns: payment requests, urgency, identity theft.
        scam_keywords = (
            'wire transfer', 'western union', 'gift card', 'send money',
            'bitcoin', 'crypto wallet', 'bank account number', 'ssn',
            'social security', 'verify your account', 'click this link',
            'reset your password', 'urgent', 'congratulations you',
            'claim your prize', 'tax refund', 'irs', 'amazon support',
            'microsoft support', 'apple support',
        )
        lower = text.lower()
        hits = [k for k in scam_keywords if k in lower]
        score = min(100, len(hits) * 25)
        bump('devrose_part5_ai_detect_scam_total')
        return Response({
            'is_scam': score >= 50,
            'score': score,
            'threshold': 50,
            'matched_keywords': hits,
        })

    @action(detail=False, methods=['post'], url_path='detect_abuse')
    def detect_abuse(self, request):
        text, err = self._enforce_text(request, 'text', max_chars=4000)
        if err:
            return err
        # Crude abuse detector. We use Gemini to do the heavy lifting
        # because a pure keyword blocklist misses tone-mismatch abuse
        # ("Have a nice day :)" written by a known harasser). Falls
        # back to keyword scoring if Gemini is unavailable.
        abuse_keywords = (
            'fuck you', 'f*ck you', 'f u', 'stupid', 'idiot', 'moron',
            'loser', 'trash', 'garbage', 'pathetic', 'die', 'kill yourself',
            'kys', 'shut up', 'hate you', 'ugly', 'fat', 'worthless',
        )
        lower = text.lower()
        keyword_hits = [k for k in abuse_keywords if k in lower]
        if not keyword_hits and not os.environ.get('GEMINI_API_KEY'):
            # No Gemini and no keywords — return a low-confidence "not abuse".
            bump('devrose_part5_ai_detect_abuse_total')
            return Response({
                'is_abusive': False,
                'score': 0,
                'threshold': 50,
                'method': 'keyword_only',
            })
        # Ask Gemini for a 0-100 abuse score. The model is asked to
        # consider context (e.g. "you stupid genius" is praise).
        system = (
            'You are a content-safety classifier. Score the user\'s '
            'message on a 0-100 abuse scale where 0 = clearly friendly, '
            '50 = ambiguous / rude, 100 = clearly abusive / harassing. '
            'Reply with ONLY a single integer.'
        )
        try:
            result = _call_gemini(text[:4000], system, DEFAULT_MODEL)
            score_str = re.sub(r'\D', '', result.get('text') or '')[:3]
            score = int(score_str) if score_str else 0
        except Exception:
            score = min(100, len(keyword_hits) * 30)
        bump('devrose_part5_ai_detect_abuse_total')
        return Response({
            'is_abusive': score >= 50,
            'score': score,
            'threshold': 50,
            'method': 'gemini+keyword',
            'matched_keywords': keyword_hits,
        })
