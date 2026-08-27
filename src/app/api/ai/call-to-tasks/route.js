// src/app/api/ai/call-to-tasks/route.js
// «Дзвінок → задачі»: приймає текст транскрипту АБО URL аудіозапису
// (завантаженого нашим же підписаним Cloudinary-аплоадом — тому без ліміту
// 4.5МБ на тіло запиту) і віддає ШІ на витяг: саммарі, рішення, чернетки задач.
// Створення задач лишається за користувачем — цей роут нічого не пише в БД.
//
// Провайдер один: GEMINI_API_KEY. Безкоштовний tier, читає аудіо НАТИВНО —
// окремий сервіс транскрипції не потрібен. Ключів може бути кілька через кому:
// ліміти рахуються на ключ, тож список ключів — це просто більший ліміт.
// Правила переходу між ними живуть у @/lib/ai/geminiKeys.
//
// Тут була ще запасна гілка на Claude (+ Whisper для аудіо). Вона не
// виконувалась жодного разу: ключа ANTHROPIC_API_KEY немає ні локально, ні в
// проді. Небезпечною її робило те, що на тексті вона мала пріоритет над
// Gemini — тобто поява ключа тихо перевела б безкоштовний провайдер на
// платний, без жодного рішення з чийогось боку.
import { NextResponse } from 'next/server';
import { authorizeOrgRequest, enforceRateLimit, getAdminDb } from '@/lib/server/firebaseAdmin';
import { organizationRollupTimeZone } from '@/lib/server/analyticsRollups';
import { commitAiCall, planLimitRefusalResponse, reserveAiCall } from '@/lib/server/planLimits';
import { readJsonBody, routeErrorResponse } from '@/lib/server/apiErrors';
import { organizationIdFromPath } from '@/lib/utils/uploadPaths.mjs';
import { dayKeyInTimeZone } from '@/lib/utils/timeZone.mjs';
import {
  classifyGeminiFailure,
  geminiFailureMessage,
  parseGeminiApiKeys,
  rotateKeys,
} from '@/lib/ai/geminiKeys';

export const maxDuration = 300;

// A hung upstream must surface as "Gemini не відповів", not as the platform
// killing the function at maxDuration and returning its own opaque 500 — which
// is one of the ways this route came to report «Internal Server Error».
const GEMINI_TIMEOUT_MS = 120_000;
// One retry, then the next key. More than that just delays the honest answer.
const OVERLOAD_RETRY_DELAY_MS = 1_500;

// ~14МБ бінарного аудіо ≈ 19МБ base64 — під ліміт inline-запиту Gemini (20МБ).
const MAX_AUDIO_BYTES = 14 * 1024 * 1024;

const GEMINI_SCHEMA = {
  type: 'OBJECT',
  required: ['summary', 'decisions', 'tasks'],
  properties: {
    summary: { type: 'STRING' },
    decisions: { type: 'ARRAY', items: { type: 'STRING' } },
    tasks: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        required: ['title', 'description', 'priority'],
        properties: {
          title: { type: 'STRING' },
          description: { type: 'STRING' },
          assigneeName: { type: 'STRING', nullable: true },
          priority: { type: 'STRING', enum: ['blocker', 'high', 'medium', 'low'] },
          dueDate: { type: 'STRING', nullable: true },
        },
      },
    },
  },
};

// A project may be called anything, and whatever it is called lands inside the
// instructions. Bounded so a name cannot become a second prompt.
const MAX_PROJECT_NAME = 100;

function buildPrompt({ members, projectName, hasAudio, timeZone }) {
  // Kyiv, not Greenwich. `toISOString()` here meant that after 21:00 local the
  // model was told yesterday's date, so «до п'ятниці» resolved a day early —
  // for a feature whose whole output is deadlines.
  const today = dayKeyInTimeZone(new Date(), timeZone);
  return [
    'Ти асистент проєктного менеджера у таск-трекері QuickTeam.',
    hasAudio
      ? 'До запиту прикріплено аудіозапис робочого дзвінка команди. Уважно прослухай його.'
      : 'Нижче — транскрипт робочого дзвінка команди.',
    'Витягни з дзвінка:',
    '1) стисле саммарі українською (3-6 речень);',
    '2) ухвалені рішення;',
    '3) конкретні задачі (action items).',
    'Задачі формулюй так, щоб їх можна було одразу створити в трекері: дієслово + результат.',
    'Не вигадуй задач, яких у розмові немає. Обʼєднуй дублікати.',
    `Сьогоднішня дата: ${today}. Відносні дати ("до п'ятниці") переводь у формат YYYY-MM-DD у полі dueDate; якщо дедлайн не озвучено — dueDate: null.`,
    members.length
      ? `Учасники команди (для assigneeName використовуй ТОЧНО ці імена, інакше null): ${members.join(', ')}.`
      : 'Список учасників невідомий — assigneeName завжди null.',
    projectName ? `Проєкт: ${projectName}.` : '',
    'Відповідай українською.',
  ].filter(Boolean).join('\n');
}

