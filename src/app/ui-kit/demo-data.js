'use client';

// Each of these ships on the site, and the first version of this preview gave
// no way to tell — six bare buttons labelled with prop syntax read as invented
// options. `where` is the screen you have already seen it on; `open` is what
// you do there to get it. Counts come from `npm run kit:scan`.
// Shaped exactly as the chat page feeds MessageBubble: `user`/`time` are
// pre-formatted by the page, `createdAt` is a Firestore-style stamp whose
// toMillis() decides whether consecutive messages share one avatar header.
// `toDate` as well as `toMillis`: a Firestore Timestamp carries both, and the
// day separator reads the first while avatar grouping reads the second. A stub
// with only `toMillis` printed «Invalid Date» in the separator.
export const stamp = (minutesAgo) => {
  const ms = Date.now() - minutesAgo * 60_000;
  return { toMillis: () => ms, toDate: () => new Date(ms) };
};

export const CHAT_DEMO_MEMBERS = [
  { id: 'kit-arthur', name: 'Артур Моспан' },
  { id: 'kit-olena', name: 'Олена Коваль', statusEmoji: '🎧', statusText: 'У фокусі' },
];

export const CHAT_DEMO_MESSAGES = [
  {
    id: 'm1',
    senderId: 'kit-olena',
    user: 'Олена Коваль',
    time: '10:42',
    text: 'Закинула макети нового онбордингу — гляньте другий екран, там питання по копірайту.',
    createdAt: stamp(34),
    reactions: { '👍': ['kit-arthur'] },
  },
  {
    id: 'm2',
    senderId: 'kit-arthur',
    user: 'Артур Моспан',
    time: '10:51',
    // A mention mid-sentence, deliberately: the chip is the most-repeated thing
    // inside a message and the kit could not show one, so nothing here could
    // ever have caught it standing a line taller than the words around it or
    // hanging off its own avatar's baseline instead of theirs.
    text: 'Подивився, @Олена Коваль — другий екран ок, тільки заголовок довший за колонку і зріжеться на мобілці.',
    createdAt: stamp(25),
  },
  {
    id: 'm3',
    senderId: 'kit-arthur',
    user: 'Артур Моспан',
    time: '10:52',
    // A mentioned task beside a mentioned person, because the two chips are one
    // shape and the only way to see that they still are is to see them on the
    // same line. Outside a workspace there is no task to resolve, so the chip
    // shows the key it was written with — the geometry is the point here.
    text: 'І ще: кнопку «Далі» варто зробити на всю ширину, як у #QT-14.',
    createdAt: stamp(24),
    isPinned: true,
  },
];

// Chat's own kit components. The native controls that chat still hand-rolls
// were listed here too, which duplicated /ui-audit → Чат byte for byte; what
// stays is what chat contributes *to the kit* — its avatar scale, its icon
// sizes and its day divider, all of them real components.
export const KIT_MENTION_MEMBERS = [
  { id: 'kit-arthur', name: 'Артур Моспан', email: 'arthur@quickteam.app' },
  { id: 'kit-olena', name: 'Олена Коваль', email: 'olena@quickteam.app' },
  { id: 'kit-petro', name: 'Петро Іванчук', email: 'petro@quickteam.app' },
];
