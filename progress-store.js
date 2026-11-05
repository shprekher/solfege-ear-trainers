/* Local-only history. Storage version is independent of application releases. */
(() => {
  'use strict';
  const DB_NAME = 'solfege-ear-trainers-progress', DB_VERSION = 2, FORMAT_VERSION = 1;
  const EXERCISES = Object.freeze({
    'half-step': '0 · Выше или ниже?',
    'count-notes': '1 · Сколько нот звучит?',
    'shifted-voice': '2 · Какой голос изменился?',
    'note-names': '3 · Русские и английские ноты',
    'note-reading': '4 · Чтение нот',
    intervals: '5 · Какой интервал?'
  });
  const own = (o, key) => Object.prototype.hasOwnProperty.call(o, key);
  const dayKey = (date = new Date()) => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  const uid = () => crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16).padStart(8, '0')).join('');
  const modeKey = mode => JSON.stringify(Object.keys(mode).sort().map(key => [key, mode[key]]));
  const ordered = records => [...records].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  function validateRecord(value) {
    const text = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;
    if (!value || typeof value !== 'object' || !text(value.id, 100) || !text(value.sessionId, 100) ||
        !own(EXERCISES, value.exercise) || typeof value.correct !== 'boolean' ||
        !Number.isSafeInteger(value.at) || value.at < 946684800000 || value.at > 4133980800000 ||
        !text(value.day, 10) || !/^\d{4}-\d{2}-\d{2}$/.test(value.day) ||
        !text(value.task, 120) || !text(value.expected, 160) || !text(value.actual, 160) ||
        !value.mode || typeof value.mode !== 'object' || Array.isArray(value.mode)) {
      throw new Error('Некорректная запись ответа. Импорт отменён.');
    }
    const date = new Date(value.day + 'T00:00:00Z');
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value.day ||
        Math.abs(Date.parse(value.day + 'T12:00:00Z') - value.at) > 36 * 3600000) {
      throw new Error('Некорректная дата ответа. Импорт отменён.');
    }
    const mode = {};
    const allowed = ['timbre', 'voices', 'clef', 'language', 'direction', 'intervalType'];
    const entries = Object.entries(value.mode);
    if (!entries.length || entries.length > allowed.length) throw new Error('Некорректный режим задания.');
    for (const [key, val] of entries) {
      if (!allowed.includes(key) || !(text(val, 40) || (Number.isInteger(val) && val >= 1 && val <= 4))) throw new Error('Некорректный режим задания.');
      mode[key] = val;
    }
    return { id: value.id, sessionId: value.sessionId, exercise: value.exercise, at: value.at, day: value.day,
      correct: value.correct, task: value.task, mode, expected: value.expected, actual: value.actual };
  }
  function createStore(name = DB_NAME) {
    let connection = null;
    function open() {
      if (connection) return connection;
      connection = new Promise((resolve, reject) => {
        let request;
        try { request = indexedDB.open(name, DB_VERSION); } catch (error) { reject(error); return; }
        request.onupgradeneeded = event => {
          const db = request.result, tx = request.transaction;
          // Additive migrations only. Never delete a database to recover from an error.
          if (event.oldVersion < 1) {
            const answers = db.createObjectStore('answers', { keyPath: 'id' });
            answers.createIndex('byExercise', 'exercise');
            answers.createIndex('byTime', 'at');
          }
          if (event.oldVersion < 2) tx.objectStore('answers').createIndex('bySession', 'sessionId');
        };
        request.onerror = () => reject(request.error);
        request.onblocked = () => {
          window.dispatchEvent(new CustomEvent('progress-blocked'));
        };
        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => { db.close(); connection = null; };
          db.onclose = () => { connection = null; };
          resolve(db);
        };
      });
      connection.catch(() => { connection = null; });
      return connection;
    }
    async function transaction(mode, run) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('answers', mode), store = tx.objectStore('answers');
        let result, failure;
        tx.oncomplete = () => resolve(result);
        tx.onabort = () => reject(failure || tx.error || new Error('Запись отменена.'));
        tx.onerror = () => {}; // onabort handles request failures, including quota exhaustion.
        try { run(store, value => { result = value; }, error => { failure = error; tx.abort(); }); }
        catch (error) { failure = error; tx.abort(); }
      });
    }
    const list = () => transaction('readonly', (store, done) => {
      const request = store.getAll();
      request.onsuccess = () => done(ordered(request.result));
    });
    const append = record => {
      const safe = validateRecord(record);
      return transaction('readwrite', store => { store.add(safe); });
    };
    async function importJSON(input) {
      if (typeof input !== 'string' || input.length > 20 * 1024 * 1024) throw new Error('Файл должен быть JSON размером не более 20 МБ.');
      let data;
      try { data = JSON.parse(input); } catch { throw new Error('Не удалось прочитать JSON. Данные не изменены.'); }
      if (!data || data.app !== 'solfege-ear-trainers' || data.formatVersion !== FORMAT_VERSION || !Array.isArray(data.answers) || data.answers.length > 100000) {
        throw new Error('Неподдерживаемый формат или версия файла. Данные не изменены.');
      }
      const unique = new Map();
      const same = (a, b) => JSON.stringify({ ...a, mode: modeKey(a.mode) }) === JSON.stringify({ ...b, mode: modeKey(b.mode) });
      for (const value of data.answers) {
        const record = validateRecord(value), previous = unique.get(record.id);
        if (previous && !same(previous, record)) throw new Error('В файле конфликтуют идентификаторы ответов.');
        unique.set(record.id, record);
      }
      return transaction('readwrite', (store, done, abort) => {
        let added = 0;
        done({ added: 0, skipped: data.answers.length });
        for (const record of unique.values()) {
          const request = store.get(record.id);
          request.onsuccess = () => {
            if (request.result) {
              let existing;
              try { existing = validateRecord(request.result); } catch (error) { abort(error); return; }
              if (!same(existing, record)) { abort(new Error('Ответ с таким идентификатором уже существует и отличается. Импорт отменён.')); return; }
            } else {
              store.add(record);
              added++;
            }
            done({ added, skipped: data.answers.length - added });
          };
        }
      });
    }
    return {
      list, append, importJSON,
      async exportJSON() { return JSON.stringify({ app: 'solfege-ear-trainers', formatVersion: FORMAT_VERSION, exportedAt: new Date().toISOString(), answers: await list() }, null, 2); },
      clear: () => transaction('readwrite', store => { store.clear(); }),
      async close() { if (connection) (await connection).close(); connection = null; }
    };
  }
  function summary(records, now = new Date()) {
    const answers = ordered(records), days = [...new Set(answers.map(a => a.day))].sort();
    const ordinal = day => Math.floor(Date.parse(day + 'T00:00:00Z') / 86400000);
    let bestDays = 0, runDays = 0, previous = null, bestRun = 0;
    const runs = new Map();
    for (const day of days) {
      const n = ordinal(day);
      runDays = previous === n - 1 ? runDays + 1 : 1;
      bestDays = Math.max(bestDays, runDays); previous = n;
    }
    const daySet = new Set(days.map(ordinal)), today = ordinal(dayKey(now));
    let currentDays = 0, cursor = daySet.has(today) ? today : today - 1;
    while (daySet.has(cursor--)) currentDays++;
    for (const a of answers) {
      const key = JSON.stringify([a.exercise, a.sessionId, modeKey(a.mode)]);
      const run = a.correct ? (runs.get(key) || 0) + 1 : 0;
      runs.set(key, run); bestRun = Math.max(bestRun, run);
    }
    const recent = answers.slice(-30), correct = answers.filter(a => a.correct).length;
    return { answers: answers.length, correct, sessions: new Set(answers.map(a => a.exercise + ':' + a.sessionId)).size,
      days: days.length, currentDays, bestDays, bestRun, recentCount: recent.length,
      recentAccuracy: recent.length ? Math.round(recent.filter(a => a.correct).length / recent.length * 100) : null };
  }
  const store = createStore();
  let warningShown = false;
  function warn() {
    if (warningShown) return;
    warningShown = true;
    const show = () => {
      const el = document.createElement('p');
      el.setAttribute('role', 'status');
      el.textContent = 'История не сохраняется: браузер не разрешил доступ к локальному хранилищу. Проверьте настройки или свободное место.';
      el.style.cssText = 'position:fixed;bottom:8px;left:8px;right:8px;z-index:100;padding:12px;border:1px solid #9a7474;border-radius:10px;background:#241b22;color:#ffdddd;font:12px/1.4 system-ui';
      document.body.append(el);
    };
    if (document.body) show(); else document.addEventListener('DOMContentLoaded', show, { once: true });
  }
  function tracker(exercise) {
    let sessionId = null, lastAt = 0;
    return {
      reset() { sessionId = null; lastAt = 0; },
      record(data) {
        // Never await storage from exercise/audio code. Capture the answer now, not at unload.
        try {
          const at = Date.now();
          if (!sessionId || at - lastAt > 30 * 60000) sessionId = uid();
          lastAt = at;
          const record = { ...data, id: uid(), exercise, sessionId, at, day: dayKey(new Date(at)) };
          return store.append(record).catch(warn);
        } catch { warn(); return Promise.resolve(); }
      }
    };
  }
  window.SolfegeProgress = Object.freeze({ store, tracker, summary, modeKey, ordered, dayKey, EXERCISES, createStore, DB_VERSION });
})();
