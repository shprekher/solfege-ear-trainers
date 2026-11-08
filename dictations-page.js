(() => {
  'use strict';
  const D = window.Dictations, $ = id => document.getElementById(id);
  const node = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
  const status = (text, bad = false) => { $('status').textContent = text; $('status').classList.toggle('error', bad); };
  async function render() {
    const collections = (await D.store.collections()).sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt));
    const states = new Map((await D.store.states()).map(s => [s.id, s])); $('collections').replaceChildren();
    for (const c of collections) {
      const tasks = await D.store.tasks(c.id), card = node('article', undefined, 'panel'), link = node('a', c.day + (c.description ? ' · ' + c.description : ''), 'collection-link');
      link.href = './dictation.html?id=' + encodeURIComponent(c.id); card.append(link);
      const done = tasks.filter(t => states.get(t.id)?.done).length, missing = tasks.filter(t => !t.audioId || !t.textSource).length;
      card.append(node('p', tasks.length + ' заданий · выполнено ' + done, 'muted'));
      if (c.receivedParts.length < c.parts) card.append(node('p', 'Получено частей: ' + c.receivedParts.length + '/' + c.parts + '. Импортируйте остальные.', 'error'));
      if (missing) card.append(node('p', 'Неполных пар: ' + missing + '. Проверьте исходные сообщения.', 'muted'));
      $('collections').append(card);
    }
    if (!collections.length) $('collections').append(node('p', 'Занятий пока нет. Импортируйте файл, полученный от бота.', 'empty'));
  }
  if (!D) { status('Не удалось загрузить модуль диктантов. Обновите страницу.', true); return; }
  window.addEventListener('dictation-blocked', () => status('Закройте другие вкладки диктантов для обновления хранилища.', true));
  $('import').addEventListener('click', () => $('files').click());
  $('files').addEventListener('change', async () => {
    const files = [...$('files').files]; $('files').value = ''; if (!files.length) return;
    $('import').disabled = true; let added = 0, failed = 0; const errors = [];
    for (let i = 0; i < files.length; i++) {
      status('Проверяем и сохраняем часть ' + (i + 1) + '/' + files.length + '…');
      try { added += (await D.store.importFile(files[i])).added; }
      catch (error) { failed++; errors.push(files[i].name + ': ' + D.errorMessage(error)); }
    }
    try { await render(); } catch (error) { errors.push(D.errorMessage(error)); failed++; }
    status('Добавлено заданий: ' + added + '. ' + (failed ? 'Не импортировано частей: ' + failed + '. ' + errors.join(' ') : 'Повторные задания пропущены.'), !!failed);
    $('import').disabled = false;
  });
  $('persist').addEventListener('click', async () => {
    try {
      const granted = navigator.storage?.persist && await navigator.storage.persist();
      status(granted ? 'Браузер предоставил защиту от автоматического вытеснения. Всё равно сохраняйте резервные копии.' : 'Браузер не предоставил защиту. Используйте экспорт занятия для резервной копии.');
    } catch { status('Не удалось запросить защиту. Используйте резервные копии.', true); }
  });
  window.addEventListener('pageshow', e => { if (e.persisted) render().catch(error => status(D.errorMessage(error), true)); });
  render().then(() => status('Занятия хранятся только в этом браузере.')).catch(error => status(D.errorMessage(error), true));
})();
