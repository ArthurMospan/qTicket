import { FieldValue } from 'firebase-admin/firestore';
import { isVisibleChatChannel } from '@/lib/utils/workspaceChat.mjs';

/**
 * Непрочитане починається з моменту, коли людина могла це побачити.
 *
 * Лічильник чату рахує так: беремо `channel.messageCount` і віднімаємо
 * `messageCount` із курсора прочитаного. У того, хто щойно приєднався, курсора
 * немає взагалі, тож віднімався нуль — і новачок отримував бейдж на всю історію
 * каналу, включно з розмовами, яких він не бачив і не міг бачити. «У вас 5
 * непрочитаних» про повідомлення, написані до його appearance в організації, —
 * це не сигнал, а шум, з якого нічого не можна зробити.
 *
 * Тому місце в кімнаті видається разом із курсором: на момент приєднання
 * прочитано все, що вже було сказано. Історія лишається на місці й читається
 * прокруткою — зникає лише твердження, що вона нова.
 *
 * Пишеться там, де створюється членство, і тими самими полями, що їх пише
 * `markAsRead` у браузері (`organizations/{org}/readState/{uid}_{channel}`) —
 * інакше два записувачі одного документа розійшлися б у формі.
 *
 * Найкраще зусилля: приєднання не має провалюватись через те, що курсор не
 * записався. Гірший наслідок помилки — той самий бейдж, що й був.
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} organizationId
 * @param {string} userId
 * @returns {Promise<number>} скільки каналів отримали курсор
 */
export async function seedChatReadState(db, organizationId, userId) {
  if (!organizationId || !userId) return 0;
  try {
    const snapshot = await db
      .collection('organizations').doc(organizationId)
      .collection('channels')
      .get();

    const channels = snapshot.docs
      .map(document => ({ ...document.data(), id: document.id }))
      // Рівно та сама видимість, що її питає лічильник: приватні кімнати й
      // прямі діалоги новачка не стосуються, і курсорів для них не треба.
      .filter(channel => isVisibleChatChannel(channel, userId));
    if (channels.length === 0) return 0;

    const batch = db.batch();
    for (const channel of channels) {
      batch.set(
        db.collection('organizations').doc(organizationId)
          .collection('readState').doc(`${userId}_${channel.id}`),
        {
          channelId: channel.id,
          userId,
          lastReadAt: FieldValue.serverTimestamp(),
          messageCount: Number(channel.messageCount || 0),
        },
        { merge: true },
      );
    }
    await batch.commit();
    return channels.length;
  } catch (error) {
    console.error('[chatReadState] could not seed read cursors', {
      organizationId,
      userId,
      message: error?.message,
    });
    return 0;
  }
}
