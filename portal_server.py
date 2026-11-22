#!/usr/bin/env python3
"""Локальный защищённый семейный портал (реальная авторизация, PBKDF2).

- Публичная часть (гость/главная) доступна без входа.
- Раздел семьи/кабинеты/галерея требуют вход.
- Каждый пользователь имеет свой логин/пароль; при первом входе — смена пароля.
- Админ может сбрасывать пароли пользователей.

Секреты только вне репозитория. По умолчанию слушает 127.0.0.1.

Запуск:
  python3 portal_server.py --host 127.0.0.1 --port 8787
  python3 portal_server.py init-users   # создать файл пользователей из site-data
  python3 portal_server.py set-password --user <id> --password <pw>
  python3 portal_server.py list-users
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
from datetime import datetime, timezone
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

SITE = Path(__file__).resolve().parent
ASSETS = SITE / "assets"
DATA_JS = ASSETS / "data.js"
DATA_JSON = ASSETS / "site-data.json"
USERS_FILE = Path("/root/.config/opencode/secrets/family_site_users.json")
SYNC_SCRIPT = Path("/root/workspace/homelab/site_github_sync.py")
COOKIE = "family_portal_session"
PBKDF2_ITER = 200_000
SESSIONS: dict[str, dict] = {}


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
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def b64e(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def b64d(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def pw_hash(password: str, salt: bytes, it: int = PBKDF2_ITER) -> str:
    return b64e(hashlib.pbkdf2_hmac("sha256", password.encode(), salt, it))


def pw_verify(user: dict, password: str) -> bool:
    return hmac.compare_digest(pw_hash(password, b64d(user["salt"]), int(user.get("iterations", PBKDF2_ITER))), user["pw_hash"])


def sign(value: str, secret: bytes) -> str:
    return value + "." + b64e(hmac.new(secret, value.encode(), hashlib.sha256).digest())


def unsign(token: str, secret: bytes) -> str | None:
    if "." not in token:
        return None
    value, sig = token.rsplit(".", 1)
    good = b64e(hmac.new(secret, value.encode(), hashlib.sha256).digest())
    return value if hmac.compare_digest(good, sig) else None


def load_users() -> dict:
    data = read_json(USERS_FILE, None)
    if not isinstance(data, dict) or "users" not in data:
        raise RuntimeError(f"Нет файла пользователей {USERS_FILE}. Выполните init-users.")
    return data


def save_users(data: dict) -> None:
    write_json(USERS_FILE, data)


def site_data() -> dict:
    if DATA_JSON.exists():
        d = read_json(DATA_JSON, None)
        if isinstance(d, dict) and "SITE_DATA" in d:
            return d
    p = subprocess.run(["node", "-e", "global.window=global;require('./assets/data.js');process.stdout.write(JSON.stringify({SITE_DATA:window.SITE_DATA,SITE_MODULES:window.SITE_MODULES,SITE_DEMO_TASKS:window.SITE_DEMO_TASKS}))"], cwd=str(SITE), text=True, capture_output=True)
    if p.returncode != 0:
        raise RuntimeError("Не удалось прочитать data.js")
    return json.loads(p.stdout)


def public_data_js() -> bytes:
    d = site_data()
    sd = dict(d["SITE_DATA"])
    # public: no private member details, no gallery, no familyTree personal mapping? keep names minimal? 
    # User chose keep Pages as-is publicly, but local portal should protect. For unauth on portal, hide family/private.
    sd["members"] = [{"id": m["id"], "name": m["name"], "role": m.get("role", ""), "initials": m.get("initials", "?"), "color": m.get("color", "#2f6d63"), "status": "", "note": "Войдите в раздел для семьи", "relation": "", "modules": ["overview"]} for m in sd.get("members", [])]
    sd["familyTree"] = []
    sd["gallery"] = []
    sd["news"] = sd.get("news", [])
    pub = {"SITE_DATA": sd, "SITE_MODULES": d.get("SITE_MODULES", {}), "SITE_DEMO_TASKS": {}}
    js = "/* public view */\nwindow.SITE_DATA=" + json.dumps(pub["SITE_DATA"], ensure_ascii=False) + ";\nwindow.SITE_MODULES=" + json.dumps(pub["SITE_MODULES"], ensure_ascii=False) + ";\nwindow.SITE_DEMO_TASKS=" + json.dumps(pub["SITE_DEMO_TASKS"], ensure_ascii=False) + ";\nwindow.PORTAL_AUTH={required:true,authenticated:false};\n"
    return js.encode("utf-8")


def full_data_js() -> bytes:
    d = site_data()
    js = "/* authenticated view */\nwindow.SITE_DATA=" + json.dumps(d["SITE_DATA"], ensure_ascii=False) + ";\nwindow.SITE_MODULES=" + json.dumps(d.get("SITE_MODULES", {}), ensure_ascii=False) + ";\nwindow.SITE_DEMO_TASKS=" + json.dumps(d.get("SITE_DEMO_TASKS", {}), ensure_ascii=False) + ";\nwindow.PORTAL_AUTH={required:true,authenticated:true};\n"
    return js.encode("utf-8")

class Handler(BaseHTTPRequestHandler):
    server_version = "FamilyPortal/1.0"
    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _send(self, status, body: bytes, ctype="application/json; charset=utf-8", headers=None):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")
        for k,v in (headers or {}).items():
            self.send_header(k,v)
        self.end_headers()
        self.wfile.write(body)

    def _json(self, status, obj, headers=None):
        self._send(status, json.dumps(obj, ensure_ascii=False).encode(), headers=headers)

    def _body(self):
        n=int(self.headers.get("Content-Length","0") or "0")
        return self.rfile.read(n) if n>0 else b""

    def _jbody(self):
        try: return json.loads(self._body().decode() or "{}")
        except Exception: return {}

    def _cookie(self, name):
        c=SimpleCookie(self.headers.get("Cookie",""))
        m=c.get(name)
        return m.value if m else None

    def _users(self): return load_users()

    def _session(self):
        udb=self._users()
        token=self._cookie(COOKIE)
        if not token: return None
        sid=unsign(token, b64d(udb["secret"]))
        if not sid: return None
        s=SESSIONS.get(sid)
        if not s: return None
        # attach user record
        user = next((x for x in udb["users"] if x["id"]==s["uid"]), None)
        if not user: return None
        return {"sid":sid, "uid":s["uid"], "user":user, "is_admin":bool(user.get("is_admin"))}

    def _set_cookie(self, sid):
        udb=self._users()
        return f"{COOKIE}={sign(sid,b64d(udb['secret']))}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200"

    def _clear_cookie(self):
        return f"{COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"

    def _require_auth(self):
        s=self._session()
        if not s:
            self._json(401, {"ok":False,"error":"Нужен вход"})
            return None
        if s["user"].get("first_login"):
            self._json(403, {"ok":False,"error":"Смените пароль","first_login":True})
            return None
        return s

    def do_GET(self):
        p=unquote(urlparse(self.path).path)
        if p == "/api/portal/me":
            s=self._session()
            if not s: return self._json(200, {"ok":True,"authenticated":False})
            u=s["user"]
            return self._json(200, {"ok":True,"authenticated":True,"id":u["id"],"name":u["name"],"is_admin":bool(u.get("is_admin")),"first_login":bool(u.get("first_login"))})
        if p == "/api/portal/users":
            s=self._require_auth()
            if not s or not s["is_admin"]: return self._json(403,{"ok":False,"error":"Только админ"})
            udb=self._users()
            return self._json(200, {"ok":True,"users":[{"id":u["id"],"name":u["name"],"is_admin":bool(u.get("is_admin")),"first_login":bool(u.get("first_login"))} for u in udb["users"]]})
        if p == "/assets/data.js":
            s=self._session()
            body = full_data_js() if s and not s["user"].get("first_login") else public_data_js()
            return self._send(200, body, "application/javascript; charset=utf-8")
        # serve static files from SITE
        rel = p.lstrip("/") or "index.html"
        target=(SITE/rel).resolve()
        if SITE != target and SITE not in target.parents:
            return self._json(403,{"ok":False,"error":"Forbidden"})
        if target.is_dir():
            target = target/"index.html"
        if not target.is_file():
            return self._json(404,{"ok":False,"error":"Not found"})
        ctype=mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        body=target.read_bytes()
        # don't cache html/js during portal dev
        hdr={"Cache-Control":"no-store"} if target.suffix in {".html",".js"} else {}
        self._send(200, body, ctype, hdr)

    def do_POST(self):
        p=unquote(urlparse(self.path).path)
        routes={
            "/api/portal/login": self._login,
            "/api/portal/logout": self._logout,
            "/api/portal/change-password": self._change_pw,
            "/api/portal/admin/reset-password": self._admin_reset,
        }
        fn=routes.get(p)
        if not fn: return self._json(404,{"ok":False,"error":"Not found"})
        return fn()

    def _login(self):
        b=self._jbody()
        uid=str(b.get("username","")).strip()
        pw=str(b.get("password",""))
        udb=self._users()
        user=next((u for u in udb["users"] if u["id"]==uid or u.get("login")==uid), None)
        if not user or not pw_verify(user,pw):
            return self._json(401,{"ok":False,"error":"Неверный логин или пароль"})
        sid=secrets.token_urlsafe(32)
        SESSIONS[sid]={"uid":user["id"],"at":now()}
        self._json(200,{"ok":True,"first_login":bool(user.get("first_login")),"id":user["id"],"name":user["name"]},{"Set-Cookie":self._set_cookie(sid)})

    def _logout(self):
        s=self._session()
        if s: SESSIONS.pop(s["sid"],None)
        self._json(200,{"ok":True},{"Set-Cookie":self._clear_cookie()})

    def _change_pw(self):
        s=self._session()
        if not s: return self._json(401,{"ok":False,"error":"Нужен вход"})
        b=self._jbody()
        cur=str(b.get("current_password",""))
        new=str(b.get("new_password",""))
        if len(new)<8: return self._json(400,{"ok":False,"error":"Пароль минимум 8 символов"})
        udb=self._users()
        user=next(u for u in udb["users"] if u["id"]==s["uid"])
        if not pw_verify(user,cur): return self._json(401,{"ok":False,"error":"Текущий пароль неверный"})
        salt=secrets.token_bytes(16)
        user["salt"]=b64e(salt); user["pw_hash"]=pw_hash(new,salt); user["iterations"]=PBKDF2_ITER
        user["first_login"]=False; user["updated_at"]=now()
        save_users(udb)
        self._json(200,{"ok":True})

    def _admin_reset(self):
        s=self._require_auth()
        if not s or not s["is_admin"]: return self._json(403,{"ok":False,"error":"Только админ"})
        b=self._jbody()
        target_id=str(b.get("user_id","")).strip()
        new=str(b.get("new_password",""))
        if len(new)<8: return self._json(400,{"ok":False,"error":"Пароль минимум 8 символов"})
        udb=self._users()
        user=next((u for u in udb["users"] if u["id"]==target_id), None)
        if not user: return self._json(404,{"ok":False,"error":"Пользователь не найден"})
        salt=secrets.token_bytes(16)
        user["salt"]=b64e(salt); user["pw_hash"]=pw_hash(new,salt); user["iterations"]=PBKDF2_ITER
        user["first_login"]=True; user["updated_at"]=now()
        save_users(udb)
        self._json(200,{"ok":True,"user_id":target_id})


def default_users():
    d = site_data()
    users = []
    for m in d["SITE_DATA"].get("members", []):
        users.append({"id": m["id"], "login": m["id"], "name": m["name"], "is_admin": False, "salt": "", "pw_hash": "", "iterations": PBKDF2_ITER, "first_login": True, "created_at": now()})
    # admin
    users.insert(0, {"id":"admin","login":"admin","name":"Администратор","is_admin":True,"salt":"","pw_hash":"","iterations":PBKDF2_ITER,"first_login":True,"created_at":now()})
    return {"secret": b64e(secrets.token_bytes(32)), "users": users}


def set_user_password(udb, user_id, password):
    user = next((u for u in udb["users"] if u["id"] == user_id), None)
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


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8787)
    sub = ap.add_subparsers(dest="cmd")
    pinit = sub.add_parser("init-users")
    pinit.add_argument("--passwords-file", help="JSON {user_id: password}. Если не задан, создаются случайные и пишутся в secrets-файл")
    sp = sub.add_parser("set-password")
    sp.add_argument("--user", required=True)
    sp.add_argument("--password", required=True)
    sub.add_parser("list-users")
    args = ap.parse_args()

    if args.cmd == "init-users":
        if USERS_FILE.exists():
            print(json.dumps({"ok":False,"error":f"Уже существует {USERS_FILE}"}, ensure_ascii=False)); return 1
        udb = default_users()
        out_path = USERS_FILE.parent / "family_site_users_initial.txt"
        generated = {}
        if args.passwords_file:
            pwmap = read_json(Path(args.passwords_file), {})
            for u in udb["users"]:
                pw = pwmap.get(u["id"])
                if not pw: raise RuntimeError(f"Нет пароля для {u['id']} в {args.passwords_file}")
                set_user_password(udb, u["id"], str(pw))
        else:
            for u in udb["users"]:
                pw = secrets.token_urlsafe(9)
                generated[u["id"]] = pw
                set_user_password(udb, u["id"], pw)
        save_users(udb)
        if generated:
            out_path.write_text("\n".join(f"{k}: {v}" for k,v in generated.items()) + "\n", encoding="utf-8")
            os.chmod(out_path, 0o600)
            print(json.dumps({"ok":True,"users_file":str(USERS_FILE),"initial_passwords_file":str(out_path),"note":"пароли записаны только в локальный файл secrets, не в репозиторий"}, ensure_ascii=False))
        else:
            print(json.dumps({"ok":True,"users_file":str(USERS_FILE)}, ensure_ascii=False))
        return 0

    if args.cmd == "set-password":
        udb = load_users()
        set_user_password(udb, args.user, args.password)
        save_users(udb)
        print(json.dumps({"ok":True,"user":args.user,"first_login":True}, ensure_ascii=False))
        return 0

    if args.cmd == "list-users":
        udb = load_users()
        print(json.dumps({"ok":True,"users":[{"id":u["id"],"name":u["name"],"is_admin":u.get("is_admin",False),"first_login":u.get("first_login")} for u in udb["users"]]}, ensure_ascii=False))
        return 0

    load_users() # fail fast
    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    print(json.dumps({"ok":True,"url":f"http://{args.host}:{args.port}/","site":str(SITE)}, ensure_ascii=False))
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
