"""Sonakshi brain: FastAPI webhook -> Gemini, plus the notification feed that n8n writes to.

  POST /ask                  voice/text question -> {"reply"}          (client key)
  POST /api/notify           n8n -> feed + live stream + Web Push      (NOTIFY key)
  GET  /api/feed?after=N     items newer than seq N                    (client key)
  GET  /api/stream?after=N   Server-Sent Events: backlog, then live    (client key)
  GET  /api/push/key         VAPID public key                          (client key)
  POST /api/push/subscribe   register a browser for Web Push           (client key)
  POST /api/push/unsubscribe
"""
import asyncio, base64, hmac, json, os, re, time, uuid
from collections import deque
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import httpx
from fastapi import BackgroundTasks, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

SECRET = os.environ["SONAKSHI_KEY"]                 # shipped inside the app/web build: ask + read the feed
NOTIFY_KEY = os.getenv("NOTIFY_KEY") or SECRET      # n8n only: the only key that can write to the feed
GEMINI_KEY = os.environ["GEMINI_API_KEY"]
MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")   # check the current free-tier model name
URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent"

DATA_DIR = Path(os.getenv("DATA_DIR", "."))
FEED_FILE, SUBS_FILE = DATA_DIR / "feed.json", DATA_DIR / "push_subs.json"
FEED_MAX = 200
MAX_SUBS = 50
# timestamps sent without a timezone are read in this offset (default IST, +05:30)
NAIVE_TZ = timezone(timedelta(minutes=int(os.getenv("NAIVE_TZ_OFFSET_MIN", "330"))))

SYSTEM = (
    "You are Sonakshi, a personal voice assistant. Your reply is spoken aloud: "
    "answer in one or two short sentences, plain text only, no markdown, no lists."
)

app = FastAPI()
http = httpx.AsyncClient(timeout=7.0)
history: deque = deque(maxlen=6)               # last 3 exchanges
last_seen = 0.0

# The Android WebView page is https://localhost; add your web origin(s) here if the web build is hosted elsewhere.
ORIGINS = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "https://localhost,http://localhost,capacitor://localhost").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware, allow_origins=ORIGINS, allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-Sonakshi-Key"], max_age=600,
)


def check(given: str, *allowed: str) -> None:
    if not any(hmac.compare_digest(given.encode(), a.encode()) for a in allowed):
        raise HTTPException(401, "bad key")


# ───────────────────────── feed store ─────────────────────────
def _load(path: Path, default):
    try:
        return json.loads(path.read_text("utf-8"))
    except (OSError, ValueError):
        return default


def _save(path: Path, data) -> None:
    try:
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data), "utf-8")
        tmp.replace(path)
    except OSError:
        pass                                    # read-only / ephemeral disk: stay in memory


feed: deque = deque((i for i in _load(FEED_FILE, []) if isinstance(i, dict) and "seq" in i), maxlen=FEED_MAX)
seq = max((i["seq"] for i in feed), default=0)
subs: dict = {s["endpoint"]: s for s in _load(SUBS_FILE, []) if isinstance(s, dict) and "endpoint" in s}
listeners: set = set()                          # one asyncio.Queue per open /api/stream


def norm_cat(c: str) -> str:
    return re.sub(r"[^a-z0-9_]", "", re.sub(r"[\s-]+", "_", c.strip().lower()))[:40] or "notification"


def parse_ts(s: Optional[str]) -> datetime:
    if s:
        try:
            d = datetime.fromisoformat(s.strip().replace("Z", "+00:00"))
            if d.tzinfo is None:
                d = d.replace(tzinfo=NAIVE_TZ)
            return d.astimezone(timezone.utc)
        except ValueError:
            pass
    return datetime.now(timezone.utc)


def sse(item: dict, event: str) -> str:
    return f"event: {event}\nid: {item['seq']}\ndata: {json.dumps(item)}\n\n"


