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
  const offsets = {
    1: [0, 1, 0, 1], 2: [0, 2, 3, 0, 3], 3: [0, 3, 7, 3, 5],
    4: [0, 4, 4, 4, 2, 0], 5: [0, 5, 0, 2, 4], 6: [0, 6, 7],
    7: [0, 7, 5, 4, 2, 12], 8: [0, 8, 7, 5], 9: [0, 9, 9, 7, 9, 5],
    10: [0, 10, 9, 5, 3], 11: [0, 11, 12, 11, 7], 12: [0, 12, 11, 7, 9]
  };
  await test('Словарь: все 12 фрагментов, заданные высоты, короткие ритмы при 126 BPM', () => {
    for (const [distance, expected] of Object.entries(offsets)) {
      const melody = A.get(distance);
      assert(JSON.stringify(melody.offsets) === JSON.stringify(expected), 'Высоты: ' + distance);
      assert(melody.beats.length === expected.length && melody.beats.every(n => n > 0), 'Ритм: ' + distance);
      assert(A.duration(distance) > 1 && A.duration(distance) < 3, 'Длина фрагмента: ' + distance);
    }
    assert(A.bpm === 126 && Object.isFrozen(A.melodies) && Object.isFrozen(A.get(1).offsets), 'Словарь изменяем');
  });
  await test('Модуль: точная транспозиция от нижней ноты и отмена всех будущих звуков', () => {
    const sources = [], player = A.createPlayer((midi, start, length) => {
      const source = { midi, start, length, stops: 0, stop() { this.stops++; } };
      sources.push(source); return source;
    });
    for (const base of [48, 60, 72]) for (const distance of Object.keys(offsets).map(Number)) {
      const before = sources.length, info = player.play(distance, base, 10);
      const notes = sources.slice(before);
      assert(notes[0].midi === base && notes[1].midi === base + distance, 'Первые две ноты');
      assert(notes.every((n, i) => n.midi === base + offsets[distance][i]), 'Транспозиция');
      assert(notes.every((n, i) => !i || n.start >= notes[i - 1].start + notes[i - 1].length), 'Наложение нот');
      assert(info.name === A.get(distance).name && near(info.duration, A.duration(distance)), 'Описание фрагмента');
      player.cancel(); player.cancel();
      assert(notes.every(n => n.stops === 1), 'Отмена не остановила будущие ноты ровно один раз');
    }
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
  await test('№8: ошибочный гармонический интервал → мелодия, пауза, низкий, высокий, вместе; название и автопереход', async () => {
    const f = await fixture({ descending: true, base: 72 });
    try {
      await f.start(); const notes = f.wrong(), fragment = A.get(7);
      const signals = f.m.sources.filter(s => s.kind === 'signal');
      assert(signals.length === 2 && notes[0].at > Math.max(...signals.map(s => s.until)), 'Звуковой сигнал изменился или перекрыт разбором');
      assert(notes.length === 4 + fragment.offsets.length, 'Нет всей цепочки');
      const count = fragment.offsets.length, interval = notes.slice(count);
      assert(notes.slice(0, count).every((s, i) => near(s.midi, 72 + fragment.offsets[i])), 'Неверная мелодия/транспозиция');
      assert(near(interval[0].at - notes[0].at - A.duration(7), .35), 'Нет короткой паузы после мелодии');
      assert(near(interval[0].midi, 72) && near(interval[1].midi, 79), 'Разбор не снизу вверх');
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
  });
  await test('№8: нисходящее мелодическое задание без ассоциации; восходящее — с ассоциацией', async () => {
    for (const descending of [true, false]) {
      const f = await fixture({ distance: 3, descending });
      try {
        f.$('melodic').click(); await f.start(); const notes = f.wrong();
        assert(notes.length === (descending ? 4 : 9), 'Направление ассоциации');
        assert(Boolean(f.d.querySelector('.association-name')) === !descending, 'Подпись для неверного направления');
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
      assert(f.m.sources.filter(s => s.kind === 'note' && !s.cancelled && !s.ended).length === 10, 'Новая цепочка не началась');
      f.$('reset').click();
      assert(f.m.sources.every(s => s.cancelled || s.ended) && !f.m.timers.size, 'Сброс не отменил таймеры/звук');
      f.m.advance(20000); assert(f.$('card').classList.contains('idle'), 'Отменённый таймер начал вопрос');
    } finally { f.close(); }
  });
  await test('№8: переход к следующему вопросу до конца мелодии отменяет её оставшиеся звуки', async () => {
    const f = await fixture();
    try {
      await f.start(); const old = f.wrong(); f.m.advance(100);
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
      assert(electric.length === 10 && electric.every(s => s.buffer.bank === 1), 'Мелодия не использует выбранный тембр');
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
  window.__intervalAssociationResults = results;
  document.getElementById('results').textContent = results.map(r =>
    (r.ok ? 'OK ' : 'ОШИБКА ') + r.name + (r.error ? ': ' + r.error : '')
  ).join('\n');
})();
