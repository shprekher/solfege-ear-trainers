/* Isolated tests: no real audio, localStorage or progress database writes. */
(async () => {
  'use strict';
  const results = [], A = window.IntervalAssociations;
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const near = (a, b) => Math.abs(a - b) < 1e-7;
  async function test(name, fn) {
    try { await fn(); results.push({ name, ok: true }); }
    catch (error) { results.push({ name, ok: false, error: error.message }); }
  }
  const phrases = {
    1: [[0, 1], [1, .5], [0, 1], [1, .5]],
    2: [[0, 1.5], [2, .5], [3, 1.5], [0, .5]],
    3: [[0, .5], [3, .5], [7, .5], [3, .5], [5, 1.5]],
    4: [[0, .5], [4, .5], [5, 1.5], [9, .5], [12, 2]],
    5: [[0, .35], [5, .7], [0, .5], [2, .2], [4, .7]],
    6: [[0, .75], [6, .75], [7, 1.5]],
    7: [[0, 1.8], [7, 1.8], [5, .3], [4, .3], [2, .3]],
    8: [[0, .5], [8, .5], [8, .5], [8, .5], [8, .5]],
    9: [[0, .5], [9, .5], [9, .5], [7, .5], [9, .5]],
    10: [[0, .25], [null, .25], [10, .5], [12, .5], [0, .25], [0, .25]],
    11: [[0, 4], [11, 4], [12, 4]],
    12: [[0, 1], [12, 1], [11, .5], [7, .25], [9, .25]]
  };
  await test('Словарь: все 12 фрагментов, паузы, ритм и заданные темпы', () => {
    for (const [distance, expected] of Object.entries(phrases)) {
      const melody = A.get(distance);
      assert(JSON.stringify(melody.notes) === JSON.stringify(expected), 'Ноты и ритм: ' + distance);
      assert(melody.notes.every(([offset, beats]) => (offset === null || Number.isInteger(offset)) && beats > 0), 'Формат: ' + distance);
      const tempos = {1: 54, 2: 96, 3: 66, 4: 72, 5: 76, 6: 140, 7: 100, 8: 91, 9: 120, 10: 88, 11: 169, 12: 140};
      assert(melody.bpm === tempos[distance], 'Темп мелодии: ' + distance);
      assert(near(A.duration(distance), expected.reduce((sum, [, beats]) => sum + beats * 60 / melody.bpm, 0)), 'Расчёт длительности');
      const pitched = melody.notes.filter(([offset]) => offset !== null);
      assert(pitched.length >= 3 && pitched.length <= 5, 'Нужно не больше пяти звучащих нот: ' + distance);
      const limit = 4.4;
      assert(A.duration(distance) > .8 && A.duration(distance) < limit, 'Длина фрагмента: ' + distance);
    }
    assert(A.get(10).name === "RHCP — «Can't Stop»" && A.get(11).name === 'a-ha — «Take On Me»', 'Обновлённые названия');
    assert(A.get(4).name === 'Louis Armstrong — «What a Wonderful World»', 'Название большой терции');
    assert(A.get(8).name === '«Прекрасное далёко»' && A.get(8).notes.length === 5 && near(A.duration(8), 2.5 * 60 / 91), 'Короткая фраза малой сексты');
    assert(A.get(7).notes.length === 5 && near(A.duration(7), 4.5 * 60 / 100), 'Короткая фраза квинты');
    assert(A.get(7).notes.every(([, beats]) => [1, 3, 6].some(n => near(beats / .3, n))), 'Нет соотношения длительностей 6:3:1');
    assert(A.bpm === 140 && Object.isFrozen(A.melodies) && Object.isFrozen(A.get(1).notes) && Object.isFrozen(A.get(1).notes[0]), 'Словарь изменяем');
  });
  await test('Модуль: точная транспозиция от нижней ноты и отмена всех будущих звуков', () => {
    const sources = [], player = A.createPlayer((midi, start, length) => {
      const source = { midi, start, length, stops: 0, stop() { this.stops++; } };
      sources.push(source); return source;
    });
    for (const base of [48, 60, 72]) for (const distance of Object.keys(phrases).map(Number)) {
      const before = sources.length, info = player.play(distance, base, 10);
      const notes = sources.slice(before);
      assert(notes[0].midi === base && notes[1].midi === base + distance, 'Первые две ноты');
      let expectedStart = 10, index = 0;
      const melody = A.get(distance);
      phrases[distance].forEach(([offset, beats]) => {
        const length = beats * 60 / melody.bpm;
        if (offset !== null) {
          const n = notes[index++];
          assert(n.midi === base + offset, 'Транспозиция');
          assert(near(n.start, expectedStart) && near(n.length, length * melody.gate), 'Точная длительность/ритм');
        }
        expectedStart += length;
      });
      assert(index === notes.length, 'Пауза стала звучащей нотой');
      assert(info.name === A.get(distance).name && near(info.duration, A.duration(distance)), 'Описание фрагмента');
      player.cancel(); player.cancel();
      assert(notes.every(n => n.stops === 1), 'Отмена не остановила будущие ноты ровно один раз');
    }
  });
  await test('RHCP: пять нот начала Riff A — пауза, повторы низкой ноты и короткая артикуляция', () => {
    const calls = [], player = A.createPlayer((midi, start, length) => {
      calls.push({ midi, start, length }); return { stop() {} };
    });
    player.play(10, 60, 0);
    const onsets = [0, .5, 1, 1.5, 1.75];
    const pitches = [0, 10, 12, 0, 0];
    assert(calls.length === 5 && near(A.duration(10), 2 * 60 / 88), 'Не пять нот и две доли');
    calls.forEach((n, i) => {
      assert(n.midi === 60 + pitches[i] && near(n.start, onsets[i] * 60 / 88), 'Сетка риффа');
      assert(n.length < (i + 1 < calls.length ? calls[i + 1].start - n.start : A.duration(10) - n.start), 'Нет короткой артикуляции');
    });
    assert(near(calls[0].length, .25 * 60 / 88 * .65), 'Длительность звучания RHCP');
  });
  await test('Катюша: четыре ноты «Расцветали», два пунктирных оборота и учебный темп 96 BPM', () => {
    const calls = [], player = A.createPlayer((midi, start, length) => {
      calls.push({ midi, start, length }); return { stop() {} };
    });
    player.play(2, 60, 0);
    const onsets = [0, 1.5, 2, 3.5];
    assert(calls.length === 4 && near(A.duration(2), 4 * 60 / 96), 'Длина фразы Катюши');
    calls.forEach((n, i) => assert(near(n.start, onsets[i] * 60 / 96), 'Сетка Катюши'));
    assert(near(calls[0].length, 3 * calls[1].length) && near(calls[2].length, 3 * calls[3].length), 'Пунктирный ритм 3:1');
  });
  await test('What a Wonderful World: большая терция F→A, пять нот и точный ритм', () => {
    const calls = [], player = A.createPlayer((midi, start, length) => {
      calls.push({ midi, start, length }); return { stop() {} };
    });
    player.play(4, 60, 0);
    const onsets = [0, .5, 1, 2.5, 3], pitches = [0, 4, 5, 9, 12];
    assert(calls.length === 5 && near(A.duration(4), 5 * 60 / 72), 'Длина фразы');
    calls.forEach((n, i) => {
      assert(n.midi === 60 + pitches[i] && near(n.start, onsets[i] * 60 / 72), 'Сетка и высоты');
    });
    assert(near(calls[0].length, .5 * 60 / 72) && near(calls[2].length, 1.5 * 60 / 72) && near(calls[4].length, 2 * 60 / 72), 'Длительности');
    assert(calls[1].midi - calls[0].midi === 4, 'Первые две ноты — не большая терция');
  });
  await test('Модуль: повтор отменяет прежний фрагмент; исключение останавливает уже созданные звуки', () => {
    const calls = [], player = A.createPlayer(() => {
      const s = { stopped: false, stop() { this.stopped = true; } }; calls.push(s); return s;
    });
    player.play(7, 60, 0); const old = calls.slice(); player.play(2, 60, 0);
    assert(old.every(s => s.stopped), 'Старый фрагмент не отменён');
    player.cancel();
    let stopped = false, count = 0;
    const broken = A.createPlayer(() => {
      if (++count === 2) throw Error('Имитация ошибки');
      return { stop() { stopped = true; } };
    });
    try { broken.play(1, 60, 0); } catch {}
    assert(stopped, 'Не убран частично созданный фрагмент');
  });
  const html = await (await fetch('../intervals-all.html', { cache: 'no-store' })).text();
  const mock = `
    window.mock={now:0,serial:0,timers:new Map(),sources:[],decoded:0,values:new Map(),rows:[]};
    const m=window.mock;
    Object.defineProperty(window,'localStorage',{value:{getItem:k=>m.values.get(k)||null,setItem:(k,v)=>m.values.set(k,String(v)),removeItem:k=>m.values.delete(k)}});
    window.SolfegeProgress={tracker:()=>({record:row=>m.rows.push(row),reset(){}})};
    Object.defineProperty(performance,'now',{value:()=>m.now});
    window.setTimeout=(fn,delay=0)=>{const id=++m.serial;m.timers.set(id,{fn,at:m.now+delay});return id;};
    window.clearTimeout=id=>m.timers.delete(id);
    m.advance=ms=>{
      const end=m.now+ms;let runs=0;
      while(true){
        const next=[...m.timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];
        if(!next)break;if(++runs>1000)throw Error('Цикл таймеров');
        m.now=next[1].at;m.timers.delete(next[0]);next[1].fn();
      }
      m.now=end;
      for(const s of m.sources)if(!s.ended&&s.until<=m.now/1000){s.ended=true;s.onended?.();}
    };
    const draws=INITIAL_DRAWS;Math.random=()=>draws.length?draws.shift():0;
    const param=()=>({value:1,setValueAtTime(v){this.value=v},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}});
    window.AudioContext=class{
      constructor(){this.state='running';this.destination={};}
      get currentTime(){return m.now/1000;}
      resume(){return Promise.resolve();}
      decodeAudioData(){const i=m.decoded++;return Promise.resolve({base:48+i%31,bank:Math.floor(i/31)});}
      createDynamicsCompressor(){return {threshold:param(),knee:param(),ratio:param(),attack:param(),release:param(),connect(){}};}
      createGain(){return {gain:param(),connect(){},disconnect(){}};}
      createBufferSource(){const s={kind:'note',playbackRate:param(),connect(){},disconnect(){},cancelled:false,
        start(at){this.at=at;this.midi=this.buffer.base+12*Math.log2(this.playbackRate.value);m.sources.push(this);},
        stop(at){if(at===undefined){this.cancelled=true;this.until=m.now/1000;}else this.until=at;}
      };return s;}
      createOscillator(){const s=this.createBufferSource();s.kind='signal';s.frequency=param();s.buffer={base:0};return s;}
    };
  `;
  async function fixture({ distance = 7, descending = false, base = 60 } = {}) {
    const index = [1, 2, 3, 4, 5, 7, 8, 9, 10, 11].indexOf(distance);
    const first = descending ? base + distance : base;
    const low = descending ? 48 + distance : 48, high = descending ? 83 : 83 - distance;
    const draws = [index / 10 + .001, descending ? .9 : .1, (first - low + .01) / (high - low + 1)];
    const frame = document.createElement('iframe');
    frame.style.cssText = 'width:393px;height:852px;border:0';
    const ready = new Promise(resolve => frame.onload = resolve);
    frame.srcdoc = html.replace('<head>', '<head><base href="' + new URL('../', location.href).href + '">')
      .replace('<script src="./progress-store.js"></script>', '<script>' + mock.replace('INITIAL_DRAWS', JSON.stringify(draws)) + '</script>');
    document.body.append(frame); await ready;
    const w = frame.contentWindow, d = frame.contentDocument, m = w.mock, $ = id => d.getElementById(id);
    const settle = () => new Promise(resolve => setTimeout(resolve, 0));
    async function start() { $('start').click(); await settle(); m.advance(1500); }
    function wrong() {
      const before = m.sources.length;
      d.querySelector('[data-interval="' + (distance === 1 ? 2 : 1) + '"]').click(); m.advance(400);
      return m.sources.slice(before).filter(s => s.kind === 'note');
    }
    return { frame, w, d, m, $, settle, start, wrong, close() { w.dispatchEvent(new w.Event('pagehide')); frame.remove(); } };
  }
  await test('№8: для всех 10 интервалов мелодия → пауза → низкий → высокий → вместе; название и автопереход', async () => {
    for (const distance of [1, 2, 3, 4, 5, 7, 8, 9, 10, 11]) {
     const f = await fixture({ distance, descending: true, base: 72 });
     try {
      await f.start(); const notes = f.wrong(), fragment = A.get(distance), pitched = fragment.notes.filter(([offset]) => offset !== null);
      const signals = f.m.sources.filter(s => s.kind === 'signal');
      assert(signals.length === 2 && notes[0].at > Math.max(...signals.map(s => s.until)), 'Звуковой сигнал изменился или перекрыт разбором');
      assert(notes.length === 4 + pitched.length, 'Нет всей цепочки');
      const melody = notes.slice(0, pitched.length), interval = notes.slice(pitched.length);
      assert(melody.every((s, i) => near(s.midi, 72 + pitched[i][0])), 'Неверная мелодия/транспозиция');
      assert(near(interval[0].at - melody[0].at - A.duration(distance), .35), 'Нет короткой паузы после мелодии');
      assert(near(interval[0].midi, 72) && near(interval[1].midi, 72 + distance), 'Разбор не снизу вверх');
      assert(interval[1].at > interval[0].until && interval[2].at > interval[1].until, 'Части разбора перекрываются');
      assert(near(interval[2].at, interval[3].at), 'Нет гармонического повтора');
      assert(f.$('feedback').textContent.includes(fragment.name) && f.$('total').textContent === '1', 'Название или статистика');
      const end = Math.max(...notes.map(s => s.until)) * 1000;
      f.m.advance(end - f.m.now + 100);
      assert(f.$('prompt').textContent === 'Разберём интервал', 'Вопрос начался до окончания мелодии');
      f.m.advance(1100);
      assert(f.$('prompt').textContent === 'Какой интервал звучит?' && !f.$('feedback').textContent, 'Нет автоперехода/не убрана подпись');
      assert(notes.every(s => s.cancelled || s.ended), 'Следующий вопрос оставил старые источники');
     } finally { f.close(); }
    }
  });
  await test('№8: нисходящее мелодическое задание без ассоциации; восходящее — с ассоциацией', async () => {
    for (const descending of [true, false]) {
      const f = await fixture({ distance: 3, descending });
      try {
        f.$('melodic').click(); await f.start(); const notes = f.wrong();
        assert(notes.length === (descending ? 4 : 4 + A.get(3).notes.length), 'Направление ассоциации');
        assert(Boolean(f.d.querySelector('.association-name')) === !descending, 'Подпись для неверного направления');
      } finally { f.close(); }
    }
  });
  await test('№8: обновлённые септимы — название, все ноты, паузы и точные beats', async () => {
    for (const distance of [10, 11]) {
      const f = await fixture({ distance, base: 48 });
      try {
        await f.start(); const expected = A.get(distance), melody = f.wrong().slice(0, expected.notes.filter(([offset]) => offset !== null).length);
        assert(f.$('feedback').textContent.includes(expected.name), 'Неверное название септимы');
        assert(melody.length === expected.notes.filter(([offset]) => offset !== null).length, 'Обрыв фразы септимы');
        let at = melody[0].at, index = 0;
        expected.notes.forEach(([offset, beats]) => {
          const length = beats * 60 / expected.bpm;
          if (offset !== null) {
            const source = melody[index++];
            assert(near(source.midi, 48 + offset) && near(source.at, at), 'Неверные ноты/ритм септимы');
            assert(near(source.until - source.at - .005, length * expected.gate), 'Длительность ноты не из beats');
          }
          at += length;
        });
      } finally { f.close(); }
    }
  });
  await test('№8: Take On Me в обоих тембрах — первые две ноты совпадают с большой септимой вопроса, третья выше на полтона', async () => {
    for (const bank of [0, 1]) {
      const f = await fixture({ distance: 11, base: 60 });
      try {
        await f.start();
        if (bank) { f.$('electric').click(); await f.settle(); f.m.advance(1500); }
        const question = f.m.sources.filter(s => s.kind === 'note' && !s.cancelled && s.buffer.bank === bank);
        const notes = f.wrong(), melody = notes.slice(0, 3);
        assert(notes.length === 7 && melody.every(s => s.buffer.bank === bank), 'Три ноты и выбранный тембр');
        assert(near(melody[0].midi, 60) && near(melody[1].midi, 71) && near(melody[2].midi, 72), 'Неверная фраза 0 → 11 → 12');
        assert(near(melody[1].midi - melody[0].midi, 11), 'Первая пара — не большая септима');
        assert(question.length === 2 && question.every((s, i) => near(s.midi, melody[i].midi)), 'Первые ноты не совпали с вопросом');
        melody.forEach((s, i) => {
          assert(near(s.at - melody[0].at, i * 4 * 60 / 169), 'Неверные начала нот');
          assert(near(s.until - s.at - .005, 4 * 60 / 169), 'Не целая нота');
        });
        assert(near(A.duration(11), 12 * 60 / 169), 'Длительность припева');
      } finally { f.close(); }
    }
  });
  await test('№8: правильный ответ и отключённый разбор не запускают мелодию', async () => {
    for (const correct of [true, false]) {
      const f = await fixture();
      try {
        if (!correct) f.$('unpack').checked = false;
        await f.start(); const before = f.m.sources.length;
        f.d.querySelector('[data-interval="' + (correct ? 7 : 1) + '"]').click(); f.m.advance(400);
        assert(!f.m.sources.slice(before).some(s => s.kind === 'note'), 'Лишнее проигрывание');
        assert(!f.d.querySelector('.association-name'), 'Лишняя подпись');
      } finally { f.close(); }
    }
  });
  await test('№8: повтор во время мелодии останавливает цепочку и все будущие звуки, не считает ответ дважды', async () => {
    const f = await fixture();
    try {
      await f.start(); const old = f.wrong(); f.m.advance(700);
      assert(!f.$('repeat').disabled && f.w.getComputedStyle(f.$('repeat')).visibility === 'visible', 'Повтор недоступен во время мелодии');
      f.$('repeat').click(); f.m.advance(0);
      assert(old.every(s => s.cancelled || s.ended), 'Старые звуки продолжаются');
      assert(f.$('total').textContent === '1' && f.m.rows.length === 1, 'Повтор изменил статистику');
      assert(f.m.sources.filter(s => s.kind === 'note' && !s.cancelled && !s.ended).length === 4 + A.get(7).notes.length, 'Новая цепочка не началась');
      f.$('reset').click();
      assert(f.m.sources.every(s => s.cancelled || s.ended) && !f.m.timers.size, 'Сброс не отменил таймеры/звук');
      f.m.advance(20000); assert(f.$('card').classList.contains('idle'), 'Отменённый таймер начал вопрос');
    } finally { f.close(); }
  });
  await test('№8: переход к следующему вопросу до конца мелодии отменяет её оставшиеся звуки', async () => {
    const f = await fixture();
    try {
      await f.start(); const old = f.wrong(); f.m.advance(700);
      // Invoke the real next-question callback early, as a future manual Next would.
      const [id, transition] = [...f.m.timers].sort((a, b) => b[1].at - a[1].at)[0];
      f.m.timers.delete(id); transition.fn(); f.m.advance(0);
      assert(old.every(s => s.cancelled || s.ended), 'Старый фрагмент звучит в новом вопросе');
      assert(!f.$('feedback').textContent && f.$('prompt').textContent === 'Какой интервал звучит?', 'Остался разбор');
      assert(f.$('total').textContent === '1', 'Переход изменил число ответов');
    } finally { f.close(); }
  });
  await test('№8: смена тембра/направления и выключение разбора отменяют старую мелодию', async () => {
    const f = await fixture({ descending: true });
    try {
      await f.start(); let old = f.wrong();
      f.$('electric').click();
      assert(old.every(s => s.cancelled), 'Смена тембра не прервала звук');
      await f.settle(); f.m.advance(0);
      const electric = f.m.sources.filter(s => s.kind === 'note' && !s.cancelled && !s.ended);
      assert(electric.length === 4 + A.get(7).notes.length && electric.every(s => s.buffer.bank === 1), 'Мелодия не использует выбранный тембр');
      old = electric; f.$('melodic').click(); f.m.advance(0);
      assert(old.every(s => s.cancelled) && !f.d.querySelector('.association-name'), 'Смена направления не убрала мелодию');
      assert(f.m.sources.filter(s => s.kind === 'note' && !s.cancelled && !s.ended).length === 4, 'Нисходящий разбор стал мелодией');
      f.$('harmonic').click(); f.m.advance(0);
      old = f.m.sources.filter(s => !s.cancelled && !s.ended); f.$('unpack').checked = false;
      f.$('unpack').dispatchEvent(new f.w.Event('change'));
      assert(old.every(s => s.cancelled) && !f.d.querySelector('.association-name'), 'Выключенный разбор продолжает звучать');
    } finally { f.close(); }
  });
  await test('№8: длинное название ассоциации не создаёт горизонтальную прокрутку на телефонах', async () => {
    const f = await fixture({ distance: 3 });
    try {
      await f.start(); f.wrong();
      for (const [width, height] of [[432, 934], [393, 852]]) {
        f.frame.style.width = width + 'px'; f.frame.style.height = height + 'px';
        assert(f.d.documentElement.scrollWidth === width, 'Прокрутка на ' + width);
        assert(f.$('feedback').textContent.includes('Подмосковные вечера'), 'Нет длинного названия');
      }
    } finally { f.close(); }
  });
  await test('№8: переключатели в одну строку, слева тип, справа тембр, на телефонах', async () => {
    const f = await fixture();
    try {
      for (const [width, height] of [[432, 934], [393, 852]]) {
        f.frame.style.width = width + 'px'; f.frame.style.height = height + 'px';
        const row = f.d.querySelector('.mode-row'), groups = [...f.d.querySelectorAll('.mode-switch')], buttons = [...f.d.querySelectorAll('.mode-btn')];
        const rr = row.getBoundingClientRect(), left = groups[0].getBoundingClientRect(), right = groups[1].getBoundingClientRect();
        assert(rr.height < 55, 'Переключатели переносятся на вторую строку: ' + width);
        assert(Math.abs(left.left - rr.left) < 1 && Math.abs(right.right - rr.right) < 1, 'Группы не прижаты к краям: ' + width);
        assert(buttons.every(b => b.getBoundingClientRect().height <= 40), 'Кнопки слишком высокие: ' + width);
        assert(f.d.documentElement.scrollWidth === width, 'Горизонтальная прокрутка: ' + width);
      }
    } finally { f.close(); }
  });
  window.__intervalAssociationResults = results;
  document.getElementById('results').textContent = results.map(r =>
    (r.ok ? 'OK ' : 'ОШИБКА ') + r.name + (r.error ? ': ' + r.error : '')
  ).join('\n');
})();