class Notify(BaseModel):
    title: str = Field(default="Sonakshi", max_length=160)
    text: str = Field(min_length=1, max_length=8000)
    timestamp: Optional[str] = None             # ISO 8601; filled with "now" when missing or unparsable
    category: str = Field(default="notification", max_length=40)


# ───────────────────────── Web Push (optional) ─────────────────────────
def _load_vapid():
    pem = os.getenv("VAPID_PRIVATE_KEY_PEM", "").replace("\\n", "\n").encode()
    if not pem:
        p = Path(os.getenv("VAPID_PRIVATE_KEY_FILE", "vapid_private.pem"))
        if p.is_file():
            pem = p.read_bytes()
    if not pem:
        return None, None
    try:
        from cryptography.hazmat.primitives import serialization
        from py_vapid import Vapid
        pub = serialization.load_pem_private_key(pem, password=None).public_key().public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
        return Vapid.from_pem(pem), base64.urlsafe_b64encode(pub).rstrip(b"=").decode()
    except Exception as e:                      # bad key or pywebpush missing: run without push
        print(f"[push] disabled: {e}")
        return None, None


VAPID, VAPID_PUBLIC = _load_vapid()
VAPID_SUBJECT = os.getenv("VAPID_SUBJECT", "mailto:admin@example.com")


def _send_one(sub: dict, payload: str):
    from pywebpush import WebPushException, webpush
    try:
        webpush(subscription_info=sub, data=payload, vapid_private_key=VAPID,
                vapid_claims={"sub": VAPID_SUBJECT}, ttl=86400)   # ttl: deliver later if the phone is offline
        return None
    except WebPushException as e:
        return getattr(e.response, "status_code", -1)
    except Exception:
        return -1


async def push_all(item: dict) -> None:
    if not (VAPID and subs):
        return
    body = re.sub(r"\s+", " ", item["text"]).strip()[:180]
    payload = json.dumps({"id": item["id"], "seq": item["seq"], "title": item["title"], "body": body, "category": item["category"]})
    eps = list(subs)
    codes = await asyncio.gather(*(asyncio.to_thread(_send_one, subs[e], payload) for e in eps))
    for ep, code in zip(eps, codes):
        if code in (404, 410):                  # browser unsubscribed or the subscription expired
            subs.pop(ep, None)
    _save(SUBS_FILE, list(subs.values()))


# ───────────────────────── routes ─────────────────────────
class Ask(BaseModel):
    text: str = Field(min_length=1, max_length=500)


@app.get("/health")
async def health():
    return {"ok": True}


@app.post("/ask")
async def ask(body: Ask, x_sonakshi_key: str = Header(default="")):
    global last_seen
    check(x_sonakshi_key, SECRET)

    now = time.time()
    if now - last_seen > 120:                  # new conversation after 2 min of quiet
        history.clear()
    last_seen = now

    contents = list(history) + [{"role": "user", "parts": [{"text": body.text}]}]
    payload = {
        "system_instruction": {"parts": [{"text": SYSTEM}]},
        "contents": contents,
        "generationConfig": {
            "maxOutputTokens": 120,
            "temperature": 0.7,
            "thinkingConfig": {"thinkingBudget": 0},   # skip "thinking" for latency
        },
    }
    t0 = time.perf_counter()
    try:
        r = await http.post(URL, params={"key": GEMINI_KEY}, json=payload)
        r.raise_for_status()
        reply = r.json()["candidates"][0]["content"]["parts"][0]["text"].strip()
    except (httpx.HTTPError, KeyError, IndexError):
        raise HTTPException(502, "model unavailable")

    history.append({"role": "user", "parts": [{"text": body.text}]})
    history.append({"role": "model", "parts": [{"text": reply}]})
    return {"reply": reply, "ms": int((time.perf_counter() - t0) * 1000)}


