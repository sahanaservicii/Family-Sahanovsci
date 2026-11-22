/*
 * Данные сайта. Имена и связи заданы владельцем сайта.
 * Устройства и личные данные по-прежнему не подключены — только структура кабинетов.
 */
window.SITE_DATA = {
  familyTitle: 'Наша семья',
  familyTagline: 'Общее пространство для своих — и понятная информация для гостей.',

  members: [
    {
      id: 'andrey',
      name: 'Андрей',
      role: 'Папа, муж',
      initials: 'А',
      color: '#2f6d63',
      status: 'Дома',
      relation: 'Папа Арины и Давида, муж Анны; сын Андрея-старшего и Елены',
      note: 'Общие вопросы, умный дом, планы',
      modules: ['overview', 'smart-home', 'devices', 'personal', 'tasks', 'schedule', 'notes', 'settings']
    },
    {
      id: 'anna',
      name: 'Анна',
      short: 'Аня',
      role: 'Мама, жена',
      initials: 'А',
      color: '#a4586d',
      status: 'Дома',
      relation: 'Жена Андрея, мама Арины и Давида; дочь Иры и Михаила',
      note: 'Семейные планы, задачи, заметки',
      modules: ['overview', 'smart-home', 'devices', 'personal', 'tasks', 'schedule', 'notes', 'settings']
    },
    {
      id: 'arina',
      name: 'Арина',
      role: 'Ребёнок',
      initials: 'А',
      color: '#b56a8b',
      status: 'Дома',
      relation: 'Дочь Андрея и Анны, сестра Давида',
      note: 'Задачи, расписание, заметки',
      modules: ['overview', 'tasks', 'schedule', 'notes', 'personal']
    },
    {
      id: 'david',
      name: 'Давид',
      role: 'Ребёнок',
      initials: 'Д',
      color: '#4a6b9a',
      status: 'Дома',
      relation: 'Сын Андрея и Анны, брат Арины',
      note: 'Задачи, расписание',
      modules: ['overview', 'tasks', 'schedule', 'personal']
    },
    {
      id: 'ira',
      name: 'Ира',
      role: 'Взрослый',
      initials: 'И',
      color: '#b46c2f',
      status: 'Дома',
      relation: 'Мама Анны, дочь Нельи',
      note: 'Семейные связи, задачи',
      modules: ['overview', 'personal', 'tasks', 'schedule', 'notes', 'settings']
    },
    {
      id: 'mikhail',
      name: 'Михаил',
      role: 'Взрослый',
      initials: 'М',
      color: '#8a5a3b',
      status: 'Дома',
      relation: 'Папа Анны',
      note: 'Умный дом, устройства, техника',
      modules: ['overview', 'smart-home', 'devices', 'personal', 'tasks', 'schedule', 'settings']
    },
    {
      id: 'elena',
      name: 'Елена',
      role: 'Взрослый',
      initials: 'Е',
      color: '#6a7f5b',
      status: 'Дома',
      relation: 'Мама Андрея, бабушка Арины и Давида',
      note: 'Семейные связи, заметки',
      modules: ['overview', 'personal', 'tasks', 'schedule', 'notes']
    },
    {
      id: 'andrey-sr',
      name: 'Андрей-старший',
      short: 'Андрей (старший)',
      role: 'Взрослый',
      initials: 'А',
      color: '#556b7a',
      status: 'Дома',
      relation: 'Папа Андрея, дед Арины и Давида',
      note: 'Семейные связи',
      modules: ['overview', 'personal', 'tasks', 'schedule']
    },
    {
      id: 'nelya',
      name: 'Нелья',
      role: 'Взрослый',
      initials: 'Н',
      color: '#8e6a8f',
      status: 'Дома',
      relation: 'Мама Иры, бабушка Анны',
      note: 'Семейные связи',
      modules: ['overview', 'personal', 'schedule', 'notes']
    }
  ],

  familyTree: [
    { title: 'Старшее поколение', hint: 'Родители и бабушки/дедушки', ids: ['andrey-sr', 'elena', 'nelya'] },
    { title: 'Родители', hint: 'Папы и мамы', ids: ['andrey', 'anna', 'ira', 'mikhail'] },
    { title: 'Дети', hint: 'Арина и Давид', ids: ['arina', 'david'] }
  ],

  /* Файлы кладутся в assets/photos/. Пока файла нет — показывается заглушка. */
  gallery: [
    { file: 'assets/photos/family-01.jpg', title: 'Семейное фото', caption: 'Добавьте описание' },
    { file: 'assets/photos/family-02.jpg', title: 'Вместе', caption: 'Добавьте описание' },
    { file: 'assets/photos/family-03.jpg', title: 'День семьи', caption: 'Добавьте описание' },
    { file: 'assets/photos/family-04.jpg', title: 'Праздник', caption: 'Добавьте описание' },
    { file: 'assets/photos/family-05.jpg', title: 'На прогулке', caption: 'Добавьте описание' },
    { file: 'assets/photos/family-06.jpg', title: 'Дома', caption: 'Добавьте описание' }
  ],

  guestCards: [
    {
      icon: 'info',
      title: 'О нас',
      text: 'Короткая информация о семье, чтобы гости чувствовали себя свободно. Раздел заполняется позже.'
    },
    {
      icon: 'calendar',
      title: 'Как нас найти',
      text: 'Адрес, ориентиры, парковка и время, когда удобно заглянуть. Пока заглушка.'
    },
    {
      icon: 'chat',
      title: 'Связаться',
      text: 'Контакты для связи появятся здесь, когда вы решите, чем делиться с гостями.'
    },
    {
      icon: 'book',
      title: 'Гостевая книга',
      text: 'Оставьте пару слов — записи хранятся только в этом браузере, как демонстрация.'
    }
  ],

  news: [
    { date: 'пример', title: 'Новость появится здесь', text: 'Общие объявления для семьи и гостей.' },
    { date: 'пример', title: 'Раздел в разработке', text: 'Здесь будет лента событий семьи.' }
  ]
};

