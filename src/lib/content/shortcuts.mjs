// Кожна комбінація, яку розуміє сервіс, і те, де вона працює.
//
// Раніше цей список був майже цілком про палітру: ⌘K, стрілки, Enter — і на
// тому все, хоча редактор тексту, чат, вибір у списках і перегляд вкладення
// мають власні клавіші. Список, який знає лише про одне вікно, вчить, що
// клавіатурою можна робити лише одну річ.
//
// `keys` — те, що написано на клавіатурі Apple; `alt` — те саме на решті.
// Порядок груп — від того, що працює будь-де, до того, що працює в одному
// місці.
export const SHORTCUT_GROUPS = Object.freeze([
  Object.freeze({
    label: 'Всюди',
    items: Object.freeze([
      Object.freeze({ keys: ['⌘', 'K'], label: 'Відкрити командну палітру', alt: ['Ctrl', 'K'] }),
      Object.freeze({ keys: ['Esc'], label: 'Закрити вікно, панель, меню або підказку' }),
    ]),
  }),
  Object.freeze({
    label: 'Пошук у шапці',
    items: Object.freeze([
      Object.freeze({ keys: ['↓'], label: 'Пошукати по всьому простору, коли на сторінці нічого не знайшлось' }),
      Object.freeze({ keys: ['↵'], label: 'Відкрити цей запит у палітрі' }),
    ]),
  }),
  Object.freeze({
    label: 'У палітрі',
    items: Object.freeze([
      Object.freeze({ keys: ['↑', '↓'], label: 'Перейти між результатами' }),
      Object.freeze({ keys: ['↵'], label: 'Відкрити вибране' }),
      Object.freeze({ keys: ['⌫'], label: 'Зняти обмеження проєктом, коли поле вже порожнє' }),
    ]),
  }),
  // «Вибрати діапазон» не казало ані з чого починається діапазон, ані що перший
  // Shift+клік узагалі вмикає вибір. Дві дії — два рядки, кожен своїми словами.
  Object.freeze({
    label: 'У списках, на дошці й у таблиці завдань',
    items: Object.freeze([
      Object.freeze({ keys: ['Shift', 'Клік'], label: 'Почати вибір із цього завдання' }),
      Object.freeze({ keys: ['Shift', 'Клік'], label: 'Далі — вибрати все між першим і цим' }),
      Object.freeze({ keys: ['Esc'], label: 'Зняти вибір' }),
    ]),
  }),
  Object.freeze({
    label: 'На сторінці завдання',
    items: Object.freeze([
      Object.freeze({ keys: ['Esc'], label: 'Повернутись до дошки проєкту' }),
      Object.freeze({ keys: ['Esc'], label: 'Вийти з редагування назви або опису' }),
      Object.freeze({ keys: ['↵'], label: 'Додати підзадачу, не тягнучись до кнопки' }),
    ]),
  }),
  Object.freeze({
    label: 'У полі тексту — опис, коментар, повідомлення',
    items: Object.freeze([
      Object.freeze({ keys: ['⌘', 'B'], label: 'Жирний', alt: ['Ctrl', 'B'] }),
      Object.freeze({ keys: ['⌘', 'I'], label: 'Курсив', alt: ['Ctrl', 'I'] }),
      Object.freeze({ keys: ['⌘', 'K'], label: 'Вставити посилання', alt: ['Ctrl', 'K'] }),
      Object.freeze({ keys: ['⌘', 'Z'], label: 'Скасувати', alt: ['Ctrl', 'Z'] }),
      Object.freeze({ keys: ['⌘', '⇧', 'Z'], label: 'Повернути', alt: ['Ctrl', 'Y'] }),
      Object.freeze({ keys: ['Tab'], label: 'Зсунути пункт списку вправо' }),
      Object.freeze({ keys: ['⇧', 'Tab'], label: 'Зсунути пункт списку вліво' }),
      Object.freeze({ keys: ['↵'], label: 'Продовжити список наступним пунктом' }),
    ]),
  }),
  Object.freeze({
    label: 'У чаті та в коментарях',
    items: Object.freeze([
      Object.freeze({ keys: ['↵'], label: 'Надіслати' }),
      Object.freeze({ keys: ['⇧', '↵'], label: 'Новий рядок замість надсилання' }),
      Object.freeze({ keys: ['@'], label: 'Згадати людину' }),
      Object.freeze({ keys: ['#'], label: 'Послатись на завдання' }),
      Object.freeze({ keys: ['↑', '↓'], label: 'Вибрати зі списку згадок' }),
      Object.freeze({ keys: ['↵'], label: 'Вставити вибрану згадку' }),
      Object.freeze({ keys: ['Esc'], label: 'Закрити список згадок або скасувати правку' }),
    ]),
  }),
  Object.freeze({
    label: 'У перегляді вкладення',
    items: Object.freeze([
      Object.freeze({ keys: ['+'], label: 'Збільшити зображення' }),
      Object.freeze({ keys: ['-'], label: 'Зменшити зображення' }),
      Object.freeze({ keys: ['Esc'], label: 'Закрити перегляд' }),
    ]),
  }),
  Object.freeze({
    label: 'У вкладках',
    items: Object.freeze([
      Object.freeze({ keys: ['←', '→'], label: 'Перейти між вкладками' }),
      Object.freeze({ keys: ['Home'], label: 'Перша вкладка' }),
      Object.freeze({ keys: ['End'], label: 'Остання вкладка' }),
    ]),
  }),
]);
