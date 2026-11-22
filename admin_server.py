#!/usr/bin/env python3
"""Локальный защищённый админ-сервер для family-site.

Реальная авторизация (PBKDF2 + сессия), только localhost по умолчанию.
Данные сайта редактируются локально; публикация в GitHub — отдельным действием.
Секреты хранятся вне репозитория.

Запуск:
    python3 /root/workspace/family-site/admin_server.py
    python3 /root/workspace/family-site/admin_server.py --host 127.0.0.1 --port 8787
"""
from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import mimetypes
import os
import re
import secrets
import subprocess
import sys
from datetime import datetime, timezone
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

SITE = Path(__file__).resolve().parent
ASSETS = SITE / "assets"
PHOTOS = ASSETS / "photos"
DATA_JSON = ASSETS / "site-data.json"
DATA_JS = ASSETS / "data.js"
SECRETS_FILE = Path("/root/.config/opencode/secrets/family_site_admin.json")
SYNC_SCRIPT = Path("/root/workspace/homelab/site_github_sync.py")
SESSION_COOKIE = "family_admin_session"
SESSIONS: dict[str, dict] = {}
PBKDF2_ITER = 200_000


def now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def read_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def b64e(b: bytes) -> str:
    import base64
    return base64.urlsafe_b64encode(b).decode("ascii").rstrip("=")


def b64d(s: str) -> bytes:
    import base64
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)


def hash_password(password: str, salt: bytes, iterations: int = PBKDF2_ITER) -> str:
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return b64e(dk)


def load_creds() -> dict:
    creds = read_json(SECRETS_FILE, None)
    if not isinstance(creds, dict) or not creds.get("username"):
        raise RuntimeError(
            f"Нет файла учётки {SECRETS_FILE}. Сначала выполните init-admin."
        )
    return creds


def save_creds(creds: dict) -> None:
    write_json(SECRETS_FILE, creds)
    try:
        os.chmod(SECRETS_FILE, 0o600)
    except OSError:
        pass


def init_admin(username: str, password: str) -> None:
    salt = secrets.token_bytes(16)
    creds = {
        "username": username,
        "salt": b64e(salt),
        "pw_hash": hash_password(password, salt),
        "iterations": PBKDF2_ITER,
        "first_login": True,
        "secret": b64e(secrets.token_bytes(32)),
        "created_at": now(),
        "updated_at": now(),
    }
    save_creds(creds)


def verify_password(creds: dict, password: str) -> bool:
    salt = b64d(creds["salt"])
    it = int(creds.get("iterations", PBKDF2_ITER))
    expected = creds.get("pw_hash", "")
    actual = hash_password(password, salt, it)
    return hmac.compare_digest(actual, expected)


def sign(value: str, secret: bytes) -> str:
    sig = hmac.new(secret, value.encode("utf-8"), hashlib.sha256).digest()
    return value + "." + b64e(sig)


def unsign(token: str, secret: bytes) -> str | None:
    if "." not in token:
        return None
    value, sig = token.rsplit(".", 1)
    good = hmac.new(secret, value.encode("utf-8"), hashlib.sha256).digest()
    if not hmac.compare_digest(b64e(good), sig):
        return None
    return value


def ensure_data_json() -> dict:
    if DATA_JSON.exists():
        data = read_json(DATA_JSON, None)
        if isinstance(data, dict) and "SITE_DATA" in data:
            return data
    # bootstrap from existing data.js via node
    p = subprocess.run(
        ["node", "-e", "global.window=global;require('./assets/data.js');process.stdout.write(JSON.stringify({SITE_DATA:window.SITE_DATA,SITE_MODULES:window.SITE_MODULES,SITE_DEMO_TASKS:window.SITE_DEMO_TASKS}))"],
        cwd=str(SITE), text=True, capture_output=True,
    )
    if p.returncode != 0:
        raise RuntimeError("Не удалось прочитать data.js")
    data = json.loads(p.stdout)
    write_json(DATA_JSON, data)
    return data