/* Описание модулей личного кабинета: заголовок, подпись и список виджетов-заглушек. */
window.SITE_MODULES = {
  overview: {
    title: 'Обзор',
    icon: 'grid',
    subtitle: 'Коротко о главном в вашем кабинете',
    widgets: [
      { type: 'stats', title: 'Сегодня' },
      { type: 'list', title: 'Ближайшее', items: ['Запланированное событие — пример', 'Одна задача на сегодня — пример', 'Общее объявление — пример'] },
      { type: 'placeholder', title: 'Быстрые действия', text: 'Кнопки быстрых действий появятся после подключения реальных модулей.' }
    ]
  },
  'smart-home': {
    title: 'Умный дом',
    icon: 'home',
    subtitle: 'Сценарии и управление — пока только демонстрация',
    widgets: [
      { type: 'demo-switches', title: 'Демо-выключатели' },
      { type: 'placeholder', title: 'Сценарии', text: 'Здесь появятся сценарии умного дома. Реальные устройства пока не подключены.' },
      { type: 'list', title: 'Состояние (пример)', items: ['Свет в гостиной — выкл.', 'Температура — 21 °C', 'Режим «Никого нет» — выкл.'] }
    ]
  },
  devices: {
    title: 'Мои устройства',
    icon: 'devices',
    subtitle: 'Список закреплённых устройств',
    widgets: [
      { type: 'list', title: 'Закреплённые (пример)', items: ['Телевизор в спальне', 'Умная колонка', 'Камера у входа'] },
      { type: 'placeholder', title: 'Подробности устройства', text: 'Статус, батарея и действия появятся после подключения источников данных.' }
    ]
  },
  personal: {
    title: 'Личные данные',
    icon: 'user',
    subtitle: 'Только ваша информация',
    widgets: [
      { type: 'profile', title: 'Профиль' },
      { type: 'placeholder', title: 'Документы и заметки', text: 'Здесь можно будет хранить личные записи. Сейчас пример без реальных данных.' },
      { type: 'placeholder', title: 'Приватность', text: 'Настройки видимости и доступа появятся вместе с авторизацией.' }
    ]
  },
  tasks: {
    title: 'Задачи',
    icon: 'check',
    subtitle: 'Дела и напоминания',
    widgets: [
      { type: 'tasks', title: 'Мой список' },
      { type: 'placeholder', title: 'Общие задачи', text: 'Список будет общим для семьи после подключения хранилища.' }
    ]
  },
  schedule: {
    title: 'Расписание',
    icon: 'calendar',
    subtitle: 'Планы на ближайшие дни',
    widgets: [
      { type: 'list', title: 'На этой неделе (пример)', items: ['Понедельник — пример события', 'Среда — пример события', 'Суббота — пример события'] },
      { type: 'placeholder', title: 'Календарь', text: 'Календарь с обновлениями появится в следующей версии.' }
    ]
  },
  notes: {
    title: 'Заметки',
    icon: 'note',
    subtitle: 'Личные записи',
    widgets: [
      { type: 'placeholder', title: 'Мои заметки', text: 'Текстовые заметки с сохранением появятся позже.' },
      { type: 'list', title: 'Примеры', items: ['Список покупок — пример', 'Идеи для выходных — пример'] }
    ]
  },
  settings: {
    title: 'Настройки',
    icon: 'settings',
    subtitle: 'Персональные параметры кабинета',
    widgets: [
      { type: 'placeholder', title: 'Профиль и уведомления', text: 'Настройки появятся после реализации входа и уведомлений.' },
      { type: 'placeholder', title: 'Доступ', text: 'Управление доступом к модулям будет добавлено позднее.' }
    ]
  }
};

/* Какие задачи показывать в демо-списке каждого члена семьи. */
window.SITE_DEMO_TASKS = {
  andrey: ['Согласовать планы на выходные', 'Проверить демонстрационные выключатели'],
  anna: ['Согласовать планы на выходные', 'Проверить общий список покупок'],
  arina: ['Собрать рюкзак', 'Добавить идею в заметки'],
  david: ['Почитать 20 минут', 'Отметить событие в расписании'],
  ira: ['Уточнить семейные планы', 'Записать важную дату'],
  mikhail: ['Проверить демонстрационные выключатели', 'Обновить список устройств'],
  elena: ['Позвонить родным', 'Записать мысль в заметки'],
  'andrey-sr': ['Уточнить семейные новости', 'Отметить дату в расписании'],
  nelya: ['Записать семейную историю', 'Отметить важную дату']
};
