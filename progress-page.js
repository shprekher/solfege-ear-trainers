(() => {
  'use strict';
  const P = window.SolfegeProgress, $ = id => document.getElementById(id);
  let answers = [], busy = false;
  const el = (tag, text, cls) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node; };
  const percent = rows => rows.length ? Math.round(rows.filter(a => a.correct).length / rows.length * 100) + '%' : '—';
  function status(text, error = false) { $('status').textContent = text; $('status').classList.toggle('error', error); }
  function modeLabel(mode, exercise) {
    const parts = [];
    if (mode.voices) parts.push(mode.voices + ' голоса');
    if (mode.clef) parts.push(mode.clef === 'bass' ? 'Басовый ключ' : 'Скрипичный ключ');
    if (mode.intervalType) parts.push(mode.intervalType === 'harmonic' ? 'Гармонический' : 'Мелодический');
    if (mode.direction) parts.push({ ru: 'Русское → английское', en: 'Английское → русское', both: 'Оба направления' }[mode.direction] || mode.direction);
    if (mode.language) parts.push({ ru: 'Ответы по-русски', en: 'Ответы по-английски', both: 'Оба языка' }[mode.language] || mode.language);
    if (mode.timbre) parts.push(mode.timbre === 'piano' ? 'Пианино' : 'Электронное');
    return parts.join(' · ');
  }
  function taskLabel(answer) {
    if (answer.exercise === 'half-step') return answer.task === 'up' ? 'Второй звук выше' : 'Второй звук ниже';
    if (answer.exercise === 'count-notes') return answer.expected + ' ноты';
    if (answer.exercise === 'shifted-voice') return answer.expected;
    if (answer.exercise === 'intervals') {
      const [distance, direction] = answer.task.split(':');
      const name = { 1: 'Малая секунда', 2: 'Большая секунда', 3: 'Малая терция', 4: 'Большая терция' }[distance] || answer.expected;
      return name + (direction === 'up' ? ' ↑' : direction === 'down' ? ' ↓' : ' · одновременно');
    }
    const [note, language] = answer.task.split(':');
    return answer.expected + (answer.exercise === 'note-reading' ? ' · MIDI ' + note : '') + ' · ' + (language === 'ru' ? (answer.exercise === 'note-names' ? 'рус. → англ.' : 'рус.') : (answer.exercise === 'note-names' ? 'англ. → рус.' : 'англ.'));
  }
  function table(headers, rows) {
    const wrap = el('div', undefined, 'scroll-table'), t = el('table'), head = el('thead'), tr = el('tr');
    for (const text of headers) { const th = el('th', text); th.scope = 'col'; tr.append(th); }
    head.append(tr); t.append(head);
    const body = el('tbody');
    for (const row of rows) { const tr = el('tr'); for (const text of row) tr.append(el('td', String(text))); body.append(tr); }
    t.append(body); wrap.append(t); return wrap;
  }
  function renderOverview() {
    const s = P.summary(answers);
    for (const key of ['sessions', 'answers', 'days', 'currentDays']) $(key).textContent = s[key];
    $('regularity').textContent = 'Рекорд регулярности: ' + s.bestDays + ' дн. подряд. Лучшая серия ответов в одном режиме тренировки: ' + s.bestRun + '.';
    $('milestone').textContent = s.bestDays >= 30 ? 'Личный рубеж: 30 дней подряд.' : s.bestDays >= 7 ? 'Личный рубеж: неделя занятий подряд. Следующий — 30 дней.' : s.bestDays >= 3 ? 'Личный рубеж: 3 дня подряд. Следующий — неделя.' : 'Первый рубеж регулярности — 3 дня занятий подряд. Достаточно хотя бы одного ответа в день.';
    const days = new Set(answers.map(a => a.day)), today = new Date();
    $('week').replaceChildren();
    for (let i = 6; i >= 0; i--) {
      const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i), key = P.dayKey(date), active = days.has(key);
      const badge = el('span', date.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric' }), 'day' + (active ? ' active' : ''));
      badge.title = key + (active ? ' · есть ответы' : ' · нет ответов'); $('week').append(badge);
    }
  }
  function renderModes() {
    const exercise = $('exercise').value, previous = $('mode').value, modes = new Map();
    for (const a of answers.filter(a => a.exercise === exercise)) modes.set(P.modeKey(a.mode), a.mode);
    $('mode').replaceChildren();
    for (const [key, mode] of modes) { const option = el('option', modeLabel(mode, exercise)); option.value = key; $('mode').append(option); }
    if (!modes.size) { const option = el('option', 'Пока нет ответов'); option.value = ''; $('mode').append(option); }
    $('mode').disabled = !modes.size;
    $('mode').value = modes.has(previous) ? previous : [...modes.keys()].at(-1) || '';
    renderExercise();
  }
  function renderTrend(rows) {
    const host = $('trend'); host.replaceChildren();
    if (!rows.length) { host.append(el('p', 'Ответьте на задания этого упражнения — здесь появится график.', 'empty')); $('trendNote').textContent = ''; return; }
    const pointsByDay = new Map();
    // Each day's final value uses up to 30 preceding answers, including earlier days.
    let hits = 0;
    rows.forEach((a, i) => { hits += Number(a.correct); if (i >= 30) hits -= Number(rows[i - 30].correct); pointsByDay.set(a.day, { at: a.at, day: a.day, accuracy: Math.round(hits / Math.min(i + 1, 30) * 100) }); });
    const points = [...pointsByDay.values()].slice(-60), ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', '0 0 640 240'); svg.classList.add('chart'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Точность последних 30 ответов по датам: ' + points.map(p => p.day + ' — ' + p.accuracy + '%').join('; '));
    const add = (tag, attrs, text) => { const node = document.createElementNS(ns, tag); for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value); if (text !== undefined) node.textContent = text; svg.append(node); return node; };
    for (const value of [0, 50, 100]) { const y = 200 - value * 1.7; add('line', { x1: 42, x2: 620, y1: y, y2: y, stroke: '#3c4851' }); add('text', { x: 3, y: y + 4, fill: '#a8b4bd', 'font-size': 13 }, value + '%'); }
    const min = Math.min(...points.map(p => p.at)), max = Math.max(...points.map(p => p.at));
    const x = p => max === min ? 331 : 42 + (p.at - min) / (max - min) * 578, y = p => 200 - p.accuracy * 1.7;
    add('polyline', { points: points.map(p => x(p) + ',' + y(p)).join(' '), fill: 'none', stroke: '#b4dbca', 'stroke-width': 3 });
    for (const p of points) { const circle = add('circle', { cx: x(p), cy: y(p), r: 4, fill: '#b4dbca' }); const title = document.createElementNS(ns, 'title'); title.textContent = p.day + ': ' + p.accuracy + '%'; circle.append(title); }
    add('text', { x: 42, y: 228, fill: '#a8b4bd', 'font-size': 13 }, points[0].day);
    if (points.length > 1) add('text', { x: 620, y: 228, fill: '#a8b4bd', 'font-size': 13, 'text-anchor': 'end' }, points.at(-1).day);
    host.append(svg); $('trendNote').textContent = 'Последние 60 дней с ответами. Точка — точность на конец активного дня; расстояния по горизонтали соответствуют времени.';
  }
  function renderExercise() {
    const rows = answers.filter(a => a.exercise === $('exercise').value && P.modeKey(a.mode) === $('mode').value), s = P.summary(rows);
    $('level').textContent = s.recentAccuracy === null ? '—' : s.recentAccuracy + '%';
    $('levelNote').textContent = s.recentCount ? 'Текущая точность · ' + s.recentCount + '/30 ответов' + (s.recentCount < 30 ? ' · предварительная оценка' : '') : 'В выбранном режиме пока нет истории.';
    renderTrend(rows);
    let hits = 0, bestWindow = 0;
    rows.forEach((a, i) => { hits += Number(a.correct); if (i >= 30) hits -= Number(rows[i - 30].correct); if (i >= 29) bestWindow = Math.max(bestWindow, hits); });
    const best30 = rows.length >= 30 ? Math.round(bestWindow / 30 * 100) + '%' : 'пока меньше 30 ответов';
    $('records').textContent = rows.length ? 'В этом режиме: рекорд последних 30 — ' + best30 + '; лучшая серия в тренировке — ' + s.bestRun + '. Всего ответов: ' + rows.length + '.' : '';
    const groups = new Map();
    for (const a of rows) { const group = groups.get(a.task) || { sample: a, rows: [], mistakes: new Map() }; group.rows.push(a); if (!a.correct) group.mistakes.set(a.actual, (group.mistakes.get(a.actual) || 0) + 1); groups.set(a.task, group); }
    const groupsSorted = [...groups.values()].sort((a, b) => b.rows.filter(r => !r.correct).length - a.rows.filter(r => !r.correct).length);
    const errorRows = groupsSorted.map(g => [taskLabel(g.sample), g.rows.length, g.rows.filter(a => !a.correct).length, percent(g.rows), [...g.mistakes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '—']);
    $('errors').replaceChildren(errorRows.length ? table(['Задание', 'Ответы', 'Ошибки', 'Точность', 'Частая ошибка'], errorRows) : el('p', 'Истории пока нет.', 'empty'));
  }
  function renderHistory() {
    const groups = new Map();
    for (const a of answers) { const key = a.exercise + ':' + a.sessionId, group = groups.get(key) || []; group.push(a); groups.set(key, group); }
    const rows = [...groups.values()].sort((a, b) => b.at(-1).at - a.at(-1).at).slice(0, 20).map(g => [new Date(g[0].at).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }), P.EXERCISES[g[0].exercise], g.length, percent(g)]);
    $('history').replaceChildren(rows.length ? table(['Начало', 'Упражнение', 'Ответы', 'Точность'], rows) : el('p', 'Пока нет сохранённых тренировок.', 'empty'));
  }
  async function reload() { answers = await P.store.list(); renderOverview(); renderModes(); renderHistory(); }
  async function action(fn) {
    if (busy) return;
    busy = true; for (const id of ['export', 'import', 'delete']) $(id).disabled = true;
    try { await fn(); } catch (error) {
      const messages = {
        VersionError: 'Хранилище создано более новой версией сайта. Обновите страницу. Данные не удалены.',
        QuotaExceededError: 'Не хватает места для сохранения истории. Освободите место в браузере или экспортируйте данные.',
        SecurityError: 'Браузер запретил локальное хранилище. Проверьте его настройки.',
        InvalidStateError: 'Хранилище временно недоступно. Обновите страницу. Данные не удалены.',
        UnknownError: 'Браузер не смог открыть локальное хранилище. Данные не удалены.'
      };
      status(messages[error.name] || (error instanceof DOMException ? 'Операция с локальной историей не выполнена. Данные не удалены.' : error.message) || 'Не удалось открыть локальную историю.', true);
    }
    finally { busy = false; for (const id of ['export', 'import', 'delete']) $(id).disabled = false; }
  }
  if (!P) { status('Не удалось загрузить модуль истории. Перезагрузите страницу.', true); return; }
  for (const [id, name] of Object.entries(P.EXERCISES)) { const option = el('option', name); option.value = id; $('exercise').append(option); }
  $('exercise').addEventListener('change', renderModes); $('mode').addEventListener('change', renderExercise);
  window.addEventListener('progress-blocked', () => status('Для обновления хранилища закройте другие вкладки этого сайта, затем обновите страницу.', true));
  $('export').addEventListener('click', () => action(async () => {
    const json = await P.store.exportJSON(), url = URL.createObjectURL(new Blob([json], { type: 'application/json' })), link = el('a');
    link.href = url; link.download = 'solfege-progress-' + P.dayKey() + '.json'; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000); status('JSON подготовлен для скачивания. Храните копию в безопасном месте.');
  }));
  $('import').addEventListener('click', () => $('file').click());
  $('file').addEventListener('change', () => action(async () => {
    const file = $('file').files[0]; $('file').value = ''; if (!file) return;
    if (file.size > 20 * 1024 * 1024) throw new Error('Файл больше 20 МБ. Данные не изменены.');
    if (!confirm('Добавить историю из JSON? Существующие ответы сохранятся, дубликаты будут пропущены.')) return;
    const result = await P.store.importJSON(await file.text()); await reload(); status('Добавлено ответов: ' + result.added + '. Пропущено повторов: ' + result.skipped + '.');
  }));
  $('delete').addEventListener('click', () => action(async () => {
    if (!confirm('Удалить всю историю тренировок в этом браузере? Это действие нельзя отменить. Сначала можно экспортировать JSON.')) return;
    await P.store.clear(); try { localStorage.removeItem('intervals-record'); } catch {}
    await reload(); status('Локальная история удалена. Новые ответы будут записываться заново.');
  }));
  window.addEventListener('pageshow', event => { if (event.persisted) action(reload); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !busy) action(reload); });
  action(async () => { await reload(); status(answers.length ? 'История загружена из этого браузера.' : 'История начнёт сохраняться с новых ответов. Старые несохранённые тренировки восстановить нельзя.'); });
})();
