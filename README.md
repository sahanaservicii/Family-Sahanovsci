# Семейный портал (production-ready каркас)

Гибридный семейный сайт:
- **Публичная витрина** — GitHub Pages (статический, без backend).
- **Защищённый портал** — локальный сервер в домашней LAN (реальная авторизация, личные кабинеты, админка).

Внешних CDN, облаков и платных сервисов нет. Стек: HTML/CSS/JS + Python stdlib.

## Структура

```
family-site/
├── index.html
├── portal_server.py        # production сервер (auth, admin API, CSRF, rate-limit)
├── admin_server.py         # legacy простой админ-редактор
├── assets/
│   ├── app.js
│   ├── style.css
│   ├── data.js             # генерируется из site-data.json
│   ├── site-data.json      # канонические данные сайта
│   └── photos/             # семейные фото
├── deploy/                 # systemd, nginx, install/backup scripts
└── README.md
```

## Быстрый старт (локально)

```bash
cd /root/workspace/family-site

# 1) Создать пользователей (один раз)
python3 portal_server.py init-users
# начальные временные пароли: /root/.config/opencode/secrets/family_site_users_initial.txt (0600)

# 2) Задать свой пароль (рекомендуется --password-stdin)
python3 portal_server.py set-password --user admin --password-stdin

# 3) Запуск
python3 portal_server.py --host 127.0.0.1 --port 8787
# открыть http://127.0.0.1:8787/
```

## Возможности портала

- Логин/пароль для каждого пользователя (PBKDF2-HMAC-SHA256), первый вход — смена пароля.
- Роли: `admin` и член семьи.
- **Личный кабинет каждого члена семьи** (`#/cabinet/<id>`):
  - редактирование своего профиля (о себе, город, день рождения, телефон, интересы);
  - «Моя история» — записи с датой/заголовком/текстом, которыми можно делиться с семьёй;
  - загрузка и удаление **своих фотографий** (privately, только для вошедших);
  - чужие кабинеты показывают их историю и фото только для чтения.
- **Админ-панель-конструктор** (`#/admin`):
  - пользователи и сброс паролей;
  - конструктор: цвета, название/слоган семьи, заголовок главной, включение/выключение разделов (новости, гостевая книга, галерея, «кто есть кто», гостевая информация), наборы модулей кабинетов;
  - галерея, новости, загрузка фото, сохранение и публикация на GitHub Pages.
- Хранилище приватного контента — вне репозитория: `/root/.config/opencode/secrets/family_site_content.json` (профили/истории/фото), фото в `assets/user-photos/<id>/` (не публикуются при publish).
- Неаутентифицированным отдаётся только публичная версия `data.js` (без семейных/личных данных).
- CSRF-токен для POST, rate-limit на логин, HttpOnly cookie, заголовки безопасности.
- `/api/portal/health` — проверка.

> \(⚠\) want: публичный GitHub Pages молчит о приватном контенте — истории/фото/профили остаются только на защищённом портале. Публикуйте на Pages только гостевую витрину.

## Развёртывание в домашней LAN

См. [`deploy/README-deploy.md`](deploy/README-deploy.md).

Кратко: скопировать на устройство в `192.168.0.0/24`, запустить `portal_server.py --host 0.0.0.0 --port 8787 ...`, открыть `http://<LAN-IP>:8787/`. 
**Не открывать порт в интернет.** Для доступа вне дома — только VPN.

## Публичный GitHub Pages

- Репозиторий: `git@github.com:sahanaservicii/Family-Sahanovsci.git`
- Сайт: https://sahanaservicii.github.io/Family-Sahanovsci/
- Синхронизация: `python3 /root/workspace/homelab/site_github_sync.py sync --message "..."`

> ⚠️ Публичный Pages статический. Всё, что попадает в `assets/data.js` и `assets/photos/`, становится публичным.  
> Реальная защита личных кабинетов действует **только** на локальном портале.

## Секреты

- `/root/.config/opencode/secrets/family_site_users.json` — пользователи/хэши (0600, вне git).
- `/root/.config/opencode/secrets/family_site_users_initial.txt` — начальные пароли (0600, вне git).
- Не коммитить, не печатать в чате, не копировать в публичные файлы.

## Проверка

```bash
python3 -m py_compile portal_server.py
node --check assets/app.js
python3 portal_server.py health
curl -s http://127.0.0.1:8787/api/portal/health
```
