/*
 * Семейный портал — логика каркаса.
 * Никаких сетевых запросов и реальных устройств: только локальные шаблоны,
 * хеш-навигация и демонстрационные состояния в памяти браузера.
 */
(function () {
  'use strict';

  var app = document.getElementById('app');
  var data = window.SITE_DATA;
  var modules = window.SITE_MODULES;
  var demoTasks = window.SITE_DEMO_TASKS;
  var GUESTBOOK_KEY = 'family-site-guestbook';
  var guestbook = loadGuestbook();
  var demoSwitches = { light: false, climate: true, mode: false };
  var checkedTasks = {};

  /* ---------- Утилиты ---------- */
  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function icon(name) {
    var paths = {
      home: '<path d="M3 11.2 12 4l9 7.2"/><path d="M5.5 9.8V20h13V9.8"/>',
      users: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19.5c0-3 2.4-5.2 5.5-5.2s5.5 2.2 5.5 5.2"/><path d="M16 5.3a3.1 3.1 0 0 1 0 6"/><path d="M17.5 14.6c1.8.7 3 2.4 3 4.4"/>',
      grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/>',
      devices: '<rect x="3" y="4.5" width="13" height="10" rx="2"/><path d="M7 18h5"/><rect x="16.5" y="10" width="4.5" height="9.5" rx="1.5"/>',
      user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.5 3.1-6 7-6s7 2.5 7 6"/>',
      check: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8 12.5 2.7 2.7L16.5 9"/>',
      calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17"/><path d="M8 3.5v3"/><path d="M16 3.5v3"/>',
      note: '<path d="M6 3.5h9l4 4V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z"/><path d="M14.5 3.5v4.5H19"/><path d="M8 12h8M8 16h6"/>',
      settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2M12 18.5v2M4.9 7.5l1.7 1M17.4 15.5l1.7 1M4.9 16.5l1.7-1M17.4 8.5l1.7-1"/>',
      info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/><circle cx="12" cy="7.8" r=".7" fill="currentColor" stroke="none"/>',
      chat: '<path d="M20 15.5a3 3 0 0 1-3 3H9l-5 3v-15a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3Z"/>',
      book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5Z"/><path d="M4 18.5h16"/>',
      arrow: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
      shield: '<path d="M12 3.5 20 7v5c0 4.6-3.2 7.6-8 9-4.8-1.4-8-4.4-8-9V7Z"/><path d="m9 12 2 2 4-4"/>',
      spark: '<path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z"/>'
    };
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (paths[name] || paths.info) + '</svg>';
  }

  function loadGuestbook() {
    try {
      var raw = localStorage.getItem(GUESTBOOK_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) { return []; }
  }

  function saveGuestbook() {
    try { localStorage.setItem(GUESTBOOK_KEY, JSON.stringify(guestbook.slice(0, 30))); } catch (e) { /* приватный режим */ }
  }

  function memberById(id) {
    for (var i = 0; i < data.members.length; i++) {
      if (data.members[i].id === id) return data.members[i];
    }
    return null;
  }

  function notice(text) {
    return '<div class="notice">' + icon('info') + '<span>' + esc(text) + '</span></div>';
  }

  /* ---------- Страницы ---------- */
  function renderHome() {
    var featuresFamily = ['Личный кабинет каждого члена семьи', 'Умный дом и устройства', 'Личные данные и заметки'];
    var featuresGuest = ['Информация о семье', 'Новости и события', 'Гостевая книга'];

    return '' +
      '<section class="hero">' +
        '<div class="eyebrow">Локальный семейный портал</div>' +
        '<h1>Место, где семья — дома, а гости — желанны</h1>' +
        '<p>' + esc(data.familyTagline) + ' Выберите раздел: общение для своих и понятная информация для тех, кто пришёл в гости.</p>' +
        '<div class="hero-actions">' +
          '<a class="btn btn-primary" href="#/family">' + icon('users') + ' Раздел для семьи</a>' +
          '<a class="btn btn-ghost" href="#/guest">Информация для гостей ' + icon('arrow') + '</a>' +
        '</div>' +
      '</section>' +

      '<section class="section">' +
        '<div class="section-head"><div><div class="eyebrow">Два входа на главную</div><h2>Что вы хотите посмотреть?</h2></div>' +
        '<p>Разделение для семьи и гостей</p></div>' +
        '<div class="grid grid-2">' +
          '<a class="audience-card family" href="#/family">' +
            '<span class="icon-tile">' + icon('users') + '</span>' +
            '<h3>Для семьи</h3>' +
            '<p class="tagline">Личные кабинеты, общие планы и всё, что будет добавляться дальше.</p>' +
            '<ul class="feature-list">' + featuresFamily.map(function (f) {
              return '<li>' + icon('check') + '<span>' + esc(f) + '</span></li>';
            }).join('') + '</ul>' +
            '<span class="card-link">Выбрать свой кабинет ' + icon('arrow') + '</span>' +
          '</a>' +
          '<a class="audience-card guest" href="#/guest">' +
            '<span class="icon-tile">' + icon('info') + '</span>' +
            '<h3>Для гостей</h3>' +
            '<p class="tagline">Только то, чем семья хочет поделиться: контакты, подсказки, новости.</p>' +
            '<ul class="feature-list">' + featuresGuest.map(function (f) {
              return '<li>' + icon('check') + '<span>' + esc(f) + '</span></li>';
            }).join('') + '</ul>' +
            '<span class="card-link">Открыть гостевую страницу ' + icon('arrow') + '</span>' +
          '</a>' +
        '</div>' +
      '</section>' +

      '<section class="section">' +
        '<div class="section-head"><div><div class="eyebrow">Общая лента</div><h2>Последние события</h2></div>' +
        '<p class="muted">Пример наполнения</p></div>' +
        '<div class="card">' + data.news.map(function (n) {
          return '<div class="news-item"><span class="date">' + esc(n.date) + '</span>' +
            '<h3>' + esc(n.title) + '</h3><p>' + esc(n.text) + '</p></div>';
        }).join('') + '</div>' +
      '</section>' +

      '<section class="section">' + notice('Это каркас интерфейса: устройства, аккаунты и реальные данные пока не подключены. ' +
        'Все имена и записи — демонстрационные.') + '</section>';
  }

  function renderFamily() {
    return '' +
      '<div class="page-head">' +
        '<div class="eyebrow">Только для своих</div>' +
        '<h1>' + esc(data.familyTitle) + '</h1>' +
        '<p class="lead">Выберите свой кабинет. У каждого члена семьи — свой набор разделов и свой функционал.</p>' +
      '</div>' +
      notice('Вход пока демонстрационный: пароли и привязка аккаунтов будут добавлены позже. ' +
        'Выберите профиль, чтобы посмотреть устройство кабинета.') +
      '<section class="section">' +
        '<div class="section-head"><div><h2>Личные кабинеты</h2></div><p>' + data.members.length + ' профиля в каркасе</p></div>' +
        '<div class="member-grid">' + data.members.map(function (m) {
          return '<a class="member-card" href="#/cabinet/' + encodeURIComponent(m.id) + '" style="--avatar:' + esc(m.color) + '">' +
            '<span class="avatar">' + esc(m.initials) + '</span>' +
            '<span class="member-name">' + esc(m.name) + '</span>' +
            '<span class="member-meta">' + esc(m.role) + ' · ' + m.modules.length + ' разделов</span>' +
            '<span class="member-note">' + esc(m.note) + '</span>' +
            '<span class="status-line"><span class="dot dot-green"></span>' + esc(m.status) + '</span>' +
          '</a>';
        }).join('') + '</div>' +
      '</section>' +
      '<section class="section">' +
        '<div class="section-head"><div><h2>Общие разделы семьи</h2></div><p>Появятся позже</p></div>' +
        '<div class="grid grid-3">' +
          '<div class="card"><h3>Семейный чат</h3><p>Общие сообщения и объявления. Заглушка.</p></div>' +
          '<div class="card"><h3>Общий календарь</h3><p>Планы и события всех членов семьи. Заглушка.</p></div>' +
          '<div class="card"><h3>Семейные задачи</h3><p>Дела, распределённые между членами семьи. Заглушка.</p></div>' +
        '</div>' +
      '</section>';
  }

  function renderGuest() {
    var entries = guestbook.length
      ? guestbook.map(function (e) {
          return '<article class="guestbook-entry"><strong>' + esc(e.name) + '</strong>' +
            '<time>' + esc(e.date) + '</time><p>' + esc(e.text) + '</p></article>';
        }).join('')
      : '<div class="empty">Записей пока нет. Можно оставить первую — для проверки работы раздела.</div>';

    return '' +
      '<section class="guest-hero">' +
        '<div class="hero">' +
          '<div class="eyebrow">Добро пожаловать</div>' +
          '<h1>Рады видеть вас</h1>' +
          '<p>Здесь собрана информация для гостей: как найти, когда заглянуть и как связаться. ' +
          'Семейные кабинеты находятся в отдельном разделе.</p>' +
          '<div class="hero-actions"><a class="btn btn-ghost" href="#/home">На главную ' + icon('arrow') + '</a></div>' +
        '</div>' +
        '<div class="guest-info">' +
          '<div class="big">' + esc(data.familyTitle) + '</div>' +
          '<p>Открытая витрина сайта. Наполняется по мере готовности: адрес, контакты и подсказки появятся здесь.</p>' +
          '<span class="badge badge-soft">Информация для всех</span>' +
        '</div>' +
      '</section>' +

      '<section class="section">' +
        '<div class="section-head"><div><h2>Полезная информация</h2></div><p>Заглушки под будущий контент</p></div>' +
        '<div class="grid grid-2">' + data.guestCards.slice(0, 2).map(function (c) {
          return guestCard(c);
        }).join('') + '</div>' +
        '<div class="grid grid-2 section">' + data.guestCards.slice(2).map(function (c) {
          return guestCard(c);
        }).join('') + '</div>' +
      '</section>' +

      '<section class="section">' +
        '<div class="card">' +
          '<div class="widget-head"><h3>' + icon('book') + ' Гостевая книга</h3><span class="tag">Хранится в браузере</span></div>' +
          '<p>Демонстрация раздела: записи сохраняются только локально, на этом устройстве.</p>' +
          '<form class="guestbook-form" id="guestbook-form">' +
            '<input id="guest-name" name="name" maxlength="60" placeholder="Ваше имя" required autocomplete="name">' +
            '<textarea id="guest-text" name="text" maxlength="600" placeholder="Пара слов..." required></textarea>' +
            '<div><button class="btn btn-primary btn-small" type="submit">Оставить запись</button></div>' +
          '</form>' +
          '<div class="guestbook-list" id="guestbook-list">' + entries + '</div>' +
        '</div>' +
      '</section>' +

      '<section class="section">' + notice('Гостевая страница не показывает личные кабинеты, устройства и данные семьи.') + '</section>';
  }

  function guestCard(c) {
    return '<div class="card"><span class="icon-tile">' + icon(c.icon) + '</span>' +
      '<h3 style="margin-top:14px">' + esc(c.title) + '</h3><p>' + esc(c.text) + '</p></div>';
  }

  /* ---------- Личный кабинет ---------- */
  function renderCabinet(memberId, moduleId) {
    var member = memberById(memberId);
    if (!member) {
      return '<div class="page-head"><h1>Кабинет не найден</h1><p class="lead">Такого профиля нет в каркасе.</p></div>' +
        '<a class="btn btn-primary" href="#/family">К списку кабинетов</a>';
    }

    if (!moduleId || member.modules.indexOf(moduleId) === -1) moduleId = 'overview';
    var mod = modules[moduleId];
    if (!mod) moduleId = 'overview';
    mod = modules[moduleId];

    var sidebar = '<aside class="sidebar">' +
      '<div class="sidebar-profile" style="--avatar:' + esc(member.color) + '">' +
        '<span class="avatar">' + esc(member.initials) + '</span>' +
        '<span><strong>' + esc(member.name) + '</strong><span>' + esc(member.role) + ' · ' + esc(member.status) + '</span></span>' +
      '</div>' +
      '<nav class="module-nav" aria-label="Разделы кабинета">' + member.modules.map(function (id) {
        var m = modules[id];
        return '<a href="#/cabinet/' + encodeURIComponent(member.id) + '/' + id + '"' +
          (id === moduleId ? ' class="active" aria-current="page"' : '') + '>' +
          icon(m.icon) + '<span>' + esc(m.title) + '</span></a>';
      }).join('') + '</nav>' +
      '<div class="sidebar-foot">Набор разделов индивидуален для каждого члена семьи.</div>' +
      '</aside>';

    var widgets = mod.widgets.map(function (w) {
      return widgetHtml(w, member, moduleId);
    }).join('');

    return '' +
      '<div class="cabinet">' + sidebar +
        '<div class="cabinet-content">' +
          '<div class="cabinet-top">' +
            '<div><h1>' + esc(mod.title) + '</h1><p>' + esc(mod.subtitle) + '</p></div>' +
            '<div class="header-actions"><a class="btn btn-secondary btn-small" href="#/family">Сменить кабинет</a></div>' +
          '</div>' +
          '<div class="widgets">' + widgets + '</div>' +
          '<div class="section">' + notice('Демо-режим: элементы на странице не управляют реальными устройствами и не меняют данные.') + '</div>' +
        '</div>' +
      '</div>';
  }

  function widgetHtml(widget, member, moduleId) {
    var wide = widget.type === 'stats' || widget.type === 'profile' || widget.type === 'tasks';
    var head = '<div class="widget-head"><h3>' + esc(widget.title) + '</h3>' +
      '<span class="tag' + (widget.type === 'demo-switches' ? ' tag-demo' : '') + '">' +
      (widget.type === 'demo-switches' ? 'демо' : 'заглушка') + '</span></div>';
    var body = '';

    switch (widget.type) {
      case 'stats':
        body = '<div class="stat-row">' +
          '<div class="stat"><div class="value">' + modules[moduleId].widgets.length + '</div><div class="label">Блоков в разделе</div></div>' +
          '<div class="stat"><div class="value">' + member.modules.length + '</div><div class="label">Доступно разделов</div></div>' +
          '<div class="stat"><div class="value">0</div><div class="label">Реальных устройств</div></div>' +
        '</div>';
        break;
      case 'list':
        body = '<ul class="simple-list">' + widget.items.map(function (i) {
          return '<li>' + esc(i) + '</li>';
        }).join('') + '</ul>';
        break;
      case 'placeholder':
        body = '<p>' + esc(widget.text) + '</p>';
        break;
      case 'profile':
        body = '<div class="profile-grid" style="--avatar:' + esc(member.color) + '">' +
          '<div class="avatar">' + esc(member.initials) + '</div>' +
          '<dl><dt>Имя</dt><dd>' + esc(member.name) + '</dd>' +
          '<dt>Роль</dt><dd>' + esc(member.role) + '</dd>' +
          '<dt>Статус</dt><dd>' + esc(member.status) + '</dd>' +
          '<dt>Кабинет</dt><dd>' + esc(member.id) + '</dd></dl></div>';
        break;
      case 'tasks':
        var list = demoTasks[member.id] || ['Пример задачи'];
        body = '<div class="task-list">' + list.map(function (task, index) {
          var key = moduleId + ':' + member.id + ':' + index;
          var done = !!checkedTasks[key];
          return '<label class="task-item' + (done ? ' done' : '') + '">' +
            '<input type="checkbox" data-task="' + esc(key) + '"' + (done ? ' checked' : '') + '>' +
            '<span>' + esc(task) + '</span></label>';
        }).join('') + '</div>';
        break;
      case 'demo-switches':
        body = switchRow('light', 'Свет в гостиной (пример)') +
          switchRow('climate', 'Климат (пример)') +
          switchRow('mode', 'Режим «не дома» (пример)');
        break;
    }

    return '<section class="widget' + (wide ? ' wide' : '') + '">' + head + body + '</section>';
  }

  function switchRow(key, label) {
    return '<div class="switch-row"><span>' + esc(label) + '</span>' +
      '<label class="switch"><input type="checkbox" data-switch="' + key + '"' +
      (demoSwitches[key] ? ' checked' : '') + ' aria-label="' + esc(label) + '">' +
      '<span class="track"></span></label></div>';
  }

  /* ---------- Навигация ---------- */
  function currentRoute() {
    var hash = (location.hash || '#/home').replace(/^#\/?/, '');
    var parts = hash.split('/').filter(Boolean).map(decodeURIComponent);
    return { page: parts[0] || 'home', member: parts[1], module: parts[2] };
  }

  function render() {
    var route = currentRoute();
    var html;
    switch (route.page) {
      case 'guest': html = renderGuest(); break;
      case 'family': html = renderFamily(); break;
      case 'cabinet': html = renderCabinet(route.member, route.module); break;
      default: html = renderHome();
    }
    app.innerHTML = html;

    var active = route.page === 'cabinet' ? 'family' : route.page;
    var links = document.querySelectorAll('[data-nav]');
    for (var i = 0; i < links.length; i++) {
      var isActive = links[i].getAttribute('data-nav') === active;
      links[i].classList.toggle('active', isActive);
      if (isActive) links[i].setAttribute('aria-current', 'page');
      else links[i].removeAttribute('aria-current');
    }
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  /* ---------- События ---------- */
  app.addEventListener('submit', function (e) {
    if (e.target.id !== 'guestbook-form') return;
    e.preventDefault();
    var name = document.getElementById('guest-name').value.trim();
    var text = document.getElementById('guest-text').value.trim();
    if (!name || !text) return;
    guestbook.unshift({
      name: name,
      text: text,
      date: new Date().toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
    });
    saveGuestbook();
    e.target.reset();
    render();
  });

  app.addEventListener('change', function (e) {
    var target = e.target;
    if (target.dataset.switch) {
      demoSwitches[target.dataset.switch] = target.checked;
    } else if (target.dataset.task) {
      checkedTasks[target.dataset.task] = target.checked;
      target.closest('.task-item').classList.toggle('done', target.checked);
    }
  });

  window.addEventListener('hashchange', render);
  if (!location.hash) location.hash = '#/home';
  render();
})();
