#!/usr/bin/env python3
"""Production-ready local family portal (hybrid: public Pages + protected LAN portal).

Features:
- Per-user auth (PBKDF2-HMAC-SHA256), first-login password change, admin reset.
- Session cookie (HttpOnly, SameSite=Lax, optional Secure), CSRF token for POST.
- Role: admin + family users. Admin can manage users, gallery/news, upload photos, publish.
- Public view (unauth) gets sanitized data; authenticated gets full data.
- Health endpoint, rate-limited login, basic request limits.
- CLI: init-users, set-password, list-users, run (default).

Secrets outside repo by default: /root/.config/opencode/secrets/family_site_users.json
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import mimetypes
import os
import re
import secrets
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

SITE = Path(__file__).resolve().parent
ASSETS = SITE / "assets"
PHOTOS = ASSETS / "photos"
DATA_JSON = ASSETS / "site-data.json"
DATA_JS = ASSETS / "data.js"
DEFAULT_USERS_FILE = Path("/root/.config/opencode/secrets/family_site_users.json")
SYNC_SCRIPT = Path("/root/workspace/homelab/site_github_sync.py")
CONTENT_FILE = Path("/root/.config/opencode/secrets/family_site_content.json")
USER_PHOTOS = ASSETS / "user-photos"
COOKIE = "family_portal_session"
CSRF_HEADER = "X-CSRF-Token"
PBKDF2_ITER = 200_000
SESSION_TTL = 12 * 3600
MAX_BODY = 8 * 1024 * 1024  # 8MB (photo uploads)
LOGIN_WINDOW = 300
LOGIN_MAX_FAILS = 10

_lock = threading.Lock()
SESSIONS: dict[str, dict] = {}
LOGIN_FAILS: dict[str, list[float]] = {}


def now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def read_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def write_json(path: Path, data, mode=0o600) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)
    try:
        os.chmod(path, mode)
    except OSError:
        pass


def b64e(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def b64d(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def pw_hash(password: str, salt: bytes, it: int = PBKDF2_ITER) -> str:
    return b64e(hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, it))


def pw_verify(user: dict, password: str) -> bool:
    try:
        salt = b64d(user["salt"])
        it = int(user.get("iterations", PBKDF2_ITER))
        expected = user.get("pw_hash", "")
        actual = pw_hash(password, salt, it)
        return hmac.compare_digest(actual, expected)
    except Exception:
        return False


def sign(value: str, secret: bytes) -> str:
    return value + "." + b64e(hmac.new(secret, value.encode("utf-8"), hashlib.sha256).digest())


def unsign(token: str, secret: bytes) -> str | None:
    if "." not in token:
        return None
    value, sig = token.rsplit(".", 1)
    good = b64e(hmac.new(secret, value.encode("utf-8"), hashlib.sha256).digest())
    return value if hmac.compare_digest(good, sig) else None


class PortalConfig:
    def __init__(self, users_file: Path = DEFAULT_USERS_FILE, secure_cookie: bool = False):
        self.users_file = users_file
        self.secure_cookie = secure_cookie

    def load_users(self) -> dict:
        data = read_json(self.users_file, None)
        if not isinstance(data, dict) or "users" not in data:
            raise RuntimeError(f"Нет файла пользователей {self.users_file}. Выполните init-users.")
        if "secret" not in data:
            data["secret"] = b64e(secrets.token_bytes(32))
            self.save_users(data)
        return data

    def save_users(self, data: dict) -> None:
        write_json(self.users_file, data, mode=0o600)


CFG = PortalConfig()


def site_data() -> dict:
    if DATA_JSON.exists():
        d = read_json(DATA_JSON, None)
        if isinstance(d, dict) and "SITE_DATA" in d:
            return d
    p = subprocess.run(
        ["node", "-e", "global.window=global;require('./assets/data.js');process.stdout.write(JSON.stringify({SITE_DATA:window.SITE_DATA,SITE_MODULES:window.SITE_MODULES,SITE_DEMO_TASKS:window.SITE_DEMO_TASKS}))"],
        cwd=str(SITE), text=True, capture_output=True,
    )
    if p.returncode != 0:
        raise RuntimeError("Не удалось прочитать data.js: " + (p.stderr or p.stdout)[-300:])
    data = json.loads(p.stdout)
    write_json(DATA_JSON, data, mode=0o644)
    return data


def generate_data_js(data: dict) -> None:
    js = (
        "/* Автоматически сгенерировано portal_server.py из assets/site-data.json. */\n"
        "window.SITE_DATA = " + json.dumps(data["SITE_DATA"], ensure_ascii=False, indent=2) + ";\n\n"
        "window.SITE_MODULES = " + json.dumps(data.get("SITE_MODULES", {}), ensure_ascii=False, indent=2) + ";\n\n"
        "window.SITE_DEMO_TASKS = " + json.dumps(data.get("SITE_DEMO_TASKS", {}), ensure_ascii=False, indent=2) + ";\n\n"
        "window.SITE_CONFIG = " + json.dumps(data.get("SITE_CONFIG", {}), ensure_ascii=False, indent=2) + ";\n"
    )
    DATA_JS.write_text(js, encoding="utf-8")


def save_site_data(data: dict) -> None:
    if not isinstance(data, dict) or "SITE_DATA" not in data:
        raise ValueError("Некорректные данные: нет SITE_DATA")
    sd = data["SITE_DATA"]
    if not isinstance(sd.get("members"), list) or not isinstance(sd.get("gallery"), list):
        raise ValueError("SITE_DATA.members/gallery должны быть списками")
    if "SITE_MODULES" not in data:
        data["SITE_MODULES"] = site_data().get("SITE_MODULES", {})
    if "SITE_DEMO_TASKS" not in data:
        data["SITE_DEMO_TASKS"] = site_data().get("SITE_DEMO_TASKS", {})
    write_json(DATA_JSON, data, mode=0o644)
    generate_data_js(data)


def load_content() -> dict:
    data = read_json(CONTENT_FILE, None)
    if not isinstance(data, dict):
        data = {}
    for key in ("profiles", "stories", "photos"):
        if not isinstance(data.get(key), dict):
            data[key] = {}
    return data


def save_content(data: dict) -> None:
    write_json(CONTENT_FILE, data, mode=0o600)


def user_content(uid: str) -> dict:
    c = load_content()
    return {
        "profile": c["profiles"].get(uid, {}),
        "stories": c["stories"].get(uid, []),
        "photos": c["photos"].get(uid, []),
    }


def merged_site_data() -> dict:
    """Site data with private user content merged for authenticated family view."""
    d = json.loads(json.dumps(site_data()))  # deep copy
    c = load_content()
    for m in d.get("SITE_DATA", {}).get("members", []):
        uid = m["id"]
        m["about"] = c["profiles"].get(uid, {}).get("about", "")
        m["details"] = c["profiles"].get(uid, {}).get("details", {})
        m["stories"] = c["stories"].get(uid, [])
        m["userPhotos"] = c["photos"].get(uid, [])
    return d


def public_data_js() -> bytes:
    d = site_data()
    sd = dict(d.get("SITE_DATA", {}))
    # Unauthenticated portal view: hide private family details
    sd["members"] = [{
        "id": m.get("id", ""),
        "name": m.get("name", ""),
        "short": m.get("short", ""),
        "role": m.get("role", ""),
        "initials": m.get("initials", "?"),
        "color": m.get("color", "#2f6d63"),
        "status": "",
        "note": "Войдите в раздел для семьи",
        "relation": "",
        "modules": ["overview"],
    } for m in sd.get("members", [])]
    sd["familyTree"] = []
    sd["gallery"] = []
    sd["news"] = sd.get("news", [])
    pub = {"SITE_DATA": sd, "SITE_MODULES": d.get("SITE_MODULES", {}), "SITE_DEMO_TASKS": {}}
    js = (
        "/* public view - portal unauthenticated */\n"
        "window.SITE_DATA=" + json.dumps(pub["SITE_DATA"], ensure_ascii=False) + ";\n"
        "window.SITE_MODULES=" + json.dumps(pub["SITE_MODULES"], ensure_ascii=False) + ";\n"
        "window.SITE_DEMO_TASKS=" + json.dumps(pub["SITE_DEMO_TASKS"], ensure_ascii=False) + ";\n"
        "window.SITE_CONFIG=" + json.dumps(d.get("SITE_CONFIG", {}), ensure_ascii=False) + ";\n"
        "window.PORTAL_AUTH={required:true,authenticated:false};\n"
    )
    return js.encode("utf-8")


def full_data_js(sess: dict | None = None) -> bytes:
    d = merged_site_data()
    auth = {"required": True, "authenticated": True}
    if sess:
        auth["user"] = {"id": sess["uid"], "name": sess["user"].get("name", ""), "is_admin": bool(sess.get("is_admin"))}
        auth["csrf"] = sess.get("csrf", "")
    js = (
        "/* authenticated view */\n"
        "window.SITE_DATA=" + json.dumps(d.get("SITE_DATA", {}), ensure_ascii=False) + ";\n"
        "window.SITE_MODULES=" + json.dumps(d.get("SITE_MODULES", {}), ensure_ascii=False) + ";\n"
        "window.SITE_DEMO_TASKS=" + json.dumps(d.get("SITE_DEMO_TASKS", {}), ensure_ascii=False) + ";\n"
        "window.SITE_CONFIG=" + json.dumps(d.get("SITE_CONFIG", {}), ensure_ascii=False) + ";\n"
        "window.PORTAL_AUTH=" + json.dumps(auth, ensure_ascii=False) + ";\n"
    )
    return js.encode("utf-8")


def safe_filename(name: str) -> str:
    name = os.path.basename(name or "photo.jpg")
    name = re.sub(r"[^A-Za-z0-9._-]+", "-", name).strip(".-")
    return name or "photo.jpg"


def login_allowed(ip: str) -> bool:
    nowt = time.time()
    with _lock:
        fails = [t for t in LOGIN_FAILS.get(ip, []) if nowt - t < LOGIN_WINDOW]
        LOGIN_FAILS[ip] = fails
        return len(fails) < LOGIN_MAX_FAILS


def login_fail(ip: str) -> None:
    nowt = time.time()
    with _lock:
        fails = [t for t in LOGIN_FAILS.get(ip, []) if nowt - t < LOGIN_WINDOW]
        fails.append(nowt)
        LOGIN_FAILS[ip] = fails


def login_ok(ip: str) -> None:
    with _lock:
        LOGIN_FAILS.pop(ip, None)


def clean_sessions() -> None:
    nowt = time.time()
    with _lock:
        dead = [sid for sid, s in SESSIONS.items() if nowt - s.get("ts", nowt) > SESSION_TTL]
        for sid in dead:
            SESSIONS.pop(sid, None)


class Handler(BaseHTTPRequestHandler):
    server_version = "FamilyPortal/2.0"

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _send(self, status, body: bytes, ctype="application/json; charset=utf-8", headers=None):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        self.send_header("Cache-Control", "no-store")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _json(self, status, obj, headers=None):
        self._send(status, json.dumps(obj, ensure_ascii=False).encode("utf-8"), headers=headers)

    def _body(self) -> bytes:
        n = int(self.headers.get("Content-Length", "0") or "0")
        if n < 0 or n > MAX_BODY:
            raise ValueError("Слишком большой запрос")
        return self.rfile.read(n) if n > 0 else b""

    def _jbody(self) -> dict:
        try:
            data = json.loads(self._body().decode("utf-8") or "{}")
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    def _cookie(self, name: str) -> str | None:
        c = SimpleCookie(self.headers.get("Cookie", ""))
        m = c.get(name)
        return m.value if m else None

    def _session(self):
        clean_sessions()
        token = self._cookie(COOKIE)
        if not token:
            return None
        try:
            udb = CFG.load_users()
        except Exception:
            return None
        sid = unsign(token, b64d(udb["secret"]))
        if not sid:
            return None
        with _lock:
            s = SESSIONS.get(sid)
        if not s:
            return None
        if time.time() - s.get("ts", 0) > SESSION_TTL:
            with _lock:
                SESSIONS.pop(sid, None)
            return None
        user = next((x for x in udb.get("users", []) if x["id"] == s["uid"]), None)
        if not user:
            return None
        return {"sid": sid, "uid": s["uid"], "user": user, "is_admin": bool(user.get("is_admin")), "csrf": s.get("csrf", "")}

    def _set_cookie(self, sid: str) -> str:
        udb = CFG.load_users()
        token = sign(sid, b64d(udb["secret"]))
        secure = "; Secure" if CFG.secure_cookie else ""
        return f"{COOKIE}={token}; HttpOnly; SameSite=Lax; Path=/; Max-Age={SESSION_TTL}{secure}"

    def _clear_cookie(self) -> str:
        secure = "; Secure" if CFG.secure_cookie else ""
        return f"{COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0{secure}"

    def _require_auth(self, allow_first_login=False):
        s = self._session()
        if not s:
            self._json(401, {"ok": False, "error": "Нужен вход"})
            return None
        if s["user"].get("first_login") and not allow_first_login:
            self._json(403, {"ok": False, "error": "Смените пароль", "first_login": True})
            return None
        return s

    def _require_admin(self):
        s = self._require_auth()
        if not s:
            return None
        if not s.get("is_admin"):
            self._json(403, {"ok": False, "error": "Только админ"})
            return None
        return s

    def _check_csrf(self, sess: dict | None) -> bool:
        # Login has no session yet - allow but rate-limited. Others require CSRF.
        if not sess:
            return True
        token = self.headers.get(CSRF_HEADER, "")
        return bool(token) and hmac.compare_digest(token, sess.get("csrf", ""))

    def do_GET(self):
        try:
            self._handle_get()
        except Exception as e:
            self._json(500, {"ok": False, "error": "Ошибка сервера"})

    def do_POST(self):
        try:
            self._handle_post()
        except ValueError as e:
            self._json(400, {"ok": False, "error": str(e)})
        except Exception as e:
            self._json(500, {"ok": False, "error": "Ошибка сервера"})

    def _handle_get(self):
        p = unquote(urlparse(self.path).path)
        if p == "/api/portal/health":
            return self._json(200, {"ok": True, "time": now(), "version": "2.0"})
        if p == "/api/portal/me":
            s = self._session()
            if not s:
                return self._json(200, {"ok": True, "authenticated": False})
            u = s["user"]
            return self._json(200, {"ok": True, "authenticated": True, "id": u["id"], "name": u.get("name", ""), "is_admin": bool(u.get("is_admin")), "first_login": bool(u.get("first_login")), "csrf": s.get("csrf", "")})
        if p == "/api/portal/users":
            s = self._require_admin()
            if not s:
                return
            udb = CFG.load_users()
            users = [{"id": u["id"], "name": u.get("name", ""), "is_admin": bool(u.get("is_admin")), "first_login": bool(u.get("first_login"))} for u in udb.get("users", [])]
            return self._json(200, {"ok": True, "users": users})
        if p == "/api/portal/data":
            s = self._require_admin()
            if not s:
                return
            return self._json(200, {"ok": True, "data": site_data()})
        if p == "/api/portal/content":
            s = self._require_auth()
            if not s:
                return
            return self._json(200, {"ok": True, "uid": s["uid"], "content": user_content(s["uid"])})
        if p == "/api/portal/config":
            s = self._require_auth()
            if not s:
                return
            d = site_data()
            return self._json(200, {"ok": True, "config": d.get("SITE_CONFIG", {})})
        if p == "/assets/data.js":
            s = self._session()
            body = full_data_js(s) if s and not s["user"].get("first_login") else public_data_js()
            return self._send(200, body, "application/javascript; charset=utf-8")
        # static files
        rel = p.lstrip("/") or "index.html"
        if rel.startswith("assets/user-photos/"):
            s = self._session()
            parts = rel.split("/")
            owner = parts[2] if len(parts) > 2 else ""
            if not s or (owner != s["uid"] and not s.get("is_admin")):
                return self._json(404, {"ok": False, "error": "Not found"})
        target = (SITE / rel).resolve()
        if SITE != target and SITE not in target.parents:
            return self._json(403, {"ok": False, "error": "Forbidden"})
        if target.is_dir():
            target = target / "index.html"
        if not target.is_file():
            return self._json(404, {"ok": False, "error": "Not found"})
        ctype = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        body = target.read_bytes()
        hdr = {"Cache-Control": "no-store"} if target.suffix in {".html", ".js", ".json"} else {"Cache-Control": "public, max-age=3600"}
        self._send(200, body, ctype, hdr)

    def _handle_post(self):
        p = unquote(urlparse(self.path).path)
        # routes that may be multipart
        if p == "/api/portal/admin/upload-photo":
            return self._admin_upload_photo()
        if p == "/api/portal/content/photo-upload":
            return self._user_photo_upload()
        body = self._jbody()
        routes = {
            "/api/portal/login": lambda: self._login(body),
            "/api/portal/logout": lambda: self._logout(),
            "/api/portal/change-password": lambda: self._change_pw(body),
            "/api/portal/admin/reset-password": lambda: self._admin_reset(body),
            "/api/portal/admin/save-data": lambda: self._admin_save_data(body),
            "/api/portal/admin/publish": lambda: self._admin_publish(body),
            "/api/portal/admin/set-password": lambda: self._admin_set_password(body),
            "/api/portal/content/profile": lambda: self._save_profile(body),
            "/api/portal/content/story": lambda: self._save_story(body),
            "/api/portal/content/photo-remove": lambda: self._remove_photo(body),
            "/api/portal/admin/save-config": lambda: self._admin_save_config(body),
        }
        fn = routes.get(p)
        if not fn:
            return self._json(404, {"ok": False, "error": "Not found"})
        return fn()

    def _login(self, b):
        ip = self.client_address[0] if self.client_address else "?"
        if not login_allowed(ip):
            return self._json(429, {"ok": False, "error": "Слишком много попыток входа. Подождите несколько минут."})
        uid = str(b.get("username", "")).strip()
        pw = str(b.get("password", ""))
        try:
            udb = CFG.load_users()
        except Exception as e:
            return self._json(500, {"ok": False, "error": str(e)})
        user = next((u for u in udb.get("users", []) if u.get("id") == uid or u.get("login") == uid), None)
        if not user or not pw_verify(user, pw):
            login_fail(ip)
            return self._json(401, {"ok": False, "error": "Неверный логин или пароль"})
        login_ok(ip)
        sid = secrets.token_urlsafe(32)
        csrf = secrets.token_urlsafe(24)
        with _lock:
            SESSIONS[sid] = {"uid": user["id"], "ts": time.time(), "csrf": csrf}
        self._json(200, {"ok": True, "first_login": bool(user.get("first_login")), "id": user["id"], "name": user.get("name", ""), "is_admin": bool(user.get("is_admin")), "csrf": csrf}, {"Set-Cookie": self._set_cookie(sid)})

    def _logout(self):
        s = self._session()
        if s:
            with _lock:
                SESSIONS.pop(s["sid"], None)
        self._json(200, {"ok": True}, {"Set-Cookie": self._clear_cookie()})

    def _change_pw(self, b):
        s = self._session()
        if not s:
            return self._json(401, {"ok": False, "error": "Нужен вход"})
        if not self._check_csrf(s):
            return self._json(403, {"ok": False, "error": "CSRF"})
        cur = str(b.get("current_password", ""))
        new = str(b.get("new_password", ""))
        if len(new) < 8:
            return self._json(400, {"ok": False, "error": "Пароль минимум 8 символов"})
        udb = CFG.load_users()
        user = next((u for u in udb["users"] if u["id"] == s["uid"]), None)
        if not user or not pw_verify(user, cur):
            return self._json(401, {"ok": False, "error": "Текущий пароль неверный"})
        salt = secrets.token_bytes(16)
        user["salt"] = b64e(salt)
        user["pw_hash"] = pw_hash(new, salt)
        user["iterations"] = PBKDF2_ITER
        user["first_login"] = False
        user["updated_at"] = now()
        CFG.save_users(udb)
        self._json(200, {"ok": True})

    def _admin_reset(self, b):
        s = self._require_admin()
        if not s or not self._check_csrf(s):
            if s: self._json(403, {"ok": False, "error": "CSRF"})
            return
        target_id = str(b.get("user_id", "")).strip()
        new = str(b.get("new_password", ""))
        if len(new) < 8:
            return self._json(400, {"ok": False, "error": "Пароль минимум 8 символов"})
        udb = CFG.load_users()
        user = next((u for u in udb["users"] if u["id"] == target_id), None)
        if not user:
            return self._json(404, {"ok": False, "error": "Пользователь не найден"})
        salt = secrets.token_bytes(16)
        user["salt"] = b64e(salt)
        user["pw_hash"] = pw_hash(new, salt)
        user["iterations"] = PBKDF2_ITER
        user["first_login"] = True
        user["updated_at"] = now()
        CFG.save_users(udb)
        self._json(200, {"ok": True, "user_id": target_id})

    def _admin_set_password(self, b):
        # alias for reset, explicit name
        return self._admin_reset(b)

    def _admin_save_data(self, b):
        s = self._require_admin()
        if not s or not self._check_csrf(s):
            if s: self._json(403, {"ok": False, "error": "CSRF"})
            return
        data = b.get("data")
        try:
            save_site_data(data)
        except Exception as e:
            return self._json(400, {"ok": False, "error": str(e)})
        self._json(200, {"ok": True, "saved_at": now()})

    def _admin_publish(self, b):
        s = self._require_admin()
        if not s or not self._check_csrf(s):
            if s: self._json(403, {"ok": False, "error": "CSRF"})
            return
        if not SYNC_SCRIPT.exists():
            return self._json(500, {"ok": False, "error": "Скрипт синхронизации не найден"})
        msg = str(b.get("message") or "site: portal admin update").strip()[:120]
        p = subprocess.run([sys.executable, str(SYNC_SCRIPT), "sync", "--message", msg], cwd=str(SITE), text=True, capture_output=True, timeout=180)
        ok = p.returncode == 0
        detail = (p.stdout or p.stderr or "").strip()[-1500:]
        self._json(200 if ok else 500, {"ok": ok, "detail": detail})

    def _save_profile(self, b):
        s = self._require_auth()
        if not s or not self._check_csrf(s):
            if s: self._json(403, {"ok": False, "error": "CSRF"})
            return
        c = load_content()
        uid = s["uid"]
        about = str(b.get("about", ""))[:4000]
        details_raw = b.get("details", {})
        details = details_raw if isinstance(details_raw, dict) else {}
        details = {str(k)[:40]: str(v)[:200] for k, v in list(details.items())[:30]}
        c["profiles"][uid] = {"about": about, "details": details, "updated_at": now()}
        save_content(c)
        self._json(200, {"ok": True})

    def _save_story(self, b):
        s = self._require_auth()
        if not s or not self._check_csrf(s):
            if s: self._json(403, {"ok": False, "error": "CSRF"})
            return
        c = load_content()
        uid = s["uid"]
        items = c["stories"].setdefault(uid, [])
        action = str(b.get("action", "add"))
        if action == "delete":
            sid = str(b.get("id", ""))
            c["stories"][uid] = [x for x in items if str(x.get("id")) != sid]
        elif action == "update":
            sid = str(b.get("id", ""))
            for x in items:
                if str(x.get("id")) == sid:
                    x["date"] = str(b.get("date", x.get("date", "")))[:60]
                    x["title"] = str(b.get("title", ""))[:160]
                    x["text"] = str(b.get("text", ""))[:6000]
                    x["updated_at"] = now()
                    break
        else:
            items.append({
                "id": secrets.token_urlsafe(8),
                "date": str(b.get("date", ""))[:60],
                "title": str(b.get("title", ""))[:160],
                "text": str(b.get("text", ""))[:6000],
                "created_at": now(),
            })
        save_content(c)
        self._json(200, {"ok": True, "stories": c["stories"].get(uid, [])})

    def _remove_photo(self, b):
        s = self._require_auth()
        if not s or not self._check_csrf(s):
            if s: self._json(403, {"ok": False, "error": "CSRF"})
            return
        uid = s["uid"]
        fname = safe_filename(str(b.get("file", "")))
        c = load_content()
        items = c["photos"].get(uid, [])
        target_entry = next((x for x in items if safe_filename(str(x.get("file", "")).split("/")[-1]) == fname), None)
        if not target_entry:
            return self._json(404, {"ok": False, "error": "Фото не найдено"})
        c["photos"][uid] = [x for x in items if x is not target_entry]
        save_content(c)
        target = (USER_PHOTOS / uid / fname).resolve()
        if (USER_PHOTOS / uid) in target.parents and target.is_file():
            try: target.unlink()
            except OSError: pass
        self._json(200, {"ok": True})

    def _user_photo_upload(self):
        s = self._require_auth()
        if not s or not self._check_csrf(s):
            if s: self._json(403, {"ok": False, "error": "CSRF"})
            return
        uid = s["uid"]
        ctype = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in ctype:
            return self._json(400, {"ok": False, "error": "Нужен multipart/form-data"})
        m = re.search(r'boundary=(?:"([^"]+)"|([^;]+))', ctype)
        if not m:
            return self._json(400, {"ok": False, "error": "Нет boundary"})
        boundary = (m.group(1) or m.group(2)).encode()
        raw = self._body()
        parts = raw.split(b"--" + boundary)
        user_dir = USER_PHOTOS / uid
        user_dir.mkdir(parents=True, exist_ok=True)
        saved = []
        for part in parts:
            if b"\r\n\r\n" not in part or part in (b"--\r\n", b"--", b"\r\n"):
                continue
            head, content = part.split(b"\r\n\r\n", 1)
            content = content.rstrip(b"\r\n")
            if content.endswith(b"--"):
                content = content[:-2].rstrip(b"\r\n")
            disp = ""
            for line in head.decode("utf-8", "replace").split("\r\n"):
                if line.lower().startswith("content-disposition:"):
                    disp = line
            fnm = re.search(r'filename="([^"]*)"', disp)
            if not fnm:
                continue
            fname = safe_filename(fnm.group(1))
            if not re.search(r"\.(jpg|jpeg|png|webp|gif)$", fname, re.I):
                return self._json(400, {"ok": False, "error": f"Недопустимый тип файла: {fname}"})
            target = (user_dir / fname).resolve()
            if user_dir not in target.parents:
                return self._json(400, {"ok": False, "error": "Некорректное имя файла"})
            target.write_bytes(content)
            rel = f"assets/user-photos/{uid}/{fname}"
            saved.append({"file": rel, "caption": ""})
        if not saved:
            return self._json(400, {"ok": False, "error": "Файл не получен"})
        c = load_content()
        c["photos"].setdefault(uid, []).extend(saved)
        save_content(c)
        self._json(200, {"ok": True, "saved": saved})

    def _admin_save_config(self, b):
        s = self._require_admin()
        if not s or not self._check_csrf(s):
            if s: self._json(403, {"ok": False, "error": "CSRF"})
            return
        cfg = b.get("config")
        if not isinstance(cfg, dict):
            return self._json(400, {"ok": False, "error": "Некорректный конфиг"})
        d = site_data()
        theme = cfg.get("theme")
        sections = cfg.get("sections")
        modules = cfg.get("cabinetModules")
        if not isinstance(theme, dict) or not isinstance(sections, dict) or not isinstance(modules, dict):
            return self._json(400, {"ok": False, "error": "theme/sections/cabinetModules обязательны"})
        d["SITE_CONFIG"] = {"theme": theme, "sections": sections, "cabinetModules": modules}
        # apply title/tagline overrides to SITE_DATA
        if theme.get("familyTitle"):
            d["SITE_DATA"]["familyTitle"] = str(theme["familyTitle"])[:120]
        if theme.get("familyTagline"):
            d["SITE_DATA"]["familyTagline"] = str(theme["familyTagline"])[:200]
        for m in d["SITE_DATA"].get("members", []):
            if m["id"] in modules and isinstance(modules[m["id"]], list):
                m["modules"] = [str(x) for x in modules[m["id"]]]
        save_site_data(d)
        self._json(200, {"ok": True, "saved_at": now()})

    def _admin_upload_photo(self):
        s = self._require_admin()
        if not s or not self._check_csrf(s):
            if s: self._json(403, {"ok": False, "error": "CSRF"})
            return
        ctype = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in ctype:
            return self._json(400, {"ok": False, "error": "Нужен multipart/form-data"})
        m = re.search(r'boundary=(?:"([^"]+)"|([^;]+))', ctype)
        if not m:
            return self._json(400, {"ok": False, "error": "Нет boundary"})
        boundary = (m.group(1) or m.group(2)).encode()
        raw = self._body()
        parts = raw.split(b"--" + boundary)
        saved = []
        PHOTOS.mkdir(parents=True, exist_ok=True)
        for part in parts:
            if b"\r\n\r\n" not in part or part in (b"--\r\n", b"--", b"\r\n"):
                continue
            head, content = part.split(b"\r\n\r\n", 1)
            content = content.rstrip(b"\r\n")
            if content.endswith(b"--"):
                content = content[:-2].rstrip(b"\r\n")
            disp = ""
            for line in head.decode("utf-8", "replace").split("\r\n"):
                if line.lower().startswith("content-disposition:"):
                    disp = line
            fnm = re.search(r'filename="([^"]*)"', disp)
            if not fnm:
                continue
            fname = safe_filename(fnm.group(1))
            if not re.search(r"\.(jpg|jpeg|png|webp|gif)$", fname, re.I):
                return self._json(400, {"ok": False, "error": f"Недопустимый тип файла: {fname}"})
            target = (PHOTOS / fname).resolve()
            if PHOTOS not in target.parents:
                return self._json(400, {"ok": False, "error": "Некорректное имя файла"})
            target.write_bytes(content)
            saved.append({"file": f"assets/photos/{fname}", "size": len(content)})
        if not saved:
            return self._json(400, {"ok": False, "error": "Файл не получен"})
        self._json(200, {"ok": True, "saved": saved})


def default_users():
    d = site_data()
    users = []
    for m in d.get("SITE_DATA", {}).get("members", []):
        users.append({
            "id": m["id"], "login": m["id"], "name": m["name"], "is_admin": False,
            "salt": "", "pw_hash": "", "iterations": PBKDF2_ITER,
            "first_login": True, "created_at": now(),
        })
    users.insert(0, {
        "id": "admin", "login": "admin", "name": "Администратор", "is_admin": True,
        "salt": "", "pw_hash": "", "iterations": PBKDF2_ITER,
        "first_login": True, "created_at": now(),
    })
    return {"secret": b64e(secrets.token_bytes(32)), "users": users}


def set_user_password(udb, user_id, password):
    user = next((u for u in udb.get("users", []) if u["id"] == user_id), None)
    if not user:
        raise RuntimeError(f"Нет пользователя {user_id}")
    if len(password) < 8:
        raise RuntimeError("Пароль минимум 8 символов")
    salt = secrets.token_bytes(16)
    user["salt"] = b64e(salt)
    user["pw_hash"] = pw_hash(password, salt)
    user["iterations"] = PBKDF2_ITER
    user["first_login"] = True
    user["updated_at"] = now()


def build_argparser():
    ap = argparse.ArgumentParser(description="Family portal server")
    ap.add_argument("--host", default=os.environ.get("FAMILY_HOST", "127.0.0.1"))
    ap.add_argument("--port", type=int, default=int(os.environ.get("FAMILY_PORT", "8787")))
    ap.add_argument("--users-file", default=os.environ.get("FAMILY_USERS_FILE", str(DEFAULT_USERS_FILE)))
    ap.add_argument("--secure-cookie", action="store_true", default=os.environ.get("FAMILY_SECURE_COOKIE", "") == "1")
    sub = ap.add_subparsers(dest="cmd")

    pinit = sub.add_parser("init-users", help="создать файл пользователей")
    pinit.add_argument("--passwords-file", help="JSON {user_id: password}")
    pinit.add_argument("--force", action="store_true", help="перезаписать существующий файл (осторожно)")

    spw = sub.add_parser("set-password", help="задать пароль пользователю")
    spw.add_argument("--user", required=True)
    spw.add_argument("--password", help="пароль (лучше --password-stdin)")
    spw.add_argument("--password-stdin", action="store_true")

    sub.add_parser("list-users", help="список пользователей")
    sub.add_parser("health", help="проверка конфигурации")
    return ap


def cmd_set_password(args):
    CFG.users_file = Path(args.users_file)
    password = args.password
    if args.password_stdin:
        password = sys.stdin.read().rstrip("\n")
    if not password:
        print(json.dumps({"ok": False, "error": "Нужен --password или --password-stdin"}, ensure_ascii=False))
        return 1
    udb = CFG.load_users()
    set_user_password(udb, args.user, password)
    CFG.save_users(udb)
    print(json.dumps({"ok": True, "user": args.user, "first_login": True}, ensure_ascii=False))
    return 0


def main():
    ap = build_argparser()
    args = ap.parse_args()
    CFG.users_file = Path(args.users_file)
    CFG.secure_cookie = bool(args.secure_cookie)

    if args.cmd == "init-users":
        if CFG.users_file.exists() and not args.force:
            print(json.dumps({"ok": False, "error": f"Уже существует {CFG.users_file}. Используйте --force для перезаписи."}, ensure_ascii=False))
            return 1
        udb = default_users()
        out_path = CFG.users_file.parent / "family_site_users_initial.txt"
        generated = {}
        if args.passwords_file:
            pwmap = read_json(Path(args.passwords_file), {})
            for u in udb["users"]:
                pw = pwmap.get(u["id"])
                if not pw:
                    raise RuntimeError(f"Нет пароля для {u['id']} в {args.passwords_file}")
                set_user_password(udb, u["id"], str(pw))
        else:
            for u in udb["users"]:
                pw = secrets.token_urlsafe(9)
                generated[u["id"]] = pw
                set_user_password(udb, u["id"], pw)
        CFG.save_users(udb)
        if generated:
            out_path.write_text("\n".join(f"{k}: {v}" for k, v in generated.items()) + "\n", encoding="utf-8")
            try: os.chmod(out_path, 0o600)
            except OSError: pass
            print(json.dumps({"ok": True, "users_file": str(CFG.users_file), "initial_passwords_file": str(out_path), "note": "пароли записаны только в локальный secrets-файл"}, ensure_ascii=False))
        else:
            print(json.dumps({"ok": True, "users_file": str(CFG.users_file)}, ensure_ascii=False))
        return 0

    if args.cmd == "set-password":
        return cmd_set_password(args)

    if args.cmd == "list-users":
        udb = CFG.load_users()
        print(json.dumps({"ok": True, "users": [{"id": u["id"], "name": u.get("name", ""), "is_admin": bool(u.get("is_admin")), "first_login": bool(u.get("first_login"))} for u in udb.get("users", [])]}, ensure_ascii=False))
        return 0

    if args.cmd == "health":
        udb = CFG.load_users()
        sd = site_data()
        print(json.dumps({"ok": True, "users": len(udb.get("users", [])), "members": len(sd.get("SITE_DATA", {}).get("members", [])), "users_file": str(CFG.users_file)}, ensure_ascii=False))
        return 0

    # default: run server
    CFG.load_users()  # fail fast
    site_data()
    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    print(json.dumps({"ok": True, "url": f"http://{args.host}:{args.port}/", "site": str(SITE), "users_file": str(CFG.users_file)}, ensure_ascii=False))
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
