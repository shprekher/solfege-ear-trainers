(async () => {
  'use strict';
  const P = window.SolfegeProgress, name = 'solfege-page-test-' + crypto.randomUUID(), store = P.createStore(name), results = [];
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const wait = async fn => { const start = performance.now(); while (!(await fn())) { if (performance.now() - start > 10000) throw new Error('Истекло время ожидания'); await new Promise(resolve => setTimeout(resolve, 30)); } };
  const records = [];
  for (let i = 0; i < 70; i++) {
    const at = Date.parse('2026-03-28T12:00:00Z') + i * 3600000;
    records.push({ id: 'fixture-' + i, sessionId: 'session-' + Math.floor(i / 10), exercise: 'intervals', at, day: P.dayKey(new Date(at)), correct: i < 10 || i >= 40,
      mode: { timbre: 'piano', intervalType: i < 40 ? 'melodic' : 'harmonic' }, task: '1:' + (i < 40 ? 'up' : 'together'), expected: 'малая секунда', actual: i < 10 || i >= 40 ? 'малая секунда' : '<img src=x onerror=alert(1)>' });
  }
  await store.importJSON(JSON.stringify({ app: 'solfege-ear-trainers', formatVersion: 1, answers: records }));
  const moduleSource = (await (await fetch('../progress-store.js')).text()).replace("DB_NAME = 'solfege-ear-trainers-progress'", 'DB_NAME = ' + JSON.stringify(name));
  const html = (await (await fetch('../progress.html')).text()).replace('<head>', '<head><base href="' + new URL('../', location.href).href + '">').replace('<script src="./progress-store.js" defer></script>', '<script>' + moduleSource + '</script>');
  for (const width of [432, 393]) {
    const frame = document.createElement('iframe'); frame.style.cssText = 'width:' + width + 'px;height:934px;border:0';
    const loaded = new Promise(resolve => { frame.onload = resolve; }); frame.srcdoc = html; document.body.append(frame); await loaded;
    const doc = frame.contentDocument, win = frame.contentWindow, $ = id => doc.getElementById(id);
    try {
      await wait(() => $('answers').textContent === '70');
      $('exercise').value = 'intervals'; $('exercise').dispatchEvent(new win.Event('change'));
      assert($('mode').options.length === 2, 'Режимы не разделены');
      $('mode').selectedIndex = 0; $('mode').dispatchEvent(new win.Event('change'));
      assert($('level').textContent === '0%', 'Неверно рассчитана точность мелодических интервалов');
      assert($('trend').querySelector('svg'), 'Нет графика');
      assert($('errors').textContent.includes('30'), 'Нет детализации ошибок');
      assert(!$('errors').querySelector('img'), 'Импортированный текст интерпретируется как HTML');
      $('mode').selectedIndex = 1; $('mode').dispatchEvent(new win.Event('change'));
      assert($('level').textContent === '100%', 'Смешаны режимы');
      assert(doc.documentElement.scrollWidth === width, 'Есть горизонтальное переполнение страницы');
      assert($('history').querySelectorAll('tbody tr').length === 7, 'Неверное число тренировок');
      results.push({ title: 'Фильтры, график, ошибки, защита HTML и ширина ' + width, ok: true });
      if (width === 393) {
        Object.defineProperty(win, 'localStorage', { value: { removeItem() {} } });
        win.confirm = () => false; $('delete').click(); await wait(() => !$('delete').disabled);
        assert((await store.list()).length === 70, 'Отмена удаления не сработала');
        let exportBlob;
        win.URL.createObjectURL = blob => { exportBlob = blob; return 'blob:test'; };
        win.HTMLAnchorElement.prototype.click = function () {};
        $('export').click(); await wait(() => !!exportBlob);
        assert(JSON.parse(await exportBlob.text()).answers.length === 70, 'Экспорт потерял данные');
        await wait(() => !$('delete').disabled);
        win.confirm = () => true; $('delete').click(); await wait(() => $('answers').textContent === '0');
        assert((await store.list()).length === 0, 'Удаление не очистило базу');
        const transfer = new win.DataTransfer(); transfer.items.add(new win.File([await exportBlob.text()], 'progress.json', { type: 'application/json' }));
        await wait(() => !$('import').disabled); $('file').files = transfer.files; $('file').dispatchEvent(new win.Event('change'));
        await wait(() => $('answers').textContent === '70');
        assert((await store.list()).length === 70, 'UI-импорт не восстановил данные');
        results.push({ title: 'Экспорт, подтверждение удаления и импорт через интерфейс', ok: true });
      }
    } catch (error) { results.push({ title: 'Страница, ширина ' + width, ok: false, error: error.message }); }
    finally { await win.SolfegeProgress.store.close(); frame.remove(); }
  }
  await store.close();
  await new Promise(resolve => { const request = indexedDB.deleteDatabase(name); request.onsuccess = resolve; request.onerror = resolve; });
  window.__progressPageResults = results;
  document.getElementById('results').textContent = results.map(r => (r.ok ? 'OK ' : 'ОШИБКА ') + r.title + (r.error ? ': ' + r.error : '')).join('\n');
})();
