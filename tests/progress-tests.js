(async () => {
  'use strict';
  const P = window.SolfegeProgress, results = [], name = 'solfege-progress-test-' + crypto.randomUUID();
  const store = P.createStore(name);
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const rejects = async fn => { let failed = false; try { await fn(); } catch { failed = true; } assert(failed, 'Ожидалась ошибка'); };
  const record = (id, options = {}) => ({ id, exercise: 'intervals', sessionId: 'session-1', at: Date.parse('2026-03-28T12:00:00Z'), day: '2026-03-28', correct: true, mode: { timbre: 'piano', intervalType: 'melodic' }, task: '1:up', expected: 'малая секунда', actual: 'малая секунда', ...options });
  const json = answers => JSON.stringify({ app: 'solfege-ear-trainers', formatVersion: 1, answers });
  const test = async (title, fn) => { try { await fn(); results.push({ title, ok: true }); } catch (error) { results.push({ title, ok: false, error: error.message }); } };
  await test('Сохранение и повторное открытие базы', async () => {
    await store.append(record('first')); await store.close();
    assert((await store.list()).length === 1, 'Ответ потерян после открытия');
  });
  await test('Экспорт, импорт и идемпотентность', async () => {
    const exported = await store.exportJSON(); await store.clear();
    assert((await store.importJSON(exported)).added === 1, 'Импорт не восстановил ответ');
    assert((await store.importJSON(exported)).added === 0, 'Появились дубликаты');
  });
  await test('Некорректный JSON и новая версия не меняют данные', async () => {
    await rejects(() => store.importJSON('{'));
    await rejects(() => store.importJSON(JSON.stringify({ app: 'solfege-ear-trainers', formatVersion: 999, answers: [] })));
    await rejects(() => store.importJSON(json([record('valid'), record('invalid', { correct: 'yes' })])));
    await rejects(() => store.importJSON(json([record('bad-day', { day: '2026-02-31' })])));
    assert((await store.list()).length === 1, 'Частичный импорт изменил историю');
  });
  await test('Конфликт идентификаторов откатывает всю транзакцию', async () => {
    await rejects(() => store.importJSON(json([record('before-conflict'), record('first', { correct: false })])));
    assert((await store.list()).length === 1, 'Не откатился ответ перед конфликтом');
  });
  await test('Параллельные импорты не создают дубликаты', async () => {
    const imports = await Promise.all([store.importJSON(json([record('parallel')])), store.importJSON(json([record('parallel')]))]);
    assert(imports.reduce((n, r) => n + r.added, 0) === 1, 'Дубликат в параллельных транзакциях');
  });
  await test('Последние 30 ответов, а не пожизненная точность', async () => {
    const rows = Array.from({ length: 50 }, (_, i) => record('r-' + i, { at: Date.parse('2026-03-28T12:00:00Z') + i * 1000, correct: i < 20 }));
    assert(P.summary(rows).recentAccuracy === 0, 'Не используется окно из 30');
    assert(P.summary(rows).correct === 20, 'Неверно посчитаны правильные');
    assert(P.summary(rows.slice(0, 4)).recentCount === 4, 'Неверен неполный набор');
  });
  await test('Дни, серии, полночь и разные тренировки', async () => {
    const rows = [28, 29, 30].map(day => record('day-' + day, { at: Date.parse('2026-03-' + day + 'T12:00:00Z'), day: '2026-03-' + day, sessionId: 'session-' + day }));
    const s = P.summary(rows, new Date(2026, 2, 31, 10));
    assert(s.days === 3 && s.currentDays === 3 && s.bestDays === 3 && s.sessions === 3, 'Ошибка серии дней');
    assert(P.summary(rows, new Date(2026, 3, 1, 10)).currentDays === 0, 'Пропуск дня не обнуляет серию');
    rows[1].sessionId = rows[0].sessionId;
    assert(P.summary(rows).sessions === 2, 'Полночь искусственно разделяет тренировку');
  });
  await test('Сложности и тембры разделяются устойчивым ключом', async () => {
    assert(P.modeKey({ voices: 2, timbre: 'piano' }) === P.modeKey({ timbre: 'piano', voices: 2 }), 'Порядок свойств меняет режим');
    assert(P.modeKey({ voices: 2 }) !== P.modeKey({ voices: 3 }), 'Смешаны 2 и 3 голоса');
    assert(P.modeKey({ intervalType: 'melodic' }) !== P.modeKey({ intervalType: 'harmonic' }), 'Смешаны интервалы');
  });
  await test('Миграция версии 1 → 2 сохраняет ответы и добавляет индекс', async () => {
    const oldName = name + '-migration';
    await new Promise((resolve, reject) => {
      const request = indexedDB.open(oldName, 1);
      request.onupgradeneeded = () => { const s = request.result.createObjectStore('answers', { keyPath: 'id' }); s.createIndex('byExercise', 'exercise'); s.createIndex('byTime', 'at'); s.add(record('legacy')); };
      request.onerror = () => reject(request.error); request.onsuccess = () => { request.result.close(); resolve(); };
    });
    const migrated = P.createStore(oldName);
    try { assert((await migrated.list())[0].id === 'legacy', 'Миграция потеряла ответ'); }
    finally { await migrated.close(); }
    await new Promise((resolve, reject) => {
      const request = indexedDB.open(oldName, 2);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => { const db = request.result; const present = db.transaction('answers').objectStore('answers').indexNames.contains('bySession'); db.close(); present ? resolve() : reject(new Error('Нет индекса сессии')); };
    });
    await new Promise((resolve, reject) => { const request = indexedDB.deleteDatabase(oldName); request.onsuccess = resolve; request.onerror = () => reject(request.error); });
  });
  await test('Новая версия базы не вызывает сброс при запуске старого кода', async () => {
    const futureName = name + '-future';
    await new Promise((resolve, reject) => {
      const request = indexedDB.open(futureName, 3);
      request.onupgradeneeded = () => request.result.createObjectStore('answers', { keyPath: 'id' }).add(record('future'));
      request.onerror = () => reject(request.error); request.onsuccess = () => { request.result.close(); resolve(); };
    });
    await rejects(() => P.createStore(futureName).list());
    await new Promise((resolve, reject) => {
      const request = indexedDB.open(futureName, 3);
      request.onerror = () => reject(request.error); request.onsuccess = () => {
        const db = request.result, get = db.transaction('answers').objectStore('answers').get('future');
        get.onsuccess = () => { const exists = !!get.result; db.close(); exists ? resolve() : reject(new Error('Новая база потеряла данные')); };
      };
    });
    await new Promise(resolve => { const request = indexedDB.deleteDatabase(futureName); request.onsuccess = resolve; });
  });
  await test('Перерыв, сброс и новый запуск разделяют тренировки; отказ базы не выбрасывает ошибку', async () => {
    const sessionName = name + '-sessions', frame = document.createElement('iframe');
    const source = (await (await fetch('../progress-store.js')).text()).replace("DB_NAME = 'solfege-ear-trainers-progress'", 'DB_NAME = ' + JSON.stringify(sessionName));
    const loaded = new Promise(resolve => { frame.onload = resolve; }); frame.srcdoc = '<!doctype html><body><script>' + source + '</script>'; document.body.append(frame); await loaded;
    const win = frame.contentWindow, api = win.SolfegeProgress;
    try {
      let clock = Date.now(); win.Date.now = () => clock;
      const data = { correct: true, mode: { timbre: 'piano' }, task: 'up', expected: 'Выше', actual: 'Выше' };
      const tracker = api.tracker('half-step');
      await tracker.record(data); clock += 5 * 60000; await tracker.record(data);
      clock += 31 * 60000; await tracker.record(data);
      tracker.reset(); await tracker.record(data); await api.tracker('half-step').record(data);
      const rows = await api.store.list();
      assert(rows.length === 5 && P.summary(rows).sessions === 4, 'Неверные границы тренировок');
      assert(rows[0].sessionId === rows[1].sessionId, 'Обычная пауза разделила тренировку');
      await api.store.close();
      Object.defineProperty(win, 'indexedDB', { value: { open() { throw new win.DOMException('test', 'QuotaExceededError'); } } });
      await tracker.record(data);
      assert(frame.contentDocument.querySelector('[role="status"]'), 'Не показано предупреждение об отказе хранилища');
    } finally {
      await api.store.close(); frame.remove();
      await new Promise(resolve => { const request = indexedDB.deleteDatabase(sessionName); request.onsuccess = resolve; request.onerror = resolve; });
    }
  });
  await test('Удаление действительно очищает хранилище', async () => { await store.clear(); await store.close(); assert((await store.list()).length === 0, 'История осталась'); });
  await store.close();
  await new Promise(resolve => { const request = indexedDB.deleteDatabase(name); request.onsuccess = resolve; request.onerror = resolve; });
  window.__progressTestResults = results;
  document.getElementById('results').textContent = results.map(r => (r.ok ? 'OK ' : 'ОШИБКА ') + r.title + (r.error ? ': ' + r.error : '')).join('\n');
})();