// Our own storage, and our own caller's corner of it.
//
// The host check alone stops the request going anywhere but Cloudinary, which
// is what it was written for. It does not stop it going to a *different
// workspace's* recording, because every organization shares one cloud: a member
// of A holding a URL from B could have the model listen to B's meeting and hand
// back the summary. `/api/upload/sign` already refuses to sign into another
// tenant's folder for exactly this reason — the same path rule answers the same
// question here, on the way in rather than on the way out.
//
// The folder is the middle of a delivery URL:
//   https://res.cloudinary.com/{cloud}/video/upload/v1234/quickteam/organizations/{orgId}/ai-calls/{id}.m4a
function audioStoragePath(url, cloud) {
  if (typeof url !== 'string') return '';
  const prefix = `https://res.cloudinary.com/${cloud}/`;
  if (!url.startsWith(prefix)) return '';
  // …/{resource_type}/{delivery_type}/[v123/]{public_id}.{ext}
  const rest = url.slice(prefix.length).split(/[?#]/, 1)[0];
  const match = /^[a-z]+\/[a-z]+\/(?:v\d+\/)?(.+)$/.exec(rest);
  return match ? match[1].replace(/\.[A-Za-z0-9]+$/, '') : '';
}

function audioUrlAllowed(url, organizationId) {
  const cloud = process.env.CLOUDINARY_CLOUD_NAME;
  if (!cloud) return false;
  const path = audioStoragePath(url, cloud);
  return Boolean(path) && organizationIdFromPath(path) === organizationId;
}

const ALLOWED_AUDIO_MIME_TYPES = new Set([
  'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/wav',
  'audio/x-wav', 'audio/webm', 'audio/ogg', 'audio/aac', 'audio/flac',
  'video/webm', 'video/mp4',
]);

async function fetchAudio(audioUrl, declaredMimeType = '') {
  let response;
  try {
    response = await fetch(audioUrl, { signal: AbortSignal.timeout(60_000) });
  } catch {
    // Cloudinary being slow or unreachable is a reportable condition, not the
    // unhandled throw that used to reach the caller as «Internal Server Error».
    return { error: 'Не вдалося завантажити аудіофайл зі сховища' };
  }
  if (!response.ok) return { error: 'Не вдалося завантажити аудіофайл' };
  // Ask before pulling. The size check used to run on the buffer, which meant
  // the whole file was already in memory by the time it was found to be too
  // large — a big enough one takes the function down instead of producing the
  // sentence below, and the caller sees the platform's 500 rather than an
  // answer they can act on.
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_AUDIO_BYTES) {
    return { error: 'Аудіо завелике для аналізу (ліміт ~14 МБ). Вставте текст транскрипту.' };
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  // Still checked afterwards: a chunked response carries no length, so the
  // header is the cheap path and this is the one that cannot be skipped.
  if (buffer.length > MAX_AUDIO_BYTES) {
    return { error: 'Аудіо завелике для аналізу (ліміт ~14 МБ). Вставте текст транскрипту.' };
  }
  const responseMimeType = response.headers.get('content-type')?.split(';')[0] || '';
  const safeDeclaredMimeType = ALLOWED_AUDIO_MIME_TYPES.has(declaredMimeType) ? declaredMimeType : '';
  const mimeType = ALLOWED_AUDIO_MIME_TYPES.has(responseMimeType)
    ? responseMimeType
    : safeDeclaredMimeType || 'audio/mpeg';
  return { buffer, mimeType };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// gemini-flash-latest — аліас на актуальну flash-модель (перевірено: 2.5-flash
// цьому ключу вже недоступна, "no longer available to new users").
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';

async function callGemini({ apiKey, body }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      },
    );
    if (response.ok) return { status: response.status, data: await response.json() };
    return { status: response.status, detail: (await response.text()).slice(0, 500) };
  } catch (error) {
    // A network failure or the abort above. Status 0 means "never got an
    // answer", which the next key may well do better on.
    return { status: 0, detail: error.name === 'AbortError' ? 'timeout' : String(error.message || error) };
  } finally {
    clearTimeout(timeout);
  }
}

