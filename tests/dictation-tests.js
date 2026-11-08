(async () => {
  'use strict';
  const D = window.Dictations, db = 'solfege-dictation-test-' + crypto.randomUUID(), store = D.createStore(db), results = [];
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const wait = async fn => { const t = performance.now(); while (!(await fn())) { if (performance.now() - t > 20000) throw Error('Истекло время ожидания'); await new Promise(r => setTimeout(r, 30)); } };
  const test = async (title, fn) => { try { await fn(); results.push({ title, ok: true }); } catch (error) { results.push({ title, ok: false, error: error.message }); } };
  let file, bundle;
  async function fixture(path) { const r = await fetch('./dictation-fixtures/' + path); if (!r.ok) throw Error('Сначала создайте синтетические fixtures'); return r.blob(); }
  const rejects = async fn => { let bad = false; try { await fn(); } catch { bad = true; } assert(bad, 'Ожидалась ошибка'); };
  await test('Формат Python → браузер, буквальный текст и исходный порядок', async () => {
    file = await fixture('sample.solfege'); bundle = await D.readBundle(file); await store.importFile(file);
    const tasks = await store.tasks(bundle.collection.id);
    assert(tasks.length === 3 && tasks[0].title.startsWith('ИП №2 (т, 2).') && tasks[1].title.startsWith('ИП №10') && tasks[2].title.startsWith('ИП №1.'), 'Текст или порядок изменён');
    assert(tasks[0].text.endsWith('  ♭ ч.4 / 2/4 — буквально! '), 'Потеряны пробелы или обозначения');
  });
  await test('Дубликаты, переоткрытие базы и сохранение позиции', async () => {
    assert((await store.importFile(file)).added === 0, 'Повторный импорт создал дубликаты');
    const task = bundle.tasks[0]; await store.saveState(task.id, { done: true, position: 1.25, rate: .75, loopA: .3, loopB: 1.2, loopEnabled: true });
    await store.close(); assert((await store.state(task.id)).position === 1.25, 'Потеряна позиция');
    await store.saveCollection(bundle.collection.id, { description: 'Моё описание', lastTaskId: task.id });
    await store.importFile(file); assert((await store.collection(bundle.collection.id)).description === 'Моё описание', 'Описание перезаписано');
  });
  await test('Повреждённое аудио и конфликт задания не меняют историю', async () => {
    const data = new Uint8Array(await file.arrayBuffer()); data[data.length - 1] ^= 1;
    await rejects(() => store.importFile(new Blob([data])));
    const magic = new TextEncoder().encode('SOLFEGE-DICTATION\n'), raw = await file.arrayBuffer(), n = new DataView(raw).getUint32(magic.length, true), start = magic.length + 4;
    const header = JSON.parse(await file.slice(start, start + n).text()); header.tasks[0].title = 'Подменённое название';
    const json = new TextEncoder().encode(JSON.stringify(header)), size = new Uint8Array(4); new DataView(size.buffer).setUint32(0, json.length, true);
    await rejects(() => store.importFile(new Blob([magic, size, json, file.slice(start + n)])));
    assert((await store.tasks(bundle.collection.id))[0].title === bundle.tasks[0].title, 'Конфликт изменил условие');
  });
  await test('Экспорт восстанавливает аудио, описание и отметки', async () => {
    const exported = await store.exportParts(bundle.collection.id), backup = D.createStore(db + '-backup');
    try { await backup.importFile(exported[0].blob); assert((await backup.state(bundle.tasks[0].id)).done, 'Нет отметки'); assert((await backup.collection(bundle.collection.id)).description === 'Моё описание', 'Нет описания'); assert((await backup.audio(bundle.collection.id, bundle.tasks[0].audioId)).blob.size > 0, 'Нет аудио'); }
    finally { await backup.close(); await new Promise(r => { const req = indexedDB.deleteDatabase(db + '-backup'); req.onsuccess = r; }); }
  });
  await test('Части набора импортируются в любом порядке', async () => {
    const second = await fixture('part2.solfege'), first = await fixture('part1.solfege'); await store.importFile(second); await store.importFile(first);
    const tasks = await store.tasks('fixture-dictations-parts'), c = await store.collection('fixture-dictations-parts');
    assert(tasks.length === 3 && tasks[0].order === 100 && c.receivedParts.length === 2, 'Части потеряны или переставлены');
  });
  for (const [width, height] of [[432, 934], [393, 852]]) await test('Плеер и мобильная вёрстка ' + width, async () => {
    await store.saveState(bundle.tasks[0].id, { position: 1.25, rate: .75, loopA: .3, loopB: 1.2, loopEnabled: true });
    await store.saveCollection(bundle.collection.id, { lastTaskId: bundle.tasks[0].id, search: '', listScroll: 0 });
    const frame = document.createElement('iframe'); frame.style.cssText = 'width:' + width + 'px;height:' + height + 'px;border:0';
    frame.src = './dictation-player-harness.html?id=' + encodeURIComponent(bundle.collection.id) + '&db=' + encodeURIComponent(db); document.body.append(frame);
    let doc, win;
    try {
      await wait(() => { doc = frame.contentDocument; win = frame.contentWindow; return doc?.getElementById('audio')?.readyState >= 1 && doc.getElementById('status').textContent.includes('Запись загружена'); });
      const $ = id => doc.getElementById(id), audio = $('audio');
      audio.volume = .02;
      assert(audio.paused, 'Сработало автовоспроизведение');
      assert(Math.abs(audio.currentTime - 1.25) < .1, 'Не восстановлена позиция');
      assert(doc.documentElement.scrollWidth === width, 'Страница переполняется по горизонтали');
      $('loopEnabled').checked = false; $('loopEnabled').dispatchEvent(new win.Event('change'));
      $('seek').value = 2; $('seek').dispatchEvent(new win.Event('input')); await wait(() => Math.abs(audio.currentTime - 2) < .1);
      $('back').click(); await wait(() => audio.currentTime < .1); $('forward').click(); await wait(() => Math.abs(audio.currentTime - 3) < .1);
      $('rate').value = '.75'; $('rate').value = '0.75'; $('rate').dispatchEvent(new win.Event('change')); assert(audio.playbackRate === .75 && audio.preservesPitch, 'Изменена высота или скорость не работает');
      $('loopA').value = '.5'; $('loopB').value = '1'; $('loopEnabled').checked = true; $('loopEnabled').dispatchEvent(new win.Event('change'));
      $('play').click(); await wait(() => !audio.paused); await wait(() => audio.currentTime > .7); await wait(() => audio.currentTime < .65); audio.pause();
      const old = $('taskTitle').textContent; $('next').click(); await wait(() => $('taskTitle').textContent !== old && audio.readyState >= 1);
      assert(audio.paused, 'Переключение запустило аудио');
      $('loopEnabled').checked = false; $('loopEnabled').dispatchEvent(new win.Event('change')); audio.currentTime = audio.duration - .05; audio.play().catch(() => {}); await wait(() => audio.ended);
      assert($('taskTitle').textContent.startsWith('ИП №10'), 'Конец записи переключил задание');
      $('next').click(); await wait(() => $('taskTitle').textContent.startsWith('ИП №1.'));
      assert(!$('condition').querySelector('img'), 'Оригинальный текст интерпретируется как HTML');
      $('search').value = '№2'; $('search').dispatchEvent(new win.Event('input')); await wait(() => $('tasks').querySelectorAll('button').length === 1);
      $('tasks').querySelector('button').click(); await wait(() => $('taskTitle').textContent.startsWith('ИП №2'));
      assert($('condition').textContent === bundle.tasks[0].text, 'Оригинальный текст изменён');
      $('complete').checked = true; $('complete').dispatchEvent(new win.Event('change')); await wait(async () => (await store.state(bundle.tasks[0].id)).done);
    } finally { if (win?.Dictations) { doc.getElementById('audio')?.pause(); await win.Dictations.store.close(); } frame.remove(); }
  });
  await test('240 записей: страницы, поиск и восстановление последнего задания', async () => {
    await store.importFile(await fixture('large.solfege'));
    const tasks = await store.tasks('fixture-dictations-large');
    await store.saveCollection('fixture-dictations-large', { lastTaskId: tasks[210].id });
    const frame = document.createElement('iframe'); frame.style.cssText = 'width:432px;height:934px;border:0'; frame.src = './dictation-player-harness.html?id=fixture-dictations-large&db=' + encodeURIComponent(db); document.body.append(frame);
    try {
      await wait(() => frame.contentDocument.getElementById('audio')?.readyState >= 1);
      const doc = frame.contentDocument, win = frame.contentWindow;
      assert(doc.getElementById('taskTitle').textContent.includes('№211'), 'Не восстановлено последнее задание');
      assert(doc.getElementById('tasks').querySelectorAll('button').length === 40, 'Список не разбит на страницы');
      doc.getElementById('search').value = '№201'; doc.getElementById('search').dispatchEvent(new win.Event('input'));
      await wait(() => doc.getElementById('tasks').querySelectorAll('button').length === 1);
      doc.getElementById('tasks').querySelector('button').click(); await wait(() => doc.getElementById('taskTitle').textContent.includes('№201'));
    } finally { const win = frame.contentWindow; frame.contentDocument.getElementById('audio')?.pause(); if (win.Dictations) await win.Dictations.store.close(); frame.remove(); }
  });
  await test('Удаление занятия не затрагивает другое', async () => { await store.remove(bundle.collection.id); assert((await store.tasks(bundle.collection.id)).length === 0, 'Не удалены задания'); assert((await store.tasks('fixture-dictations-parts')).length === 3, 'Удалено другое занятие'); });
  await test('Импорт через файловый диалог страницы и отсутствие дублей в списке', async () => {
    const listDB = db + '-list', frame = document.createElement('iframe'); frame.style.cssText = 'width:393px;height:852px;border:0'; frame.src = './dictation-player-harness.html?view=collections&db=' + encodeURIComponent(listDB); document.body.append(frame);
    let win;
    try {
      await wait(() => frame.contentDocument.getElementById('status')?.textContent.includes('Занятия хранятся'));
      win = frame.contentWindow; const doc = frame.contentDocument;
      for (let i = 0; i < 2; i++) {
        const transfer = new win.DataTransfer(); transfer.items.add(new win.File([file], 'sample.solfege', { type: 'application/octet-stream' }));
        doc.getElementById('files').files = transfer.files; doc.getElementById('files').dispatchEvent(new win.Event('change'));
        await wait(() => !doc.getElementById('import').disabled && doc.getElementById('status').textContent.includes('Добавлено заданий:'));
      }
      assert(doc.querySelectorAll('.collection-link').length === 1, 'Дублируется занятие');
      assert(doc.querySelector('.collection-link').textContent.includes('2026-11-08'), 'Нет даты занятия');
      assert(doc.documentElement.scrollWidth === 393, 'Переполнение страницы списка');
      assert(doc.getElementById('status').textContent.includes('Добавлено заданий: 0.'), 'Повторный импорт создал задания');
    } finally { if (win?.Dictations) await win.Dictations.store.close(); frame.remove(); await new Promise(r => { const req = indexedDB.deleteDatabase(listDB); req.onsuccess = r; }); }
  });
  await store.close(); await new Promise(r => { const req = indexedDB.deleteDatabase(db); req.onsuccess = r; });
  window.__dictationTestResults = results;
  document.getElementById('results').textContent = results.map(r => (r.ok ? 'OK ' : 'ОШИБКА ') + r.title + (r.error ? ': ' + r.error : '')).join('\n');
})();