@app.post("/api/notify", status_code=201)
async def notify(body: Notify, background: BackgroundTasks, x_sonakshi_key: str = Header(default="")):
    """n8n posts {title, text, timestamp, category} here."""
    global seq
    check(x_sonakshi_key, NOTIFY_KEY)
    seq += 1
    item = {
        "id": uuid.uuid4().hex, "seq": seq,
        "title": body.title.strip() or "Sonakshi",
        "text": body.text.strip(),
        "category": norm_cat(body.category),
        "timestamp": parse_ts(body.timestamp).isoformat().replace("+00:00", "Z"),
    }
    feed.append(item)
    _save(FEED_FILE, list(feed))
    for q in list(listeners):                   # live listeners get it instantly
        try:
            q.put_nowait(item)
        except asyncio.QueueFull:
            pass
    background.add_task(push_all, item)         # everyone else gets a Web Push
    return {"ok": True, "id": item["id"], "seq": seq, "live_listeners": len(listeners), "push_devices": len(subs)}


@app.get("/api/feed")
async def get_feed(after: int = 0, limit: int = 100, x_sonakshi_key: str = Header(default="")):
    check(x_sonakshi_key, SECRET, NOTIFY_KEY)
    items = [i for i in feed if i["seq"] > after][-max(1, min(limit, FEED_MAX)):]
    return {"items": items, "last_seq": seq}


@app.get("/api/stream")
async def stream(request: Request, after: int = 0, x_sonakshi_key: str = Header(default="")):
    check(x_sonakshi_key, SECRET, NOTIFY_KEY)
    q: asyncio.Queue = asyncio.Queue(maxsize=100)
    listeners.add(q)                            # register first so nothing falls between backlog and live

    async def gen():
        try:
            for it in [i for i in feed if i["seq"] > after]:
                yield sse(it, "backlog")        # replayed: the app shows it but does not raise a notification
            while not await request.is_disconnected():
                try:
                    yield sse(await asyncio.wait_for(q.get(), 25), "item")
                except asyncio.TimeoutError:
                    yield ": ping\n\n"          # keeps proxies from closing an idle stream
        finally:
            listeners.discard(q)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


class Sub(BaseModel):
    endpoint: str = Field(max_length=1000)
    expirationTime: Optional[float] = None
    keys: dict


class Unsub(BaseModel):
    endpoint: str = Field(max_length=1000)


@app.get("/api/push/key")
async def push_key(x_sonakshi_key: str = Header(default="")):
    check(x_sonakshi_key, SECRET, NOTIFY_KEY)
    if not VAPID_PUBLIC:
        raise HTTPException(404, "push not configured")
    return {"publicKey": VAPID_PUBLIC}


@app.post("/api/push/subscribe")
async def push_subscribe(sub: Sub, x_sonakshi_key: str = Header(default="")):
    check(x_sonakshi_key, SECRET, NOTIFY_KEY)
    if not VAPID:
        raise HTTPException(404, "push not configured")
    if not sub.endpoint.startswith("https://") or not {"p256dh", "auth"} <= set(sub.keys):
        raise HTTPException(422, "invalid subscription")
    if sub.endpoint not in subs and len(subs) >= MAX_SUBS:
        raise HTTPException(429, "too many subscriptions")
    subs[sub.endpoint] = sub.model_dump()
    _save(SUBS_FILE, list(subs.values()))
    return {"ok": True}


@app.post("/api/push/unsubscribe")
async def push_unsubscribe(body: Unsub, x_sonakshi_key: str = Header(default="")):
    check(x_sonakshi_key, SECRET, NOTIFY_KEY)
    subs.pop(body.endpoint, None)
    _save(SUBS_FILE, list(subs.values()))
    return {"ok": True}


# Serve the web build (../app/www) from the same origin, so the browser version needs no CORS. Keep this LAST.
WWW = Path(os.getenv("WWW_DIR", str(Path(__file__).resolve().parent.parent / "app" / "www")))
if WWW.is_dir():
    app.mount("/", StaticFiles(directory=WWW, html=True), name="web")
