/* Dictations use a separate database. Existing trainer history is never modified. */
(() => {
  'use strict';
  const MAGIC = new TextEncoder().encode('SOLFEGE-DICTATION\n'), MAX_FILE = 50_000_000;
  const encoder = new TextEncoder(), clone = value => JSON.parse(JSON.stringify(value));
  const id = value => typeof value === 'string' && value.length > 0 && value.length <= 200;
  const text = (value, max = 65536) => typeof value === 'string' && value.length <= max;
  const key = (collection, audio) => JSON.stringify([collection, audio]);
  const fail = message => { throw new Error(message); };
  const hash = async blob => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), n => n.toString(16).padStart(2, '0')).join('');
  function validateState(value, taskId) {
    const number = (n, max) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= max;
    if (!value || value.id !== taskId || typeof value.done !== 'boolean' || !number(value.position, 86400) || !number(value.rate, 2) || value.rate < .5 ||
        !(value.loopA === null || number(value.loopA, 86400)) || !(value.loopB === null || number(value.loopB, 86400)) || typeof value.loopEnabled !== 'boolean') fail('Некорректная позиция или отметка задания.');
    if (value.loopEnabled && (value.loopA === null || value.loopB === null || value.loopB - value.loopA < .1)) fail('Некорректные границы A–B.');
    return { id: taskId, done: value.done, position: value.position, rate: value.rate, loopA: value.loopA, loopB: value.loopB, loopEnabled: value.loopEnabled };
  }
  async function readBundle(file) {
    if (!window.crypto?.subtle) fail('Для проверки набора откройте сайт по HTTPS или через localhost.');
    if (!file || file.size > MAX_FILE || file.size < MAGIC.length + 4) fail('Нужен файл .solfege размером не более 50 МБ.');
    const head = new Uint8Array(await file.slice(0, MAGIC.length + 4).arrayBuffer());
    if (!MAGIC.every((v, i) => head[i] === v)) fail('Это не набор диктантов .solfege. ZIP и JSON сюда не подходят.');
    const size = new DataView(head.buffer).getUint32(MAGIC.length, true), start = MAGIC.length + 4;
    if (size > 4 * 1024 * 1024 || start + size > file.size) fail('Повреждён заголовок набора.');
    let manifest;
    try { manifest = JSON.parse(await file.slice(start, start + size).text()); } catch { fail('Повреждён список заданий.'); }
    const c = manifest.collection;
    if (manifest.app !== 'solfege-dictations' || manifest.version !== 1) fail('Неподдерживаемая версия набора. Данные не изменены.');
    if (!c || !id(c.id) || !text(c.description, 4096) || !text(c.day, 10) || !/^\d{4}-\d{2}-\d{2}$/.test(c.day) || !text(c.receivedAt, 64) || !Number.isFinite(Date.parse(c.receivedAt)) ||
        !Number.isInteger(manifest.parts) || manifest.parts < 1 || manifest.parts > 10000 || !Number.isInteger(manifest.part) || manifest.part < 1 || manifest.part > manifest.parts ||
        !Array.isArray(manifest.tasks) || !manifest.tasks.length || manifest.tasks.length > 10000 || !Array.isArray(manifest.assets) || manifest.assets.length > 10000) fail('Некорректная структура занятия.');
    if (!Number.isFinite(Date.parse(c.day + 'T00:00:00Z')) || new Date(c.day + 'T00:00:00Z').toISOString().slice(0, 10) !== c.day) fail('Некорректная дата занятия.');
    const collection = { id: c.id, day: c.day, receivedAt: c.receivedAt, description: c.description, originalDescription: c.description, parts: manifest.parts };
    if (c.lastTaskId !== undefined) { if (!id(c.lastTaskId)) fail('Некорректная ссылка на последнее задание.'); collection.lastTaskId = c.lastTaskId; }
    if (c.search !== undefined) { if (!text(c.search, 1024)) fail('Некорректный сохранённый поиск.'); collection.search = c.search; }
    const assets = new Map(); let offset = start + size;
    for (const a of manifest.assets) {
      if (!a || !id(a.id) || assets.has(a.id) || !Number.isInteger(a.size) || a.size <= 0 || a.size > 20_000_000 || !/^[a-f0-9]{64}$/.test(a.sha256) ||
          !/^audio\/[a-z0-9.+-]+$/i.test(a.mime) || !text(a.originalName || '', 1024) || offset + a.size > file.size) fail('Повреждён список аудиозаписей.');
      const blob = file.slice(offset, offset + a.size, a.mime); offset += a.size;
      if (await hash(blob) !== a.sha256) fail('Контрольная сумма аудио не совпала. Скачайте файл ещё раз.');
      assets.set(a.id, { id: key(c.id, a.id), audioId: a.id, collectionId: c.id, blob, size: a.size, mime: a.mime, sha256: a.sha256, originalName: a.originalName || '' });
    }
    if (offset !== file.size) fail('Длина набора не совпала с заголовком.');
    const tasks = [], ids = new Set(), used = new Set();
    for (const t of manifest.tasks) {
      if (!t || !id(t.id) || ids.has(t.id) || !Number.isSafeInteger(t.order) || t.order < 0 || !text(t.title, 4096) || !text(t.text) ||
          !(t.audioId === null || assets.has(t.audioId)) || !text(t.originalName || '', 1024) || !text(t.caption || '') ||
          !Number.isFinite(t.duration) || t.duration < 0 || t.duration > 86400 || JSON.stringify(t.textSource || null).length > 16000 || JSON.stringify(t.audioSource || null).length > 16000) fail('Некорректное задание или отсутствующая запись.');
      ids.add(t.id); if (t.audioId) used.add(t.audioId);
      tasks.push({ id: t.id, collectionId: c.id, part: manifest.part, order: t.order, title: t.title, text: t.text, textSource: clone(t.textSource || null),
        audioSource: clone(t.audioSource || null), audioId: t.audioId, duration: t.duration, originalName: t.originalName || '', caption: t.caption || '' });
    }
    if (used.size !== assets.size) fail('В наборе есть аудио без задания.');
    const states = [];
    if (manifest.states !== undefined) {
      if (!Array.isArray(manifest.states) || manifest.states.length > tasks.length) fail('Некорректные отметки заданий.');
      const seen = new Set();
      for (const state of manifest.states) { if (!ids.has(state.id) || seen.has(state.id)) fail('Некорректные отметки заданий.'); seen.add(state.id); states.push(validateState(state, state.id)); }
    }
    return { collection, part: manifest.part, tasks, assets: [...assets.values()], states };
  }
  function createStore(name = 'solfege-dictations') {
    let connection;
    function open() {
      if (connection) return connection;
      connection = new Promise((resolve, reject) => {
        const request = indexedDB.open(name, 1);
        request.onupgradeneeded = () => {
          // Version 1. Future migrations must be additive; never delete/recreate on error.
          const db = request.result;
          db.createObjectStore('collections', { keyPath: 'id' });
          for (const name of ['tasks', 'audio']) db.createObjectStore(name, { keyPath: 'id' }).createIndex('collectionId', 'collectionId');
          db.createObjectStore('states', { keyPath: 'id' });
        };
        request.onerror = () => reject(request.error);
        request.onblocked = () => window.dispatchEvent(new CustomEvent('dictation-blocked'));
        request.onsuccess = () => { const db = request.result; db.onversionchange = () => { db.close(); connection = null; }; db.onclose = () => { connection = null; }; resolve(db); };
      });
      connection.catch(() => { connection = null; }); return connection;
    }
    async function tx(names, mode, fn) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(names, mode); let result, error;
        transaction.oncomplete = () => resolve(result);
        transaction.onabort = () => reject(error || transaction.error || new Error('Операция отменена.'));
        transaction.onerror = () => {};
        try { fn(transaction, value => { result = value; }, reason => { error = reason; transaction.abort(); }); }
        catch (reason) { error = reason; transaction.abort(); }
      });
    }
    const get = (store, id) => tx([store], 'readonly', (t, done) => { const r = t.objectStore(store).get(id); r.onsuccess = () => done(r.result); });
    const all = (store, collection) => tx([store], 'readonly', (t, done) => {
      const s = t.objectStore(store), r = collection ? s.index('collectionId').getAll(collection) : s.getAll(); r.onsuccess = () => done(r.result);
    });
    async function update(store, id, change) {
      return tx([store], 'readwrite', (t, done, abort) => { const s = t.objectStore(store), r = s.get(id); r.onsuccess = () => { try { const result = change(r.result); s.put(result); done(result); } catch (error) { abort(error); } }; });
    }
    async function importFile(file) {
      const bundle = await readBundle(file); // Fully validate/hash before opening a write transaction.
      return tx(['collections', 'tasks', 'audio', 'states'], 'readwrite', (t, done, abort) => {
        let added = 0;
        const c = t.objectStore('collections'), r = c.get(bundle.collection.id);
        r.onsuccess = () => {
          const old = r.result;
          if (old && (old.day !== bundle.collection.day || old.receivedAt !== bundle.collection.receivedAt || old.parts !== bundle.collection.parts)) { abort(new Error('Конфликт версий занятия. Импорт не изменил данные.')); return; }
          const receivedParts = [...new Set([...(old?.receivedParts || []), bundle.part])].sort((a, b) => a - b);
          c.put({ ...bundle.collection, ...old, receivedParts });
        };
        for (const task of bundle.tasks) {
          const s = t.objectStore('tasks'), r = s.get(task.id);
          r.onsuccess = () => {
            if (r.result && JSON.stringify(r.result) !== JSON.stringify(task)) { abort(new Error('Задание с таким ID уже существует и отличается. Импорт отменён.')); return; }
            if (!r.result) { s.add(task); added++; } done({ added, total: bundle.tasks.length, collectionId: bundle.collection.id });
          };
        }
        for (const a of bundle.assets) {
          const s = t.objectStore('audio'), r = s.get(a.id);
          r.onsuccess = () => { if (r.result && r.result.sha256 !== a.sha256) { abort(new Error('Конфликт аудиозаписей. Импорт отменён.')); return; } if (!r.result) s.add(a); };
        }
        for (const state of bundle.states) { const s = t.objectStore('states'), r = s.get(state.id); r.onsuccess = () => { if (!r.result) s.add(state); }; }
      });
    }
    return {
      importFile, collections: () => all('collections'), collection: id => get('collections', id),
      async tasks(id) { return (await all('tasks', id)).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)); },
      audio: (collection, audioId) => get('audio', key(collection, audioId)),
      async state(id) { return (await get('states', id)) || { id, done: false, position: 0, rate: 1, loopA: null, loopB: null, loopEnabled: false }; },
      states: () => all('states'),
      saveState: (id, patch) => update('states', id, old => validateState({ id, done: false, position: 0, rate: 1, loopA: null, loopB: null, loopEnabled: false, ...old, ...patch }, id)),
      saveCollection: (id, patch) => update('collections', id, old => { if (!old) fail('Занятие не найдено.'); const next = { ...old }; for (const k of ['description', 'lastTaskId', 'search', 'listScroll']) if (patch[k] !== undefined) next[k] = patch[k]; return next; }),
      async exportParts(id) {
        const c = await get('collections', id); if (!c) fail('Занятие не найдено.');
        const tasks = await all('tasks', id), assets = await all('audio', id), states = await all('states'), output = [];
        for (const part of c.receivedParts) {
          const group = tasks.filter(t => t.part === part).sort((a, b) => a.order - b.order), ids = new Set(group.map(t => t.id)), wanted = new Set(group.map(t => t.audioId));
          const included = assets.filter(a => wanted.has(a.audioId));
          const manifest = { app: 'solfege-dictations', version: 1, collection: { id: c.id, day: c.day, receivedAt: c.receivedAt, description: c.description, lastTaskId: c.lastTaskId, search: c.search },
            part, parts: c.parts, tasks: group.map(({ collectionId, part, ...t }) => t), assets: included.map(a => ({ id: a.audioId, size: a.size, mime: a.mime, sha256: a.sha256, originalName: a.originalName })), states: states.filter(s => ids.has(s.id)) };
          const header = encoder.encode(JSON.stringify(manifest)), length = new Uint8Array(4); new DataView(length.buffer).setUint32(0, header.length, true);
          output.push({ name: 'dictations-' + c.day + '-' + c.id.replace(/[^a-z0-9_-]/gi, '_').slice(0, 8) + '-' + part + '.solfege', blob: new Blob([MAGIC, length, header, ...included.map(a => a.blob)], { type: 'application/octet-stream' }) });
        }
        return output;
      },
      async remove(id) {
        return tx(['collections', 'tasks', 'audio', 'states'], 'readwrite', t => {
          t.objectStore('collections').delete(id);
          for (const name of ['tasks', 'audio']) { const s = t.objectStore(name), r = s.index('collectionId').openCursor(id); r.onsuccess = () => { const cursor = r.result; if (!cursor) return; if (name === 'tasks') t.objectStore('states').delete(cursor.value.id); cursor.delete(); cursor.continue(); }; }
        });
      },
      async close() { if (connection) (await connection).close(); connection = null; }
    };
  }
  const errorMessage = error => ({ QuotaExceededError: 'Недостаточно места. Импорт этой части отменён; уже сохранённые занятия не изменены. Экспортируйте резервную копию или освободите место.',
    VersionError: 'Нужна более новая версия сайта. Обновите страницу; данные не удалены.', SecurityError: 'Браузер запретил локальное хранилище. Проверьте настройки.' }[error.name] || (error instanceof DOMException ? 'Хранилище временно недоступно. Попробуйте обновить страницу.' : error.message) || 'Не удалось выполнить операцию.');
  window.Dictations = Object.freeze({ createStore, store: createStore(), readBundle, errorMessage });
})();