def generate_data_js(data: dict) -> None:
    # stable, readable output; JS remains file:// compatible
    js = (
        "/* Автоматически сгенерировано admin_server.py из assets/site-data.json. */\n"
        "window.SITE_DATA = " + json.dumps(data["SITE_DATA"], ensure_ascii=False, indent=2) + ";\n\n"
        "window.SITE_MODULES = " + json.dumps(data["SITE_MODULES"], ensure_ascii=False, indent=2) + ";\n\n"
        "window.SITE_DEMO_TASKS = " + json.dumps(data["SITE_DEMO_TASKS"], ensure_ascii=False, indent=2) + ";\n"
    )
    DATA_JS.write_text(js, encoding="utf-8")


def safe_filename(name: str) -> str:
    name = os.path.basename(name or "photo.jpg")
    name = re.sub(r"[^A-Za-z0-9._-]+", "-", name).strip(".-")
    return name or "photo.jpg"

class AdminHandler(BaseHTTPRequestHandler):
    server_version = "FamilyAdmin/1.0"

    def log_message(self, fmt, *args):  # quieter
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _send(self, status: int, body: bytes, content_type: str = "application/json; charset=utf-8", extra_headers: dict | None = None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")
        if extra_headers:
            for k, v in extra_headers.items():
                self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _json(self, status: int, payload: dict, extra_headers: dict | None = None):
        self._send(status, json.dumps(payload, ensure_ascii=False).encode("utf-8"), extra_headers=extra_headers)

    def _read_body(self) -> bytes:
        length = int(self.headers.get("Content-Length", "0") or "0")
        return self.rfile.read(length) if length > 0 else b""

    def _read_json(self) -> dict:
        raw = self._read_body()
        if not raw:
            return {}
        try:
            data = json.loads(raw.decode("utf-8"))
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    def _cookie(self, name: str) -> str | None:
        c = SimpleCookie(self.headers.get("Cookie", ""))
        m = c.get(name)
        return m.value if m else None

    def _creds(self) -> dict:
        return load_creds()

    def _session(self) -> dict | None:
        creds = self._creds()
        token = self._cookie(SESSION_COOKIE)
        if not token:
            return None
        sid = unsign(token, b64d(creds["secret"]))
        if not sid:
            return None
        sess = SESSIONS.get(sid)
        if not sess:
            return None
        return sess

    def _require_auth(self, allow_first_login: bool = False):
        sess = self._session()
        if not sess:
            self._json(401, {"ok": False, "error": "Нужен вход"})
            return None
        creds = self._creds()
        if creds.get("first_login") and not allow_first_login:
            self._json(403, {"ok": False, "error": "Сначала смените пароль", "first_login": True})
            return None
        return sess

    def _set_session_cookie(self, sid: str) -> str:
        creds = self._creds()
        token = sign(sid, b64d(creds["secret"]))
        return f"{SESSION_COOKIE}={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200"

    def _clear_session_cookie(self) -> str:
        return f"{SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"

    def do_GET(self):
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        if path == "/api/me":
            return self._api_me()
        if path == "/api/data":
            return self._api_get_data()
        if path == "/" or path == "/admin" or path == "/admin/":
            return self._send(200, ADMIN_HTML.encode("utf-8"), "text/html; charset=utf-8")
        if path.startswith("/assets/"):
            return self._serve_site_file(path.lstrip("/"))
        if path in ("/index.html", "/favicon.ico"):
            return self._serve_site_file(path.lstrip("/"))
        self._json(404, {"ok": False, "error": "Не найдено"})

    def do_POST(self):
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        routes = {
            "/api/login": self._api_login,
            "/api/logout": self._api_logout,
            "/api/change-password": self._api_change_password,
            "/api/data": self._api_save_data,
            "/api/upload-photo": self._api_upload_photo,
            "/api/publish": self._api_publish,
        }
        handler = routes.get(path)
        if not handler:
            return self._json(404, {"ok": False, "error": "Не найдено"})
        return handler()

    def _serve_site_file(self, rel: str):
        # serve only existing files under SITE, no traversal
        target = (SITE / rel).resolve()
        if SITE not in target.parents and target != SITE:
            return self._json(403, {"ok": False, "error": "Запрещено"})
        if not target.is_file():
            return self._json(404, {"ok": False, "error": "Не найдено"})
        ctype = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        self._send(200, target.read_bytes(), ctype)

    def _api_me(self):
        creds = self._creds()
        sess = self._session()
        self._json(200, {
            "ok": True,
            "authenticated": bool(sess),
            "username": creds.get("username"),
            "first_login": bool(creds.get("first_login")),
        })

    def _api_login(self):
        body = self._read_json()
        username = str(body.get("username", ""))
        password = str(body.get("password", ""))
        creds = self._creds()
        if username != creds.get("username") or not verify_password(creds, password):
            return self._json(401, {"ok": False, "error": "Неверный логин или пароль"})
        sid = secrets.token_urlsafe(32)
        SESSIONS[sid] = {"username": username, "at": now()}
        header = self._set_session_cookie(sid)
        self._json(200, {"ok": True, "first_login": bool(creds.get("first_login"))}, {"Set-Cookie": header})

    def _api_logout(self):
        token = self._cookie(SESSION_COOKIE)
        creds = self._creds()
        if token:
            sid = unsign(token, b64d(creds["secret"]))
            if sid:
                SESSIONS.pop(sid, None)
        self._json(200, {"ok": True}, {"Set-Cookie": self._clear_session_cookie()})

    def _api_change_password(self):
        sess = self._require_auth(allow_first_login=True)
        if not sess:
            return
        body = self._read_json()
        current = str(body.get("current_password", ""))
        new_pw = str(body.get("new_password", ""))
        if len(new_pw) < 8:
            return self._json(400, {"ok": False, "error": "Новый пароль должен быть не короче 8 символов"})
        creds = self._creds()
        if not verify_password(creds, current):
            return self._json(401, {"ok": False, "error": "Текущий пароль неверный"})
        salt = secrets.token_bytes(16)
        creds["salt"] = b64e(salt)
        creds["pw_hash"] = hash_password(new_pw, salt)
        creds["iterations"] = PBKDF2_ITER
        creds["first_login"] = False
        creds["updated_at"] = now()
        save_creds(creds)
        self._json(200, {"ok": True, "first_login": False})

    def _api_get_data(self):
        sess = self._require_auth()
        if not sess:
            return
        data = ensure_data_json()
        self._json(200, {"ok": True, "data": data})

    def _api_save_data(self):
        sess = self._require_auth()
        if not sess:
            return
        body = self._read_json()
        data = body.get("data")
        if not isinstance(data, dict) or "SITE_DATA" not in data:
            return self._json(400, {"ok": False, "error": "Некорректные данные"})
        # minimal validation
        sd = data["SITE_DATA"]
        if not isinstance(sd.get("members"), list) or not isinstance(sd.get("gallery"), list):
            return self._json(400, {"ok": False, "error": "SITE_DATA.members/gallery должны быть списками"})
        if "SITE_MODULES" not in data: data["SITE_MODULES"] = ensure_data_json().get("SITE_MODULES", {})
        if "SITE_DEMO_TASKS" not in data: data["SITE_DEMO_TASKS"] = ensure_data_json().get("SITE_DEMO_TASKS", {})
        write_json(DATA_JSON, data)
        generate_data_js(data)
        self._json(200, {"ok": True, "saved_at": now()})

    def _api_upload_photo(self):
        sess = self._require_auth()
        if not sess:
            return
        ctype = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in ctype:
            return self._json(400, {"ok": False, "error": "Нужен multipart/form-data"})
        # boundary
        m = re.search(r'boundary=(?:"([^"]+)"|([^;]+))', ctype)
        if not m:
            return self._json(400, {"ok": False, "error": "Нет boundary"})
        boundary = (m.group(1) or m.group(2)).encode()
        raw = self._read_body()
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

    def _api_publish(self):
        sess = self._require_auth()
        if not sess:
            return
        if not SYNC_SCRIPT.exists():
            return self._json(500, {"ok": False, "error": "Скрипт синхронизации не найден"})
        p = subprocess.run(
            [sys.executable, str(SYNC_SCRIPT), "sync", "--message", "site: admin update"],
            cwd=str(SITE), text=True, capture_output=True, timeout=180,
        )
        ok = p.returncode == 0
        detail = (p.stdout or p.stderr or "").strip()[-1000:]
        self._json(200 if ok else 500, {"ok": ok, "detail": detail})
ADMIN_HTML = """<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Админка family-site</title>
<style>
:root{--bg:#f5f4ef;--card:#fff;--ink:#24312f;--muted:#66756f;--line:#ddd9d0;--pri:#2f6d63;--pri2:#24554d;--danger:#b44;--r:14px}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--ink)}
.wrap{max-width:1100px;margin:0 auto;padding:24px}.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:20px;margin-bottom:16px;box-shadow:0 8px 24px rgba(0,0,0,.04)}
h1,h2,h3{margin:0 0 10px}h1{font-size:28px}p{margin:0 0 10px;color:var(--muted)}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}input,textarea,select{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:10px;font:inherit}
textarea{min-height:72px;resize:vertical}label{display:block;font-size:13px;font-weight:700;margin:8px 0 4px}
.btn{border:0;border-radius:10px;padding:10px 14px;font:inherit;font-weight:700;cursor:pointer;background:#eceae4;color:var(--ink)}
.btn-pri{background:var(--pri);color:#fff}.btn-pri:hover{background:var(--pri2)}.btn-danger{background:#f8e8e8;color:var(--danger)}
.grid{display:grid;gap:12px}.g2{grid-template-columns:repeat(2,minmax(0,1fr))}.g3{grid-template-columns:repeat(3,minmax(0,1fr))}
.hidden{display:none!important}.muted{color:var(--muted);font-size:13px}.msg{padding:10px 12px;border-radius:10px;margin:10px 0;font-size:14px}
.ok{background:#e8f3ee;color:#245a42}.err{background:#fdeaea;color:#8d3333}.warn{background:#fff4df;color:#7a5720}
table{width:100%;border-collapse:collapse}th,td{padding:8px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top;font-size:14px}
.thumb{width:96px;height:72px;object-fit:cover;border-radius:8px;background:#eee;border:1px solid var(--line)}
.top{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:16px}
.pill{display:inline-block;padding:4px 10px;border-radius:999px;background:#e8f3ee;color:#245a42;font-size:12px;font-weight:700}
@media(max-width:800px){.g2,.g3{grid-template-columns:1fr}.top{flex-direction:column;align-items:stretch}}
</style></head><body>
<div class="wrap">
  <div class="top"><div><h1>Админка сайта семьи</h1><p>Локальный сервер. Публичный GitHub Pages не имеет реальной защиты входа — админка работает только здесь.</p></div><div class="row"><span id="who" class="pill hidden"></span><button id="logoutBtn" class="btn hidden">Выйти</button></div></div>
  <div id="msg"></div>

  <section id="loginView" class="card hidden">
    <h2>Вход</h2>
    <p>Используйте указанный администратором логин и пароль. При первом входе пароль нужно сменить.</p>
    <div class="g2 grid">
      <div><label>Логин</label><input id="loginUser" autocomplete="username"></div>
      <div><label>Пароль</label><input id="loginPass" type="password" autocomplete="current-password"></div>
    </div>
    <div class="row" style="margin-top:12px"><button class="btn btn-pri" id="loginBtn">Войти</button></div>
  </section>

  <section id="pwView" class="card hidden">
    <h2>Смена пароля</h2>
    <p>Первый вход: задайте новый пароль (не короче 8 символов).</p>
    <div class="g3 grid">
      <div><label>Текущий пароль</label><input id="curPw" type="password" autocomplete="current-password"></div>
      <div><label>Новый пароль</label><input id="newPw" type="password" autocomplete="new-password"></div>
      <div><label>Повтор нового пароля</label><input id="newPw2" type="password" autocomplete="new-password"></div>
    </div>
    <div class="row" style="margin-top:12px"><button class="btn btn-pri" id="pwBtn">Сменить пароль</button></div>
  </section>

  <section id="appView" class="hidden">
    <div class="card">
      <div class="row" style="justify-content:space-between"><div><h2>Галерея</h2><p>Загрузите фото, затем заполните подписи и сохраните.</p></div><div class="row"><input id="photoFiles" type="file" accept="image/*" multiple style="max-width:280px"><button class="btn" id="uploadBtn">Загрузить фото</button></div></div>
      <div id="galleryWrap"></div>
    </div>
    <div class="card">
      <h2>Новости на главной</h2>
      <p>Короткие записи для блока «Последние события».</p>
      <div id="newsWrap"></div>
      <div class="row" style="margin-top:10px"><button class="btn" id="addNewsBtn">Добавить новость</button></div>
    </div>
    <div class="card">
      <div class="row" style="justify-content:space-between"><div><h2>Сохранение</h2><p>«Сохранить» пишет `assets/site-data.json` и `assets/data.js`. «Сохранить и опубликовать» делает git sync в GitHub.</p></div><div class="row"><button class="btn btn-pri" id="saveBtn">Сохранить</button><button class="btn" id="publishBtn">Сохранить и опубликовать</button></div></div>
      <div class="warn msg">Публикация отправляет данные в публичный репозиторий GitHub Pages. Не добавляйте то, что нельзя показывать всем.</div>
    </div>
  </section>
</div>
<script>
const $ = s => document.querySelector(s);
let DATA = null;
function msg(text, cls='ok'){ $('#msg').innerHTML = text ? `<div class="msg ${cls}">${escapeHtml(text)}</div>` : ''; }
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
async function api(path, opts={}){
  const r = await fetch(path, {headers:{'Content-Type':'application/json', ...(opts.headers||{})}, credentials:'same-origin', ...opts});
  const t = await r.text(); let j={}; try{ j=JSON.parse(t||'{}'); }catch(e){ j={ok:false,error:t||('HTTP '+r.status)}; }
  if(!r.ok && j.ok===undefined) j.ok=false; j._status=r.status; return j;
}
function show(view){ ['loginView','pwView','appView'].forEach(id=>$('#'+id).classList.add('hidden')); $('#'+view).classList.remove('hidden'); }
async function boot(){
  const me = await api('/api/me');
  if(!me.authenticated){ $('#logoutBtn').classList.add('hidden'); $('#who').classList.add('hidden'); show('loginView'); return; }
  $('#logoutBtn').classList.remove('hidden'); $('#who').classList.remove('hidden'); $('#who').textContent = me.username + (me.first_login?' (смените пароль)':'');
  if(me.first_login){ show('pwView'); return; }
  const d = await api('/api/data'); if(!d.ok){ msg(d.error||'Ошибка загрузки','err'); return; }
  DATA = d.data; render(); show('appView');
}
function render(){
  const g = DATA.SITE_DATA.gallery || [];
  $('#galleryWrap').innerHTML = `<table><thead><tr><th>Фото</th><th>Файл</th><th>Заголовок</th><th>Подпись</th><th></th></tr></thead><tbody>${g.map((p,i)=>`
    <tr><td>${p.file?`<img class="thumb" src="/${escapeHtml(p.file)}" onerror="this.style.opacity=.25">`:''}</td>
    <td><input value="${escapeHtml(p.file||'')}" data-g="${i}" data-k="file"></td>
    <td><input value="${escapeHtml(p.title||'')}" data-g="${i}" data-k="title"></td>
    <td><input value="${escapeHtml(p.caption||'')}" data-g="${i}" data-k="caption"></td>
    <td><button class="btn btn-danger" data-del-g="${i}">Удалить</button></td></tr>`).join('')}</tbody></table>
    <div class="row" style="margin-top:10px"><button class="btn" id="addGalleryBtn">Добавить строку</button></div>`;
  $('#galleryWrap').querySelectorAll('[data-g]').forEach(el=>el.oninput=e=>{ DATA.SITE_DATA.gallery[+el.dataset.g][el.dataset.k]=el.value; });
  $('#galleryWrap').querySelectorAll('[data-del-g]').forEach(el=>el.onclick=()=>{ DATA.SITE_DATA.gallery.splice(+el.dataset.delG,1); render(); });
  $('#addGalleryBtn').onclick=()=>{ DATA.SITE_DATA.gallery.push({file:'assets/photos/new-photo.jpg',title:'Новое фото',caption:'Описание'}); render(); };

  const n = DATA.SITE_DATA.news || [];
  $('#newsWrap').innerHTML = n.map((item,i)=>`<div class="card" style="padding:14px"><div class="g3 grid">
    <div><label>Дата</label><input value="${escapeHtml(item.date||'')}" data-n="${i}" data-k="date"></div>
    <div style="grid-column:span 2"><label>Заголовок</label><input value="${escapeHtml(item.title||'')}" data-n="${i}" data-k="title"></div></div>
    <label>Текст</label><textarea data-n="${i}" data-k="text">${escapeHtml(item.text||'')}</textarea>
    <div class="row" style="margin-top:8px"><button class="btn btn-danger" data-del-n="${i}">Удалить</button></div></div>`).join('') || '<p class="muted">Новостей пока нет.</p>';
  $('#newsWrap').querySelectorAll('[data-n]').forEach(el=>el.oninput=e=>{ DATA.SITE_DATA.news[+el.dataset.n][el.dataset.k]=el.value; });
  $('#newsWrap').querySelectorAll('[data-del-n]').forEach(el=>el.onclick=()=>{ DATA.SITE_DATA.news.splice(+el.dataset.delN,1); render(); });
}
$('#addNewsBtn').onclick=()=>{ (DATA.SITE_DATA.news=DATA.SITE_DATA.news||[]).push({date:'сегодня',title:'Новая новость',text:'Текст'}); render(); };
$('#loginBtn').onclick=async()=>{ const r=await api('/api/login',{method:'POST',body:JSON.stringify({username:$('#loginUser').value,password:$('#loginPass').value})}); if(!r.ok) return msg(r.error||'Ошибка входа','err'); msg('Вход выполнен'); boot(); };
$('#logoutBtn').onclick=async()=>{ await api('/api/logout',{method:'POST'}); DATA=null; msg('Вы вышли'); boot(); };
$('#pwBtn').onclick=async()=>{ if($('#newPw').value!==$('#newPw2').value) return msg('Пароли не совпадают','err'); const r=await api('/api/change-password',{method:'POST',body:JSON.stringify({current_password:$('#curPw').value,new_password:$('#newPw').value})}); if(!r.ok) return msg(r.error||'Ошибка','err'); msg('Пароль изменён'); boot(); };
$('#uploadBtn').onclick=async()=>{ const files=$('#photoFiles').files; if(!files.length) return msg('Выберите файлы','err'); const fd=new FormData(); for(const f of files) fd.append('photos',f,f.name); const r=await fetch('/api/upload-photo',{method:'POST',body:fd,credentials:'same-origin'}); const j=await r.json(); if(!j.ok) return msg(j.error||'Ошибка загрузки','err'); msg('Загружено: '+j.saved.map(x=>x.file).join(', ')); for(const s of j.saved){ (DATA.SITE_DATA.gallery=DATA.SITE_DATA.gallery||[]).push({file:s.file,title:s.file.split('/').pop(),caption:'Добавьте описание'}); } $('#photoFiles').value=''; render(); };
async function saveData(){ const r=await api('/api/data',{method:'POST',body:JSON.stringify({data:DATA})}); if(!r.ok) throw new Error(r.error||'Ошибка сохранения'); return r; }
$('#saveBtn').onclick=async()=>{ try{ await saveData(); msg('Сохранено локально'); }catch(e){ msg(e.message,'err'); } };
$('#publishBtn').onclick=async()=>{ try{ await saveData(); msg('Сохранено. Публикую...','warn'); const r=await api('/api/publish',{method:'POST'}); if(!r.ok) return msg('Публикация не удалась: '+(r.detail||r.error||''),'err'); msg('Опубликовано. '+(r.detail||'')); }catch(e){ msg(e.message,'err'); } };
boot();
</script></body></html>"""


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8787)
    sub = ap.add_subparsers(dest="cmd")
    ini = sub.add_parser("init-admin", help="создать локальную учётку администратора")
    ini.add_argument("--username", required=True)
    ini.add_argument("--password", required=True, help="начальный пароль (будет сохранён только как хэш)")
    args = ap.parse_args()

    if args.cmd == "init-admin":
        if SECRETS_FILE.exists():
            print(json.dumps({"ok": False, "error": f"Уже существует {SECRETS_FILE}"}, ensure_ascii=False))
            return 1
        init_admin(args.username, args.password)
        print(json.dumps({"ok": True, "secrets": str(SECRETS_FILE), "first_login": True}, ensure_ascii=False))
        return 0

    ensure_data_json()
    load_creds()  # fail fast
    server = ThreadingHTTPServer((args.host, args.port), AdminHandler)
    print(json.dumps({"ok": True, "url": f"http://{args.host}:{args.port}/admin", "site": str(SITE)}, ensure_ascii=False))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
