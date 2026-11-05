(async () => {
  'use strict';
  const P = window.SolfegeProgress, name = 'solfege-integration-test-' + crypto.randomUUID();
  const store = P.createStore(name), results = [];
  const source = await (await fetch('../progress-store.js')).text();
  const isolatedSource = source.replace("DB_NAME = 'solfege-ear-trainers-progress'", 'DB_NAME = ' + JSON.stringify(name));
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const wait = async fn => { const start = performance.now(); while (!(await fn())) { if (performance.now() - start > 15000) throw new Error('Истекло время ожидания'); await new Promise(resolve => setTimeout(resolve, 30)); } };
  const files = Object.keys(P.EXERCISES);
  await Promise.all(files.map(async exercise => {
    const frame = document.createElement('iframe'); frame.style.cssText = 'width:432px;height:934px;border:0';
    let doc;
    try {
      const html = await (await fetch('../' + exercise + '.html')).text();
      const ready = new Promise(resolve => { frame.onload = resolve; });
      frame.srcdoc = html.replace('<head>', '<head><base href="' + new URL('../', location.href).href + '">').replace('<script src="./progress-store.js"></script>', '<script>' + isolatedSource + '</script><script>Object.defineProperty(window,"localStorage",{value:{getItem(){return null},setItem(){},removeItem(){}}});Math.random=()=>.1;</script>');
      document.body.append(frame); await ready;
      doc = frame.contentDocument; const win = frame.contentWindow, errors = [];
      win.addEventListener('error', event => errors.push(event.message));
      const replay = doc.querySelector('.replay-control');
      const readyForAnswer = () => !replay.disabled && win.getComputedStyle(replay).visibility === 'visible';
      doc.getElementById('start').click(); await wait(readyForAnswer);
      if (exercise === 'shifted-voice') { doc.querySelector('[data-voice="1"]').click(); doc.querySelector('[data-direction="1"]').click(); }
      else if (exercise === 'half-step') doc.querySelector('[data-direction="1"]').click();
      else if (exercise === 'note-reading') doc.querySelector('[data-letter="C"]').click();
      else [...doc.querySelectorAll('.choice')].filter(b => !b.disabled).at(-1).click();
      await wait(async () => (await store.list()).filter(a => a.exercise === exercise).length === 1);
      const first = (await store.list()).find(a => a.exercise === exercise);
      assert(!first.correct, 'Тестовый неверный ответ записан как правильный');
      const correctChoice = doc.querySelector('.choice.correct'), rightVoice = doc.querySelector('.voice-btn.correct');
      const rightDirection = doc.querySelector('[data-direction].correct');
      const correctData = { guess: correctChoice?.dataset.guess, letter: correctChoice?.dataset.letter, interval: correctChoice?.dataset.interval,
        voice: rightVoice?.dataset.voice, direction: rightDirection?.dataset.direction };
      await wait(readyForAnswer); replay.click();
      await wait(() => replay.disabled || win.getComputedStyle(replay).visibility === 'hidden');
      assert((await store.list()).filter(a => a.exercise === exercise).length === 1, 'Повтор записан как ответ');
      doc.getElementById('reset').click();
      assert((await store.list()).filter(a => a.exercise === exercise).length === 1, 'Сброс удалил историю');
      doc.getElementById('start').click(); await wait(readyForAnswer);
      if (exercise === 'shifted-voice') { doc.querySelector('[data-voice="' + correctData.voice + '"]').click(); doc.querySelector('[data-direction="' + correctData.direction + '"]').click(); }
      else if (exercise === 'half-step') doc.querySelector('[data-direction="' + correctData.direction + '"]').click();
      else if (exercise === 'count-notes') doc.querySelector('[data-guess="' + correctData.guess + '"]').click();
      else if (exercise === 'intervals') doc.querySelector('[data-interval="' + correctData.interval + '"]').click();
      else doc.querySelector('[data-letter="' + correctData.letter + '"]').click();
      await wait(async () => (await store.list()).filter(a => a.exercise === exercise).length === 2);
      const rows = (await store.list()).filter(a => a.exercise === exercise);
      assert(rows[1].correct && rows[1].sessionId !== first.sessionId, 'Неверный ответ или идентификатор новой тренировки');
      assert(rows.every(a => a.mode.timbre && a.task && a.expected && a.actual), 'Не записаны детали');
      assert(errors.length === 0, errors.join('; '));
      results.push({ exercise, ok: true, modes: rows.map(a => a.mode) });
    } catch (error) { results.push({ exercise, ok: false, error: error.message }); }
    finally { doc?.getElementById('reset')?.click(); await doc?.defaultView?.SolfegeProgress?.store.close(); frame.remove(); }
  }));
  await store.close();
  const total = (await store.list()).length;
  results.push({ exercise: 'Повторное открытие базы: 12 ответов', ok: total === 12, total });
  await store.close();
  await new Promise(resolve => { const request = indexedDB.deleteDatabase(name); request.onsuccess = resolve; request.onerror = resolve; });
  window.__progressIntegrationResults = results;
  document.getElementById('results').textContent = results.map(r => (r.ok ? 'OK ' : 'ОШИБКА ') + r.exercise + (r.error ? ': ' + r.error : '')).join('\n');
})();