async function analyzeWithGemini({ prompt, transcript, audio, apiKeys }) {
  const parts = [{ text: prompt }];
  if (transcript) parts.push({ text: `<transcript>\n${transcript}\n</transcript>` });
  if (audio) parts.push({ inline_data: { mime_type: audio.mimeType, data: audio.buffer.toString('base64') } });
  const body = JSON.stringify({
    contents: [{ role: 'user', parts }],
    generationConfig: {
      response_mime_type: 'application/json',
      response_schema: GEMINI_SCHEMA,
    },
  });

  let lastStatus = 0;
  for (const apiKey of rotateKeys(apiKeys)) {
    let attempt = await callGemini({ apiKey, body });
    if (!attempt.data && classifyGeminiFailure(attempt.status) === 'retry') {
      await sleep(OVERLOAD_RETRY_DELAY_MS);
      attempt = await callGemini({ apiKey, body });
    }

    if (attempt.data) {
      const text = attempt.data?.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('') || '';
      if (!text) return { error: 'Gemini не повернув результат', status: 502 };
      try {
        return { extraction: JSON.parse(text) };
      } catch {
        return { error: 'Не вдалося розібрати відповідь Gemini', status: 502 };
      }
    }

    lastStatus = attempt.status;
    console.error('[ai/call-to-tasks] gemini rejected request', {
      status: attempt.status,
      // The key itself never reaches the log; its position does, which is all
      // that is needed to tell "one key is dead" from "the quota is gone".
      keyIndex: apiKeys.indexOf(apiKey),
      detail: attempt.detail,
    });
    // A malformed request fails identically on every key, so stop asking.
    if (classifyGeminiFailure(attempt.status) === 'fail' && attempt.status !== 0) break;
  }

  return {
    error: geminiFailureMessage(lastStatus, apiKeys.length),
    status: lastStatus === 429 ? 429 : 502,
  };
}

export async function POST(request) {
  try {
    const { organizationId, transcript, audioUrl, audioMimeType, memberNames = [], projectName } = await readJsonBody(request);
    const authorization = await authorizeOrgRequest(request, organizationId, ['owner', 'admin', 'member']);
    if (authorization.error) {
      return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    }
    if (!(await enforceRateLimit('ai-call-to-tasks', authorization.user.uid, 10, 3600))) {
      return NextResponse.json({ error: 'Забагато запитів — спробуйте за годину' }, { status: 429 });
    }

    const apiKeys = parseGeminiApiKeys(process.env);
    if (!apiKeys.length) {
      return NextResponse.json({ error: 'ШІ-аналіз не налаштовано (немає GEMINI_API_KEY)' }, { status: 503 });
    }

    const text = typeof transcript === 'string' ? transcript.trim() : '';
    let audio = null;
    if (!text && audioUrl) {
      if (!audioUrlAllowed(audioUrl, organizationId)) {
        return NextResponse.json({ error: 'Недозволений URL аудіо' }, { status: 400 });
      }
      const fetched = await fetchAudio(audioUrl, audioMimeType);
      if (fetched.error) return NextResponse.json({ error: fetched.error }, { status: 400 });
      audio = fetched;
    }
    if (!text && !audio) {
      return NextResponse.json({ error: 'Додайте запис дзвінка або текст транскрипту' }, { status: 400 });
    }
    if (text && text.length < 40) {
      return NextResponse.json({ error: 'Замалий транскрипт — нема з чого витягати задачі' }, { status: 400 });
    }

    const members = Array.isArray(memberNames)
      ? memberNames.filter(name => typeof name === 'string').slice(0, 50)
      : [];
    // The same cached reader the time rollups use, rather than a second copy of
    // "which timezone is this organization in" — it holds the answer for the
    // life of the process, so this costs no read of its own.
    const timeZone = await organizationRollupTimeZone(getAdminDb(), organizationId);

    // «AI Аудіо-завдання / міс» is a ceiling on the price list, and until now it
    // was only that. A workspace on Free has none at all, one on Lite has ten a
    // month — asked before the model is called, so a workspace at its ceiling
    // never spends one of our Gemini quota either.
    const allowance = await reserveAiCall(getAdminDb(), organizationId, timeZone);
    const refusal = planLimitRefusalResponse(allowance.plan, 'aiCalls', allowance.used);
    if (refusal) return refusal;

    const prompt = buildPrompt({
      members,
      projectName: typeof projectName === 'string' ? projectName.trim().slice(0, MAX_PROJECT_NAME) : '',
      hasAudio: Boolean(audio),
      timeZone,
    });

    // Gemini слухає аудіо напряму, тож обидва шляхи ведуть в один виклик.
    const result = audio
      ? await analyzeWithGemini({ prompt, audio, apiKeys })
      : await analyzeWithGemini({ prompt, transcript: text.slice(0, 300000), apiKeys });

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status || 502 });
    }
    const extraction = result.extraction;

    // Counted only now. A call Gemini dropped, timed out on or refused is not
    // one of somebody's ten — they got nothing for it.
    await commitAiCall(getAdminDb(), organizationId, allowance.period);

    return NextResponse.json({
      summary: extraction.summary || '',
      decisions: Array.isArray(extraction.decisions) ? extraction.decisions : [],
      tasks: (Array.isArray(extraction.tasks) ? extraction.tasks : []).map(task => ({
        title: task.title || '',
        description: task.description || '',
        assigneeName: task.assigneeName || null,
        priority: ['blocker', 'high', 'medium', 'low'].includes(task.priority) ? task.priority : 'medium',
        dueDate: task.dueDate || null,
      })),
    });
  } catch (error) {
    return routeErrorResponse(error, { context: 'AI call-to-tasks', fallbackMessage: 'Internal Server Error' });
  }
}
