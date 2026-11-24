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
  var portal = { enabled: !!(window.PORTAL_AUTH && window.PORTAL_AUTH.required), authenticated: !!(window.PORTAL_AUTH && window.PORTAL_AUTH.authenticated), user: null, firstLogin: false, csrf: (window.PORTAL_AUTH && window.PORTAL_AUTH.csrf) || '' };
  var siteConfig = window.SITE_CONFIG || {};
  applyTheme(siteConfig.theme || {});

  /* ---------- Утилиты ---------- */
  function applyTheme(theme) {
    if (!theme || !document.documentElement) return;
    var root = document.documentElement;
    if (theme.accent) root.style.setProperty('--pri', theme.accent);
    if (theme.accentDark) root.style.setProperty('--pri2', theme.accentDark);
    if (theme.heroTitle && document.title) document.title = theme.heroTitle + ' — Семейный портал';
  }

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

  function secOn(name) {
    var s = (window.SITE_CONFIG && window.SITE_CONFIG.sections) || {};
    return s[name] !== false;
  }
  function isMyCabinet(id) {
    return portal.enabled && portal.authenticated && portal.user && portal.user.id === id;
  }

  function notice(text) {
    return '<div class="notice">' + icon('info') + '<span>' + esc(text) + '</span></div>';
  }

  /* ---------- Портал (локальный защищённый режим) ---------- */
  async function portalApi(path, opts) {
    opts = opts || {};
    var headers = Object.assign({'Content-Type':'application/json'}, opts.headers || {});
    if (portal.csrf && (!opts.method || opts.method.toUpperCase() !== 'GET')) headers['X-CSRF-Token'] = portal.csrf;
    var r = await fetch(path, Object.assign({credentials:'same-origin'}, opts, {headers: headers}));
    var t = await r.text(); var j={}; try{ j=JSON.parse(t||'{}'); }catch(e){ j={ok:false,error:t}; }
    if (j && j.csrf) portal.csrf = j.csrf;
    j._status=r.status; return j;
  }
  async function refreshPortal() {
    if (!portal.enabled) return;
    try {
      var me = await portalApi('/api/portal/me', {method:'GET'});
      portal.authenticated = !!me.authenticated;
      portal.firstLogin = !!me.first_login;
      portal.csrf = me.csrf || portal.csrf || '';
      portal.user = me.authenticated ? {id:me.id,name:me.name,is_admin:!!me.is_admin} : null;
      window.PORTAL_AUTH = window.PORTAL_AUTH || {}; window.PORTAL_AUTH.authenticated = portal.authenticated; window.PORTAL_AUTH.csrf = portal.csrf;
    } catch(e) {}
  }
  function renderPortalLogin(reason) {
    return '<div class="page-head"><div class="eyebrow">Защищённый вход</div><h1>Вход для семьи</h1>' +
      '<p class="lead">' + esc(reason || 'Личные кабинеты и галерея доступны только после входа.') + '</p></div>' +
      '<div class="card" style="max-width:560px"><form id="portal-login-form" class="guestbook-form">' +
      '<label><strong>Логин</strong><input id="portal-user" autocomplete="username" required></label>' +
      '<label><strong>Пароль</strong><input id="portal-pass" type="password" autocomplete="current-password" required></label>' +
      '<div class="row-actions"><button class="btn btn-primary" type="submit">Войти</button></div>' +
      '<p class="muted" id="portal-login-msg" style="margin-top:10px"></p></form></div>';
  }
  function renderPortalChangePw() {
    return '<div class="page-head"><div class="eyebrow">Первый вход</div><h1>Смените пароль</h1>' +
      '<p class="lead">Для защиты кабинета задайте новый пароль (минимум 8 символов).</p></div>' +
      '<div class="card" style="max-width:560px"><form id="portal-pw-form" class="guestbook-form">' +
      '<label><strong>Текущий пароль</strong><input id="portal-cur" type="password" autocomplete="current-password" required></label>' +
      '<label><strong>Новый пароль</strong><input id="portal-new" type="password" autocomplete="new-password" required minlength="8"></label>' +
      '<label><strong>Повтор нового пароля</strong><input id="portal-new2" type="password" autocomplete="new-password" required minlength="8"></label>' +
      '<div class="row-actions"><button class="btn btn-primary" type="submit">Сменить пароль</button></div>' +
      '<p class="muted" id="portal-pw-msg" style="margin-top:10px"></p></form></div>';
  }
  function syncPortalHeader() {
    var actions = document.querySelector('.header-actions');
    if (!actions) return;
    var old = document.getElementById('portal-user-badge');
    if (old) old.remove();
    var oldA = document.getElementById('portal-admin-link');
    if (oldA) oldA.remove();
    if (portal.enabled && portal.authenticated && portal.user) {
      if (portal.user.is_admin) {
        var a = document.createElement('a');
        a.id = 'portal-admin-link';
        a.className = 'btn btn-small btn-secondary';
        a.href = '#/admin';
        a.style.marginRight = '8px';
        a.textContent = 'Админка';
        actions.insertBefore(a, actions.firstChild);
      }
      var span = document.createElement('span');
      span.id = 'portal-user-badge';
      span.className = 'badge badge-soft';
      span.style.marginRight = '8px';
      span.innerHTML = esc(portal.user.name) + ' <button class="btn btn-small" data-portal-logout style="margin-left:8px;padding:2px 8px">Выйти</button>';
      actions.insertBefore(span, actions.firstChild);
    }
  }

  function renderPortalAdmin() {
    if (!portal.user || !portal.user.is_admin) {
      return '<div class="page-head"><h1>Доступ запрещён</h1><p class="lead">Нужны права администратора.</p></div>';
    }
    return '<div class="page-head"><div class="eyebrow">Администрирование</div><h1>Управление порталом</h1>' +
      '<p class="lead">Пользователи, конструктор, галерея, новости, публикация. Изменения сохраняются в локальные файлы сайта.</p></div>' +
      '<div id="portal-admin-msg" class="notice" style="display:none"></div>' +
      '<section class="section"><div class="card"><div class="widget-head"><h3>Конструктор сайта</h3><span class="tag">оформление и разделы</span></div>' +
      '<div id="portal-admin-config" class="muted">Загрузка...</div>' +
      '<div class="row-actions" style="margin-top:10px"><button class="btn btn-primary" id="adm-save-config" type="button">Сохранить оформление</button></div></div></section>' +
      '<section class="section"><div class="card"><div class="widget-head"><h3>Пользователи</h3><span class="tag">пароли/доступ</span></div>' +
      '<div id="portal-admin-users" class="muted">Загрузка...</div>' +
      '<div style="margin-top:12px" class="guestbook-form"><label><strong>Сброс пароля</strong><div class="grid grid-3" style="gap:8px">' +
      '<input id="adm-reset-user" placeholder="ID пользователя">' +
      '<input id="adm-reset-pw" type="password" placeholder="Новый временный пароль">' +
      '<button class="btn btn-secondary" id="adm-reset-btn" type="button">Сбросить</button></div></label>' +
      '<p class="muted">После сброса у пользователя будет first_login=true.</p></div></div></section>' +
      '<section class="section"><div class="card"><div class="widget-head"><h3>Галерея</h3><span class="tag">фото</span></div>' +
      '<div class="row-actions" style="margin-bottom:10px"><input id="adm-photo-files" type="file" multiple accept="image/*"><button class="btn btn-secondary" id="adm-upload-btn" type="button">Загрузить фото</button></div>' +
      '<div id="portal-admin-gallery"></div><div class="row-actions" style="margin-top:10px"><button class="btn btn-secondary" id="adm-add-photo" type="button">Добавить строку</button></div></div></section>' +
      '<section class="section"><div class="card"><div class="widget-head"><h3>Новости</h3><span class="tag">главная</span></div>' +
      '<div id="portal-admin-news"></div><div class="row-actions" style="margin-top:10px"><button class="btn btn-secondary" id="adm-add-news" type="button">Добавить новость</button></div></div></section>' +
      '<section class="section"><div class="card"><div class="widget-head"><h3>Сохранение и публикация</h3><span class="tag tag-demo">влияет на публичный сайт</span></div>' +
      '<p class="muted">Сохранить — записывает assets/site-data.json и assets/data.js. Опубликовать — выполняет git sync и push в GitHub Pages. Публикуются только данные, которые вы сохранили.</p>' +
      '<div class="row-actions"><button class="btn btn-primary" id="adm-save-btn" type="button">Сохранить</button><button class="btn btn-secondary" id="adm-publish-btn" type="button">Сохранить и опубликовать</button></div></div></section>';
  }

  async function loadPortalAdmin() {
    if (!portal.user || !portal.user.is_admin) return;
    var msgEl = document.getElementById('portal-admin-msg');
    function amsg(t, ok) { if(!msgEl) return; msgEl.style.display='block'; msgEl.className='notice ' + (ok===false?'notice-warn':''); msgEl.textContent=t; }
    try {
      var [ud, dd, cd] = await Promise.all([portalApi('/api/portal/users',{method:'GET'}), portalApi('/api/portal/data',{method:'GET'}), portalApi('/api/portal/config',{method:'GET'})]);
      if (!ud.ok) { amsg(ud.error||'Ошибка пользователей', false); return; }
      if (!dd.ok) { amsg(dd.error||'Ошибка данных', false); return; }
      portal.adminData = dd.data;
      portal.adminConfig = cd.config || {};
      renderAdminConfig();
      renderAdminUsers(ud.users || []);
      renderAdminGallery();
      renderAdminNews();
      wireAdminActions(amsg);
    } catch(e) { amsg('Ошибка загрузки админки', false); }
  }

  function renderAdminConfig() {
    var el = document.getElementById('portal-admin-config'); if (!el) return;
    var cfg = portal.adminConfig || {};
    var t = cfg.theme || {}, sec = cfg.sections || {}, mods = cfg.cabinetModules || {};
    var sections = [['hero','Главный баннер'],['audience','Два входа на главную'],['news','Новости'],['guestbook','Гостевая книга'],['gallery','Галерея'],['familyTree','Кто есть кто'],['guestCards','Гостевая информация']];
    el.innerHTML = '<div class="grid grid-3" style="gap:10px">' +
      '<label><strong>Цвет акцента</strong><input type="color" id="cfg-accent" value="' + esc(t.accent||'#2f6d63') + '"></label>' +
      '<label><strong>Цвет акцента (тёмный)</strong><input type="color" id="cfg-accentDark" value="' + esc(t.accentDark||'#24554d') + '"></label>' +
      '<label><strong>Название семьи</strong><input id="cfg-familyTitle" value="' + esc(t.familyTitle||'') + '"></label></div>' +
      '<label><strong>Слоган</strong><input id="cfg-familyTagline" value="' + esc(t.familyTagline||'') + '"></label>' +
      '<label><strong>Заголовок на главной</strong><input id="cfg-heroTitle" value="' + esc(t.heroTitle||'') + '"></label>' +
      '<div style="margin-top:12px"><strong>Разделы сайта</strong><div class="grid grid-3">' + sections.map(function(s){
        return '<label class="switch-row"><span>' + esc(s[1]) + '</span><span class="switch"><input type="checkbox" data-sec="' + esc(s[0]) + '"' + (sec[s[0]]!==false?' checked':'') + '><span class="track"></span></span></label>';
      }).join('') + '</div></div>' +
      '<div style="margin-top:12px"><strong>Модули кабинетов</strong><p class="muted">Отметьте разделы, доступные всем членам семьи. Индивидуальные наборы можно править в site-data.json.</p>' +
      Object.keys(window.SITE_MODULES||{}).map(function(mid){
        var m=(window.SITE_MODULES||{})[mid]||{};
        return '<label class="switch-row"><span>' + esc(m.title||mid) + '</span><span class="switch"><input type="checkbox" data-mod="' + esc(mid) + '" checked><span class="track"></span></span></label>';
      }).join('') + '</div>';
  }
  function collectConfig() {
    var theme = {
      accent: document.getElementById('cfg-accent').value,
      accentDark: document.getElementById('cfg-accentDark').value,
      familyTitle: document.getElementById('cfg-familyTitle').value,
      familyTagline: document.getElementById('cfg-familyTagline').value,
      heroTitle: document.getElementById('cfg-heroTitle').value
    };
    var sections = {};
    var sc = document.querySelectorAll('[data-sec]');
    for (var i=0;i<sc.length;i++) sections[sc[i].getAttribute('data-sec')] = sc[i].checked;
    var mods = {};
    var mc = document.querySelectorAll('[data-mod]');
    for (var j=0;j<mc.length;j++) mods[mc[j].getAttribute('data-mod')] = mc[j].checked;
    var cabinetModules = {};
    var base = (portal.adminConfig && portal.adminConfig.cabinetModules) || {};
    var allIds = Object.keys(base);
    for (var k=0;k<allIds;k++) cabinetModules[allIds[k]] = Object.keys(mods).filter(function(mid){ return mods[mid]; });
    return {theme: theme, sections: sections, cabinetModules: cabinetModules};
  }

  function renderAdminUsers(users) {
    var el = document.getElementById('portal-admin-users');
    if (!el) return;
    el.innerHTML = '<table style="width:100%;border-collapse:collapse"><thead><tr><th>ID</th><th>Имя</th><th>Роль</th><th>Первый вход</th></tr></thead><tbody>' +
      users.map(function(u){ return '<tr><td>'+esc(u.id)+'</td><td>'+esc(u.name)+'</td><td>'+ (u.is_admin?'admin':'family') +'</td><td>'+ (u.first_login?'да':'нет') +'</td></tr>'; }).join('') +
      '</tbody></table>';
  }
  function renderAdminGallery() {
    var el = document.getElementById('portal-admin-gallery'); if (!el || !portal.adminData) return;
    var g = (portal.adminData.SITE_DATA.gallery||[]);
    el.innerHTML = g.map(function(p,i){
      return '<div class="card" style="padding:10px;margin:8px 0"><div class="grid grid-3" style="gap:8px">' +
        '<label>Файл<input data-ag="'+i+'" data-k="file" value="'+esc(p.file||'')+'"></label>' +
        '<label>Заголовок<input data-ag="'+i+'" data-k="title" value="'+esc(p.title||'')+'"></label>' +
        '<label>Подпись<input data-ag="'+i+'" data-k="caption" value="'+esc(p.caption||'')+'"></label></div>' +
        '<div class="row-actions" style="margin-top:8px"><button class="btn btn-small" data-del-ag="'+i+'" type="button">Удалить</button></div></div>';
    }).join('') || '<p class="muted">Нет фото.</p>';
    el.querySelectorAll('[data-ag]').forEach(function(inp){ inp.oninput=function(){ portal.adminData.SITE_DATA.gallery[+inp.dataset.ag][inp.dataset.k]=inp.value; }; });
    el.querySelectorAll('[data-del-ag]').forEach(function(btn){ btn.onclick=function(){ portal.adminData.SITE_DATA.gallery.splice(+btn.dataset.delAg,1); renderAdminGallery(); }; });
  }
  function renderAdminNews() {
    var el = document.getElementById('portal-admin-news'); if (!el || !portal.adminData) return;
    var n = (portal.adminData.SITE_DATA.news||[]);
    el.innerHTML = n.map(function(item,i){
      return '<div class="card" style="padding:10px;margin:8px 0"><div class="grid grid-2" style="gap:8px">' +
        '<label>Дата<input data-an="'+i+'" data-k="date" value="'+esc(item.date||'')+'"></label>' +
        '<label>Заголовок<input data-an="'+i+'" data-k="title" value="'+esc(item.title||'')+'"></label></div>' +
        '<label>Текст<textarea data-an="'+i+'" data-k="text" style="width:100%;min-height:60px">'+esc(item.text||'')+'</textarea></label>' +
        '<div class="row-actions" style="margin-top:8px"><button class="btn btn-small" data-del-an="'+i+'" type="button">Удалить</button></div></div>';
    }).join('') || '<p class="muted">Нет новостей.</p>';
    el.querySelectorAll('[data-an]').forEach(function(inp){ inp.oninput=function(){ portal.adminData.SITE_DATA.news[+inp.dataset.an][inp.dataset.k]=inp.value; }; });
    el.querySelectorAll('[data-del-an]').forEach(function(btn){ btn.onclick=function(){ portal.adminData.SITE_DATA.news.splice(+btn.dataset.delAn,1); renderAdminNews(); }; });
  }
  function wireAdminActions(amsg) {
    var rb=document.getElementById('adm-reset-btn');
    if (rb) rb.onclick=async function(){ var uid=document.getElementById('adm-reset-user').value.trim(); var pw=document.getElementById('adm-reset-pw').value; var r=await portalApi('/api/portal/admin/reset-password',{method:'POST',body:JSON.stringify({user_id:uid,new_password:pw})}); amsg(r.ok?'Пароль сброшен для '+uid:(r.error||'Ошибка'), r.ok); if(r.ok) loadPortalAdmin(); };
    var ab=document.getElementById('adm-add-photo');
    if (ab) ab.onclick=function(){ (portal.adminData.SITE_DATA.gallery=portal.adminData.SITE_DATA.gallery||[]).push({file:'assets/photos/new-photo.jpg',title:'Новое фото',caption:'Описание'}); renderAdminGallery(); };
    var an=document.getElementById('adm-add-news');
    if (an) an.onclick=function(){ (portal.adminData.SITE_DATA.news=portal.adminData.SITE_DATA.news||[]).push({date:'сегодня',title:'Новая новость',text:'Текст'}); renderAdminNews(); };
    var ub=document.getElementById('adm-upload-btn');
    if (ub) ub.onclick=async function(){ var inp=document.getElementById('adm-photo-files'); if(!inp.files.length){amsg('Выберите файлы',false);return;} var fd=new FormData(); for(var i=0;i<inp.files.length;i++) fd.append('photos',inp.files[i],inp.files[i].name); var r=await fetch('/api/portal/admin/upload-photo',{method:'POST',body:fd,credentials:'same-origin',headers:{'X-CSRF-Token':portal.csrf}}); var j=await r.json(); if(!j.ok){amsg(j.error||'Ошибка',false);return;} (portal.adminData.SITE_DATA.gallery=portal.adminData.SITE_DATA.gallery||[]); j.saved.forEach(function(s){ portal.adminData.SITE_DATA.gallery.push({file:s.file,title:s.file.split('/').pop(),caption:'Добавьте описание'}); }); inp.value=''; renderAdminGallery(); amsg('Фото загружены'); };
    var cb=document.getElementById('adm-save-config');
    if (cb) cb.onclick=async function(){ var r=await portalApi('/api/portal/admin/save-config',{method:'POST',body:JSON.stringify({config:collectConfig()})}); amsg(r.ok?'Оформление сохранено':(r.error||'Ошибка'), r.ok); if(r.ok) loadPortalAdmin(); };
    var sb=document.getElementById('adm-save-btn');
    if (sb) sb.onclick=async function(){ var r=await portalApi('/api/portal/admin/save-data',{method:'POST',body:JSON.stringify({data:portal.adminData})}); amsg(r.ok?'Сохранено локально':(r.error||'Ошибка'), r.ok); };
    var pb=document.getElementById('adm-publish-btn');
    if (pb) pb.onclick=async function(){ amsg('Сохраняю и публикую...', true); var s=await portalApi('/api/portal/admin/save-data',{method:'POST',body:JSON.stringify({data:portal.adminData})}); if(!s.ok){amsg(s.error||'Ошибка сохранения',false);return;} var r=await portalApi('/api/portal/admin/publish',{method:'POST',body:JSON.stringify({message:'site: portal admin update'})}); amsg(r.ok?('Опубликовано. '+(r.detail||'')):(r.error||r.detail||'Ошибка публикации'), r.ok); };
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

      (secOn('news') ? '<section class="section">' +
        '<div class="section-head"><div><div class="eyebrow">Общая лента</div><h2>Последние события</h2></div>' +
        '<p class="muted">Пример наполнения</p></div>' +
        '<div class="card">' + data.news.map(function (n) {
          return '<div class="news-item"><span class="date">' + esc(n.date) + '</span>' +
            '<h3>' + esc(n.title) + '</h3><p>' + esc(n.text) + '</p></div>';
        }).join('') + '</div>' +
      '</section>' : '') +

      '<section class="section">' + notice('Это каркас интерфейса: устройства, аккаунты и реальные данные пока не подключены. ' +
        'Все имена и записи — демонстрационные.') + '</section>';
  }

  function renderFamily() {
    return '' +
      '<div class="page-head">' +
        '<div class="eyebrow">Только для своих</div>' +
        '<h1>' + esc(data.familyTitle) + '</h1>' +
        '<p class="lead">Выберите свой кабинет. У каждого члена семьи — свой набор разделов и свой функционал.</p>' +
        '<div class="hero-actions"><button class="btn btn-secondary btn-small" type="button" data-scroll="gallery">' +
          icon('devices') + ' Фотогалерея</button></div>' +
      '</div>' +
      notice('Вход пока демонстрационный: пароли и привязка аккаунтов будут добавлены позже. ' +
        'Выберите профиль, чтобы посмотреть устройство кабинета.') +
      (secOn('familyTree') ? '<section class="section">' +
        '<div class="section-head"><div><h2>Кто есть кто</h2></div><p>Семейные связи</p></div>' +
        '<div class="grid grid-3">' + (data.familyTree || []).map(function (group) {
          return '<div class="card"><h3>' + esc(group.title) + '</h3>' +
            '<p class="muted">' + esc(group.hint) + '</p>' +
            '<ul class="simple-list tree-list">' + group.ids.map(function (id) {
              var person = memberById(id);
              if (!person) return '';
              return '<li><a href="#/cabinet/' + encodeURIComponent(id) + '">' + esc(person.name) + '</a> — ' +
                esc(person.relation) + '</li>';
            }).join('') + '</ul></div>';
        }).join('') + '</div>' +
      '</section>' : '') +

      '<section class="section">' +
        '<div class="section-head"><div><h2>Личные кабинеты</h2></div><p>' + data.members.length + ' профиля в каркасе</p></div>' +
        '<div class="member-grid">' + data.members.map(function (m) {
          return '<a class="member-card" href="#/cabinet/' + encodeURIComponent(m.id) + '" style="--avatar:' + esc(m.color) + '">' +
            '<span class="avatar">' + esc(m.initials) + '</span>' +
            '<span class="member-name">' + esc(m.name) + (m.short ? ' (' + esc(m.short) + ')' : '') + '</span>' +
            '<span class="member-meta">' + esc(m.role) + ' · ' + m.modules.length + ' разделов</span>' +
            '<span class="member-note">' + esc(m.relation) + '</span>' +
            '<span class="status-line"><span class="dot dot-green"></span>' + esc(m.status) + '</span>' +
          '</a>';
        }).join('') + '</div>' +
      '</section>' +

      (secOn('gallery') ? '<section class="section" id="gallery">' +
        '<div class="section-head"><div><div class="eyebrow">Только для своих</div><h2>Семейная галерея</h2></div>' +
        '<p>Фото добавляются в `assets/photos/`</p></div>' +
        '<div class="gallery-grid">' + (data.gallery || []).map(function (photo, index) {
          return '<button class="photo-card" type="button" data-photo="' + esc(photo.file) + '" ' +
            'data-caption="' + esc(photo.title + ' — ' + photo.caption) + '">' +
            '<span class="photo-frame">' +
              '<span class="photo-placeholder">' + icon('spark') + '<small>' + esc(photo.file) + '</small></span>' +
              '<img src="' + esc(photo.file) + '" alt="' + esc(photo.title) + '" loading="lazy">' +
            '</span>' +
            '<span class="photo-info"><strong>' + esc(photo.title) + '</strong><small>' + esc(photo.caption) + '</small></span>' +
          '</button>';
        }).join('') + '</div>' +
        '<p class="muted gallery-hint">Пока файла нет, вместо фото показывается рамка с именем файла. ' +
        'Нажмите на загруженное фото, чтобы открыть его целиком.</p>' +
      '</section>' : '') +

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

      (secOn('guestbook') ? '<section class="section">' +
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
      '</section>' : '') +

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
            '<div><h1>' + esc(mod.title) + '</h1><p>' + esc(mod.subtitle) + '</p>' +
            '<p class="cabinet-relation">' + esc(member.relation) + '</p></div>' +
            '<div class="header-actions"><a class="btn btn-secondary btn-small" href="#/family">Сменить кабинет</a></div>' +
          '</div>' +
          '<div class="widgets">' + widgets + '</div>' +
          (isMyCabinet(member.id) ? renderMyCabinet(member) : renderSharedContent(member)) +
          '<div class="section">' + notice('Этот раздел — ваш личный кабинет. Изменения сохраняются на локальном сервере портала.') + '</div>' +
        '</div>' +
      '</div>';
  }

  function renderProfileEditor(member) {
    var about = esc(member.about || '');
    var details = member.details || {};
    var fields = [['Город', 'city'], ['День рождения', 'birthday'], ['Телефон', 'phone'], ['Интересы', 'hobbies']];
    return '<section class="widget wide"><div class="widget-head"><h3>Мой профиль</h3><span class="tag">редактируется</span></div>' +
      '<form id="my-profile-form" class="guestbook-form">' +
      '<label><strong>О себе</strong><textarea id="my-about" maxlength="4000" placeholder="Пара слов о себе">' + about + '</textarea></label>' +
      '<div class="grid grid-2">' + fields.map(function (f) {
        return '<label><strong>' + esc(f[0]) + '</strong><input data-detail="' + esc(f[1]) + '" value="' + esc(details[f[1]] || '') + '" maxlength="200"></label>';
      }).join('') + '</div>' +
      '<div class="row-actions"><button class="btn btn-primary btn-small" type="submit">Сохранить профиль</button></div>' +
      '<p class="muted" id="my-profile-msg"></p></form></section>';
  }

  function renderStoryEditor(member) {
    var stories = member.stories || [];
    return '<section class="widget wide"><div class="widget-head"><h3>Моя история</h3><span class="tag">делитесь с семьёй</span></div>' +
      '<div class="story-list">' + stories.map(function (st) {
        return '<article class="story-item"><div class="story-date">' + esc(st.date || '') + '</div>' +
          '<h4>' + esc(st.title || '') + '</h4><p>' + esc(st.text || '') + '</p>' +
          '<button class="btn btn-small" data-story-del="' + esc(st.id) + '" type="button">Удалить</button></article>';
      }).join('') + '</div>' +
      '<form id="my-story-form" class="guestbook-form" style="margin-top:12px">' +
      '<div class="grid grid-2"><label><strong>Дата</strong><input id="story-date" placeholder="например, 2026"></label>' +
      '<label><strong>Заголовок</strong><input id="story-title" maxlength="160" placeholder="Событие"></label></div>' +
      '<label><strong>Рассказ</strong><textarea id="story-text" maxlength="6000" placeholder="Что произошло?"></textarea></label>' +
      '<div class="row-actions"><button class="btn btn-primary btn-small" type="submit">Добавить в историю</button></div>' +
      '<p class="muted" id="my-story-msg"></p></form></section>';
  }

  function renderMyPhotos(member) {
    var photos = member.userPhotos || [];
    return '<section class="widget wide"><div class="widget-head"><h3>Мои фотографии</h3><span class="tag">только для семьи</span></div>' +
      '<div class="gallery-grid">' + photos.map(function (ph) {
        return '<button class="photo-card is-loaded" type="button" data-photo="' + esc(ph.file) + '" data-caption="' + esc(ph.caption || member.name) + '">' +
          '<span class="photo-frame"><img src="' + esc(ph.file) + '" alt="' + esc(ph.caption || '') + '" loading="lazy"></span>' +
          '<span class="photo-info"><strong>' + esc(ph.caption || '') + '</strong></span></button>' +
          '<button class="btn btn-small" data-photo-del="' + esc(ph.file) + '" type="button">Удалить</button>';
      }).join('') + '</div>' +
      '<form id="my-photo-form" class="guestbook-form" style="margin-top:12px">' +
      '<label><strong>Загрузить фото</strong><input id="my-photo-file" type="file" accept="image/*" multiple></label>' +
      '<div class="row-actions"><button class="btn btn-primary btn-small" type="submit">Загрузить</button></div>' +
      '<p class="muted" id="my-photo-msg"></p></form></section>';
  }

  function renderMyCabinet(member) {
    return '<div class="section my-cabinet"><div class="section-head"><div class="eyebrow">Личное</div><h2>Мой кабинет</h2></div>' +
      renderProfileEditor(member) + renderStoryEditor(member) + renderMyPhotos(member) + '</div>';
  }

  function renderSharedContent(member) {
    var stories = member.stories || [];
    var photos = member.userPhotos || [];
    if (!stories.length && !photos.length) return '';
    return '<div class="section my-cabinet"><div class="section-head"><div><div class="eyebrow">История и фото</div><h2>' + esc(member.name) + ' делится</h2></div></div>' +
      (stories.length ? '<section class="widget wide"><div class="widget-head"><h3>История</h3></div><div class="story-list">' +
        stories.map(function (st) { return '<article class="story-item"><div class="story-date">' + esc(st.date || '') + '</div><h4>' + esc(st.title || '') + '</h4><p>' + esc(st.text || '') + '</p></article>'; }).join('') +
        '</div></section>' : '') +
      (photos.length ? '<section class="widget wide"><div class="widget-head"><h3>Фотографии</h3></div><div class="gallery-grid">' +
        photos.map(function (ph) { return '<button class="photo-card is-loaded" type="button" data-photo="' + esc(ph.file) + '" data-caption="' + esc(ph.caption || '') + '"><span class="photo-frame"><img src="' + esc(ph.file) + '" alt="' + esc(ph.caption || '') + '" loading="lazy"></span></button>'; }).join('') +
        '</div></section>' : '') + '</div>';
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
          '<dl><dt>Имя</dt><dd>' + esc(member.name) + (member.short ? ' (' + esc(member.short) + ')' : '') + '</dd>' +
          '<dt>Родство</dt><dd>' + esc(member.relation) + '</dd>' +
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
    var gated = portal.enabled && (route.page === 'family' || route.page === 'cabinet' || route.page === 'admin');
    if (gated && !portal.authenticated) {
      html = renderPortalLogin('Войдите, чтобы открыть раздел семьи и личные кабинеты.');
    } else if (gated && portal.firstLogin) {
      html = renderPortalChangePw();
    } else if (route.page === 'admin') {
      html = renderPortalAdmin();
    } else {
      switch (route.page) {
        case 'guest': html = renderGuest(); break;
        case 'family': html = renderFamily(); break;
        case 'cabinet': html = renderCabinet(route.member, route.module); break;
        default: html = renderHome();
      }
    }
    app.innerHTML = html;
    wireGallery();
    syncPortalHeader();
    if (route.page === 'admin' && portal.authenticated && portal.user && portal.user.is_admin && !portal.firstLogin) {
      loadPortalAdmin();
    }

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

  /* ---------- Галерея ---------- */
  function wireGallery() {
    if (typeof app.querySelectorAll !== 'function') return;
    var cards = app.querySelectorAll('.photo-card');
    for (var i = 0; i < cards.length; i++) {
      (function (card) {
        var img = card.querySelector('img');
        if (!img) return;
        img.addEventListener('load', function () { card.classList.add('is-loaded'); });
        img.addEventListener('error', function () { card.classList.add('is-missing'); });
        if (img.complete) card.classList.add(img.naturalWidth > 0 ? 'is-loaded' : 'is-missing');
      })(cards[i]);
    }
  }

  function openLightbox(src, caption) {
    var box = document.getElementById('lightbox');
    if (!box) return;
    var img = document.getElementById('lightbox-img');
    var cap = document.getElementById('lightbox-caption');
    if (img) { img.src = src; img.alt = caption; }
    if (cap) cap.textContent = caption;
    box.hidden = false;
  }

  function closeLightbox() {
    var box = document.getElementById('lightbox');
    if (box) box.hidden = true;
  }

  /* ---------- События ---------- */
  app.addEventListener('submit', async function (e) {
    if (e.target.id === 'portal-login-form') {
      e.preventDefault();
      var msg = document.getElementById('portal-login-msg');
      var u = document.getElementById('portal-user').value.trim();
      var p = document.getElementById('portal-pass').value;
      var r = await portalApi('/api/portal/login', {method:'POST', body: JSON.stringify({username:u,password:p})});
      if (!r.ok) { if (msg) msg.textContent = r.error || 'Ошибка входа'; return; }
      await refreshPortal();
      if (portal.firstLogin) { render(); }
      else { location.reload(); }
      return;
    }
    if (e.target.id === 'portal-pw-form') {
      e.preventDefault();
      var msg2 = document.getElementById('portal-pw-msg');
      var cur = document.getElementById('portal-cur').value;
      var n1 = document.getElementById('portal-new').value;
      var n2 = document.getElementById('portal-new2').value;
      if (n1 !== n2) { if (msg2) msg2.textContent = 'Пароли не совпадают'; return; }
      var r2 = await portalApi('/api/portal/change-password', {method:'POST', body: JSON.stringify({current_password:cur,new_password:n1})});
      if (!r2.ok) { if (msg2) msg2.textContent = r2.error || 'Ошибка'; return; }
      await refreshPortal();
      location.reload();
      return;
    }
    if (e.target.id === 'my-profile-form') {
      e.preventDefault();
      var msg = document.getElementById('my-profile-msg');
      var details = {};
      var ins = e.target.querySelectorAll('[data-detail]');
      for (var i = 0; i < ins.length; i++) details[ins[i].getAttribute('data-detail')] = ins[i].value;
      var r = await portalApi('/api/portal/content/profile', {method:'POST', body: JSON.stringify({about: document.getElementById('my-about').value, details: details})});
      if (msg) msg.textContent = r.ok ? 'Профиль сохранён' : (r.error || 'Ошибка');
      return;
    }
    if (e.target.id === 'my-story-form') {
      e.preventDefault();
      var msg2 = document.getElementById('my-story-msg');
      var title = document.getElementById('story-title').value.trim();
      var text = document.getElementById('story-text').value.trim();
      if (!title && !text) { if (msg2) msg2.textContent = 'Заполните заголовок или текст'; return; }
      var r2 = await portalApi('/api/portal/content/story', {method:'POST', body: JSON.stringify({date: document.getElementById('story-date').value, title: title, text: text})});
      if (r2.ok) { location.reload(); }
      else if (msg2) msg2.textContent = r2.error || 'Ошибка';
      return;
    }
    if (e.target.id === 'my-photo-form') {
      e.preventDefault();
      var msg3 = document.getElementById('my-photo-msg');
      var fileInput = document.getElementById('my-photo-file');
      if (!fileInput.files || !fileInput.files.length) { if (msg3) msg3.textContent = 'Выберите файлы'; return; }
      var fd = new FormData();
      for (var j = 0; j < fileInput.files.length; j++) fd.append('photos', fileInput.files[j], fileInput.files[j].name);
      var r3 = await fetch('/api/portal/content/photo-upload', {method:'POST', body: fd, credentials:'same-origin', headers:{'X-CSRF-Token': portal.csrf}});
      var j3 = await r3.json();
      if (j3.ok) { location.reload(); }
      else if (msg3) msg3.textContent = j3.error || 'Ошибка загрузки';
      return;
    }
  }, true);

  app.addEventListener('click', async function (e) {
    var logoutBtn = e.target.closest && e.target.closest('[data-portal-logout]');
    if (logoutBtn) { e.preventDefault(); await portalApi('/api/portal/logout',{method:'POST'}); await refreshPortal(); location.hash='#/home'; location.reload(); return; }
    var storyDel = e.target.closest && e.target.closest('[data-story-del]');
    if (storyDel) { e.preventDefault(); var r=await portalApi('/api/portal/content/story',{method:'POST',body:JSON.stringify({action:'delete',id:storyDel.getAttribute('data-story-del')})}); if(r.ok) location.reload(); return; }
    var photoDel = e.target.closest && e.target.closest('[data-photo-del]');
    if (photoDel) { e.preventDefault(); var r2=await portalApi('/api/portal/content/photo-remove',{method:'POST',body:JSON.stringify({file:photoDel.getAttribute('data-photo-del')})}); if(r2.ok) location.reload(); return; }
    var scrollBtn = e.target.closest && e.target.closest('[data-scroll]');
    if (scrollBtn) {
      var target = document.getElementById(scrollBtn.getAttribute('data-scroll'));
      if (target && target.scrollIntoView) target.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    var card = e.target.closest && e.target.closest('.photo-card');
    if (card && card.classList.contains('is-loaded')) {
      openLightbox(card.getAttribute('data-photo'), card.getAttribute('data-caption'));
    }
  });

  if (document.addEventListener) {
    document.addEventListener('click', function (e) {
      if (e.target.id === 'lightbox' || (e.target.classList && e.target.classList.contains('lightbox-close'))) {
        closeLightbox();
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeLightbox();
    });
  }

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
  async function boot() {
    if (portal.enabled) await refreshPortal();
    if (!location.hash) location.hash = '#/home';
    render();
  }
  boot();
})();
