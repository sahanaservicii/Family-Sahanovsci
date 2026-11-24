# Развёртывание семейного портала (LAN, production)

Этот пакет готовит **локальный защищённый портал**. Публичный GitHub Pages остаётся статической витриной.

## Что нужно

- Устройство в домашней LAN `192.168.0.0/24` (мини-ПК / Raspberry Pi / NAS / старый ноутбук), всегда включено.
- Linux + Python 3.10+ (stdlib достаточно).
- Доступ к устройству по SSH или локально.

## Быстрый запуск (без systemd)

```bash
# на устройстве в LAN
cd /opt/family-site
python3 portal_server.py init-users --users-file /etc/family-portal/users.json
python3 portal_server.py set-password --users-file /etc/family-portal/users.json --user admin --password-stdin
python3 portal_server.py --host 0.0.0.0 --port 8787 --users-file /etc/family-portal/users.json
```

Открыть с телефона в той же Wi-Fi: `http://<LAN-IP-УСТРОЙСТВА>:8787/`

## Production-вариант

1. Скопируйте `family-site/` на устройство (rsync/scp/git clone).
2. Запустите `sudo bash deploy/install.sh` (проверьте пути в скрипте перед запуском).
3. Создайте `/etc/family-portal/users.json` через `init-users`.
4. Задайте пароли: `set-password --password-stdin` (не передавайте пароль в argv).
5. Для HTTPS используйте nginx/caddy перед порталом и установите `FAMILY_SECURE_COOKIE=1`.

## Безопасность

- **Не публикуйте порт в интернет**. Для доступа вне дома — только VPN (WireGuard) на роутере.
- Секреты (`users.json`, initial passwords) — только вне git, права 0600.
- Первый вход каждого пользователя требует смену пароля.
- Логин имеет rate-limit. POST-операции требуют CSRF-токен сессии.
- Для HTTPS: reverse proxy + `FAMILY_SECURE_COOKIE=1`.

## Бэкап

```bash
FAMILY_USERS_FILE=/etc/family-portal/users.json bash deploy/backup.sh /var/backups/family-portal
```

Бэкап включает `site-data.json`, `data.js`, `photos/`, `users.json`. Файл с начальными паролями по умолчанию не копируется.

## Обновление

```bash
rsync -a --exclude '.git' --exclude '__pycache__' /path/to/new/family-site/ /opt/family-site/
systemctl restart family-portal.service
```

## Проверка

```bash
curl -s http://127.0.0.1:8787/api/portal/health
python3 portal_server.py --users-file /etc/family-portal/users.json health
```
