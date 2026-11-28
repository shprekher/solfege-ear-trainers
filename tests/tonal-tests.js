/* Isolated checks for tonal-engine and the tonal exercise. No real audio, timers or storage. */
(async () => {
  'use strict';
  const results = [], E = window.TonalEngine;
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const near = (a, b, epsilon = 1e-7) => Math.abs(a - b) < epsilon;
  const rngFrom = seed => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  async function test(name, fn) {
    try { await fn(); results.push({ name, ok: true }); }
    catch (error) { results.push({ name, ok: false, error: error.message }); }
  }

  await test('Тональности: диатоническая гамма C3–B5 и каденция I–IV–V–I', () => {
    assert(E.KEYS.length === 6, 'Не шесть тональностей');
    for (const info of E.KEYS) {
      const scale = E.scaleNotes(info.id);
      assert(scale.length > 0 && scale.every(note => note.midi >= 48 && note.midi <= 83), 'Гамма вне диапазона: ' + info.id);
      assert(scale.every((note, i) => i === 0 || note.midi > scale[i - 1].midi), 'Гамма не по возрастанию: ' + info.id);
      assert(scale.every(note => note.name === info.names[note.degree - 1]), 'Названия ступеней: ' + info.id);
      const cad = E.cadence(info.id), tonic = 12 * 4 + info.tonic;
      assert(cad.length === 4, 'Каденция не из четырёх аккордов: ' + info.id);
      assert(JSON.stringify(cad[0]) === JSON.stringify([tonic, tonic + 4, tonic + 7]), 'I аккорд: ' + info.id);
      assert(JSON.stringify(cad[1]) === JSON.stringify([tonic + 5, tonic + 9, tonic + 12]), 'IV аккорд: ' + info.id);
      assert(JSON.stringify(cad[2]) === JSON.stringify([tonic + 7, tonic + 11, tonic + 14]), 'V аккорд: ' + info.id);
      assert(JSON.stringify(cad[3]) === JSON.stringify(cad[0]), 'Каденция не возвращается в I: ' + info.id);
      assert(cad.flat().every(midi => midi >= 48 && midi <= 83), 'Каденция вне диапазона: ' + info.id);
    }
    assert(near(E.CADENCE_TOTAL, 2.42), 'Длительность каденции');
    assert(near(E.CHORD_DURATION, .56), 'Длительность аккорда');
  });

  await test('Уровни: состав кнопок и новые интервалы', () => {
    const expected = [
      { level: 1, count: 3, added: [12, 7, 1] }, { level: 2, count: 5, added: [3, 4] },
      { level: 3, count: 6, added: [2] }, { level: 4, count: 8, added: [8, 9] },
      { level: 5, count: 9, added: [5] }, { level: 6, count: 11, added: [10, 11] },
      { level: 7, count: 12, added: [6] }
    ];
    assert(E.LEVELS.length === 7, 'Не семь уровней');
    for (const item of expected) {
      const level = E.level(item.level);
      assert(level.intervals.length === item.count, 'Количество кнопок: ' + item.level);
      assert(JSON.stringify(level.newIntervals) === JSON.stringify(item.added), 'Новые интервалы: ' + item.level);
      assert(level.intervals.every((distance, i) => i === 0 || distance > level.intervals[i - 1]), 'Кнопки не по порядку: ' + item.level);
    }
    assert(E.level(7).intervals.includes(6) && !E.level(6).intervals.includes(6), 'Тритон открывается на 7 уровне');
    assert(E.INTRO_REPEATS === 3, 'Не три знакомства');
  });

  await test('Вопросы: все ноты диатоничны, интервал и диапазон точны', () => {
    let count = 0;
    for (const info of E.KEYS) for (const level of E.LEVELS) for (const direction of [1, -1, 0]) for (const type of ['tonic', 'between']) {
      for (const distance of level.intervals) for (let i = 0; i < 8; i++) {
        const question = E.makeQuestion({ keyId: info.id, distance, type, direction, rng: rngFrom(count + 1) });
        assert(question, 'Нет вопроса: ' + [info.id, distance, type, direction]);
        count++;
        const scale = E.scaleNotes(info.id), mids = new Set(scale.map(note => note.midi));
        assert(mids.has(question.lower) && mids.has(question.upper), 'Нота не из гаммы');
        assert(question.upper - question.lower === distance, 'Неверный интервал');
        assert(question.lower >= 48 && question.upper <= 83, 'Вне C3–B5');
        assert(question.target === question.upper, 'Цель не верхний звук');
        const order = direction === 1 ? [question.lower, question.upper] : direction === -1 ? [question.upper, question.lower] : [question.lower, question.upper];
        assert(JSON.stringify(question.notes) === JSON.stringify(order), 'Порядок воспроизведения');
        assert(question.harmonic === (direction === 0), 'Гармонический признак');
        if (type === 'tonic' && !question.fallback) assert(question.lowerDegree === 1 || question.upperDegree === 1, 'В вопросе нет тоники');
        if (distance === 6 && type === 'tonic') assert(question.fallback && question.type === 'between', 'Тритон не перешёл к ступеням');
      }
    }
    assert(count > 1000, 'Мало проверенных вопросов');
  });

  await test('От тоники: тоника снизу там, где это возможно, и сверху для малых интервалов', () => {
    const q = distance => E.makeQuestion({ keyId: 'C', distance, type: 'tonic', direction: 1, rng: () => .2 });
    for (const distance of [2, 4, 5, 7, 9, 11, 12]) assert(q(distance).lowerDegree === 1, 'Тоника не снизу: ' + distance);
    for (const distance of [1, 3, 8, 10]) assert(q(distance).upperDegree === 1, 'Тоника не сверху: ' + distance);
    assert(q(6).fallback && q(6).type === 'between', 'Тритон не между ступенями');
    assert(E.noteName(58, 'F') === 'си-бемоль', 'Фа-мажор: си-бемоль');
    assert(E.noteName(66, 'G') === 'фа-диез', 'Соль-мажор: фа-диез');
    assert(E.noteName(75, 'E') === 'ре-диез', 'Ми-мажор: ре-диез');
    assert(E.noteNameWithOctave(60, 'C') === 'до4', 'Октава ноты');
  });

  await test('Адаптивные веса: ошибки повышают, верные снижают, повтора нет', () => {
    assert(near(E.updateRate(0, false), .35) && near(E.updateRate(.35, false), .7) && near(E.updateRate(.7, false), 1), 'Рост веса');
    assert(near(E.updateRate(.8, true), .68), 'Снижение веса');
    assert(near(E.rateOf({ 3: 2 }, 3), 1) && near(E.rateOf({ 3: -1 }, 3), 0), 'Ограничение веса');
    const rng = rngFrom(7), seen = new Set();
    for (let i = 0; i < 200; i++) {
      const distance = E.chooseDistance({ available: [1, 3, 7], rates: { 1: 1, 3: 0, 7: 0 }, last: 1, rng });
      assert(distance !== 1, 'Повтор последнего интервала');
      seen.add(distance);
    }
    assert(seen.has(3) && seen.has(7), 'Нет выбора среди доступных');
  });

  await test('Автопереход: 30 ответов и порог 85%', () => {
    assert(E.AUTO_WINDOW === 30 && near(E.AUTO_THRESHOLD, .85), 'Порог');
    assert(E.shouldAdvance(Array(30).fill(1), 1), '30 верных не дают переход');
    assert(!E.shouldAdvance(Array(29).fill(1), 1), '29 ответов дают переход');
    assert(!E.shouldAdvance(Array(25).fill(1).concat([0, 0, 0, 0, 0]), 1), '83% дают переход');
    assert(E.shouldAdvance(Array(26).fill(1).concat([0, 0, 0, 0]), 2), '87% не дают переход');
    assert(!E.shouldAdvance(Array(30).fill(1), 7), 'Седьмой уровень переходит выше');
    const history = E.nextLevelResult(Array(29).fill(1), true);
    assert(history.length === 30 && history[29] === 1, 'История не пополнилась');
    const capped = E.nextLevelResult(Array(30).fill(1), false);
    assert(capped.length === 30 && capped[29] === 0 && capped[0] === 1, 'История не ограничена 30');
  });

  await test('MIDI и голос: точное совпадение и допуск ±60 центов', () => {
    assert(E.midiMatches(60, 60) && !E.midiMatches(61, 60), 'MIDI не требует точного полутона');
    assert(E.voiceMatches(60, 0, 60) && E.voiceMatches(61, -50, 60), 'Голос не принимает допустимый диапазон');
    assert(!E.voiceMatches(60, 61, 60) && !E.voiceMatches(61, -30, 60), 'Голос принимает больше ±60 центов');
  });

  await test('Повторная проверка: через 2–3 вопроса, с другими нотами и без подсказки', () => {
    const queue = E.createRecheckQueue(), rng = () => 0;
    const item = E.scheduleRecheck(queue, 3, { lower: 60, upper: 63 }, rng);
    assert(item.due === 2, 'Не два вопроса');
    assert(E.tickRechecks(queue) && queue[0].due === 1, 'Первый тик');
    assert(E.takeDueRecheck(queue) === null, 'Слишком ранняя проверка');
    E.tickRechecks(queue);
    const due = E.takeDueRecheck(queue);
    assert(due && due.distance === 3 && due.avoid.upper === 63 && queue.length === 0, 'Проверка не вернулась');
    const late = E.scheduleRecheck(E.createRecheckQueue(), 8, null, () => .99);
    assert(late.due === 3, 'Не три вопроса');
    const single = E.createRecheckQueue();
    E.scheduleRecheck(single, 3, null, () => 0); E.scheduleRecheck(single, 3, null, () => .99);
    assert(single.length === 1 && single[0].due === 3, 'Дубли повторной проверки');
    assert(JSON.stringify(E.introDistances(1)) === JSON.stringify([12, 7, 1]), 'Знакомство 1 уровня');
    assert(JSON.stringify(E.introDistances(1, new Set(['1:12']))) === JSON.stringify([7, 1]), 'Знакомство не учитывает пройденное');
    assert(JSON.stringify(E.introDistances(4)) === JSON.stringify([8, 9]), 'Знакомство 4 уровня');
  });

  await test('Статистика сессии: точность, путаница и рекомендация', () => {
    const session = E.createSession();
    E.recordSession(session, 3, 3, true); E.recordSession(session, 3, 3, true);
    E.recordSession(session, 3, 4, false); E.recordSession(session, 5, 5, true);
    const summary = E.sessionSummary(session);
    assert(summary.answered === 4 && summary.correct === 3 && near(summary.accuracy, .75), 'Итоговая точность');
    assert(summary.rows.find(row => row.distance === 3).asked === 3 && summary.rows.find(row => row.distance === 3).correct === 2, 'Строка интервала');
    assert(summary.confusion && summary.confusion.text === 'м.3 → б.3' && summary.confusion.count === 1, 'Пара путаницы');
    assert(summary.recommendation.includes('м.3'), 'Рекомендация не про слабый интервал');
    const clean = E.createSession(); for (let i = 0; i < 4; i++) E.recordSession(clean, 7, 7, true);
    assert(E.sessionSummary(clean).recommendation.includes('следующий уровень'), 'Нет рекомендации повышения');
    assert(E.nearestDistance([1, 2, 3], 2.4) === 2, 'Ближайший интервал');
  });

  // Integration checks use an iframe with mocked audio, timers and storage.
  const page = await (await fetch('../intervals-tonal.html', { cache: 'no-store' })).text();
  const audioMock = `<script>window.IntervalAudioData={PIANO_MP3:Object.fromEntries(Array.from({length:31},(_,i)=>[48+i,''])),ELECTRONIC_MP3:{}}</script>`;
  const mock = `
    window.mock={now:0,serial:0,timers:new Map(),sources:[],decoded:0,values:new Map(),rows:[]};
    const m=window.mock;
    Object.defineProperty(window,'localStorage',{value:{getItem:k=>m.values.get(k)||null,setItem:(k,v)=>m.values.set(k,String(v)),removeItem:k=>m.values.delete(k)}});
    window.SolfegeProgress={tracker:id=>({record:row=>m.rows.push({...row,exercise:id}),reset(){}})};
    Object.defineProperty(performance,'now',{value:()=>m.now});
    window.setTimeout=(fn,delay=0)=>{const id=++m.serial;m.timers.set(id,{fn,at:m.now+delay});return id;};
    window.clearTimeout=id=>m.timers.delete(id);
    m.advance=ms=>{const end=m.now+ms;let runs=0;while(true){const next=[...m.timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];if(!next)break;if(++runs>1000)throw Error('Цикл таймеров');m.now=next[1].at;m.timers.delete(next[0]);next[1].fn();}m.now=end;for(const s of m.sources)if(!s.ended&&s.until<=m.now/1000){s.ended=true;s.onended?.();}};
    Math.random=()=>0.1;
    const param=()=>({value:1,setValueAtTime(v){this.value=v},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}});
    window.AudioContext=class{constructor(){this.state='running';this.destination={};}get currentTime(){return m.now/1000;}resume(){return Promise.resolve();}decodeAudioData(){const i=m.decoded++;return Promise.resolve({base:48+i%31});}createDynamicsCompressor(){return {threshold:param(),knee:param(),ratio:param(),attack:param(),release:param(),connect(){}};}createGain(){return {gain:param(),connect(){},disconnect(){}};}createBufferSource(){const s={kind:'note',playbackRate:param(),connect(){},disconnect(){},cancelled:false,start(at){this.at=at;this.midi=this.buffer.base+12*Math.log2(this.playbackRate.value);m.sources.push(this);},stop(at){if(at===undefined){this.cancelled=true;this.until=m.now/1000;}else this.until=at;}};return s;}createOscillator(){const s=this.createBufferSource();s.kind='signal';s.frequency=param();s.buffer={base:0};return s;}};
  `;
  async function fixture() {
    const frame = document.createElement('iframe');
    frame.style.cssText = 'width:432px;height:934px;border:0';
    const ready = new Promise(resolve => frame.onload = resolve);
    frame.srcdoc = page.replace('<head>', '<head><base href="' + new URL('../', location.href).href + '">')
      .replace('<script src="./interval-audio-data.js"></script>', audioMock)
      .replace('<script src="./progress-store.js?v=20261128-tonal"></script>', '<script>' + mock + '</script>');
    document.body.append(frame); await ready;
    const w = frame.contentWindow, d = frame.contentDocument, m = w.mock;
    const settle = () => new Promise(resolve => setTimeout(resolve, 0));
    const $ = id => d.getElementById(id);
    async function start() { $('start').click(); await settle(); await settle(); m.advance(2600); m.advance(2200); }
    return { frame, w, d, m, $, settle, start, close() { w.dispatchEvent(new w.Event('pagehide')); frame.remove(); } };
  }

  await test('Интеграция: каденция звучит до первого вопроса, ноты диатоничны', async () => {
    const f = await fixture();
    try {
      await f.start();
      const notes = f.m.sources.filter(s => s.kind === 'note');
      assert(notes.length >= 14, 'Нет каденции и вопроса');
      const cadence = notes.slice(0, 12);
      assert(cadence.every((s, i) => near(s.midi, [48, 52, 55, 53, 57, 60, 55, 59, 62, 48, 52, 55][i], .01)), 'Неверные аккорды каденции');
      const firstQuestion = notes[12], secondQuestion = notes[13];
      const scale = new Set(E.scaleNotes(f.w.TonalExercise.getKeyId()).map(n => n.midi));
      assert(scale.has(Math.round(firstQuestion.midi)) && scale.has(Math.round(secondQuestion.midi)), 'Ноты вопроса не из гаммы');
      assert(cadence.every(s => s.until <= firstQuestion.at + 1e-6), 'Вопрос начался до конца каденции');
      assert(f.w.TonalExercise.getState() === 'question', 'Нет вопроса после каденции');
      assert(f.w.TonalExercise.getCurrent().intro, 'Первый вопрос не знакомство');
    } finally { f.close(); }
  });

  await test('Интеграция: кнопка «Тоника» играет I–III–V текущей тональности', async () => {
    const f = await fixture();
    try {
      await f.start();
      const tonic = 48 + E.key(f.w.TonalExercise.getKeyId()).tonic, before = f.m.sources.length;
      f.$('tonic').click();
      const notes = f.m.sources.slice(before).filter(source => source.kind === 'note');
      assert(notes.length === 3, 'Тоника не из трёх звуков');
      assert(notes.every((source, i) => Math.round(source.midi) === [tonic, tonic + 4, tonic + 7][i]), 'Неверный тонический аккорд');
    } finally { f.close(); }
  });

  await test('Интеграция: три знакомства подряд только с новым интервалом', async () => {
    const f = await fixture();
    try {
      await f.start();
      assert(f.w.TonalExercise.getCurrent().distance === 12 && f.w.TonalExercise.getCurrent().intro, 'Нет знакомства с октавой');
      assert(f.w.TonalExercise.getIntroRemaining().get(12) === 3, 'Не три октавы в очереди');
      for (let i = 0; i < 3; i++) {
        const current = f.w.TonalExercise.getCurrent();
        assert(current.intro && current.distance === 12, 'Знакомство прервано вопросом ' + (i + 1));
        const button = f.d.querySelector('#answers .choice[data-interval="12"]');
        f.m.advance(2500);
        if (button.disabled) f.m.advance(2500);
        button.click(); f.m.advance(2500);
      }
      assert(!f.w.TonalExercise.getIntroRemaining().get(12), 'Октава не завершила знакомство');
      assert(f.w.TonalExercise.getCurrent().intro && f.w.TonalExercise.getCurrent().distance === 7, 'После октавы не квинта');
    } finally { f.close(); }
  });

  await test('Интеграция: состав кнопок и доступность «Между ступенями»', async () => {
    const f = await fixture();
    try {
      await f.start();
      assert(f.d.querySelectorAll('#answers .choice').length === 3, 'Уровень 1: не три кнопки');
      assert(f.$('levelSelect').value === '1', 'Уровень не 1');
      f.$('levelSelect').value = '3'; f.$('levelSelect').dispatchEvent(new f.w.Event('change'));
      assert(f.d.querySelectorAll('#answers .choice').length === 6, 'Уровень 3: не шесть кнопок');
      assert(f.d.querySelector('[data-type="between"]').disabled, 'Тип «между» открыт раньше 4 уровня');
      f.$('levelSelect').value = '4'; f.$('levelSelect').dispatchEvent(new f.w.Event('change'));
      assert(f.d.querySelectorAll('#answers .choice').length === 8, 'Уровень 4: не восемь кнопок');
      assert(!f.d.querySelector('[data-type="between"]').disabled, 'Тип «между» не открылся');
      const labels = [...f.d.querySelectorAll('#answers .choice')].map(b => b.textContent);
      assert(labels.includes('м. секста') && labels.includes('б. секста') && labels.includes('тритон') === false, 'Состав кнопок 4 уровня');
    } finally { f.close(); }
  });

  await test('Интеграция: первая ошибка без ассоциации, вторая подряд — с ассоциацией', async () => {
    const f = await fixture();
    try {
      await f.start();
      f.$('levelSelect').value = '3'; f.$('levelSelect').dispatchEvent(new f.w.Event('change'));
      f.m.advance(2600);
      f.w.TonalExercise.debug.clearIntro();
      f.w.TonalExercise.debug.forceNextDistance(3);
      f.w.TonalExercise.debug.nextQuestion();
      f.m.advance(2000);
      const wrong = () => { const b = f.d.querySelector('#answers .choice[data-interval="4"]'); if (b && !b.disabled) b.click(); };
      wrong(); f.m.advance(500);
      assert(f.$('feedback').textContent.includes('Правильный ответ'), 'Нет разбора первой ошибки');
      assert(!f.$('feedback').textContent.includes('Мелодия'), 'Ассоциация на первой ошибке');
      assert(f.w.TonalExercise.getRechecks().length === 1 && [2, 3].includes(f.w.TonalExercise.getRechecks()[0].due), 'Нет повторной проверки');
      f.$('hint').click(); f.m.advance(200);
      assert(f.$('feedback').textContent.includes('Подсказка'), 'Кнопка подсказки не играет');
      f.m.advance(6000);
      f.w.TonalExercise.debug.forceNextDistance(3); f.w.TonalExercise.debug.nextQuestion();
      f.m.advance(2000);
      wrong(); f.m.advance(500);
      assert(f.$('feedback').textContent.includes('Мелодия'), 'Нет ассоциации на второй ошибке');
    } finally { f.close(); }
  });

  await test('Интеграция: статистика пишется под intervals-tonal', async () => {
    const f = await fixture();
    try {
      await f.start();
      const current = f.w.TonalExercise.getCurrent();
      const button = f.d.querySelector(`#answers .choice[data-interval="${current.distance}"]`);
      f.m.advance(2000);
      button.click(); f.m.advance(500);
      assert(f.m.rows.length === 1, 'Нет записи ответа');
      assert(f.m.rows[0].exercise === 'intervals-tonal' && f.m.rows[0].correct === true, 'Чужая запись статистики');
      assert(f.m.rows[0].expected && f.m.rows[0].actual, 'Нет названий интервалов');
    } finally { f.close(); }
  });

  await test('Интеграция: повтор разбора не записывает второй ответ', async () => {
    const f = await fixture();
    try {
      await f.start();
      f.$('levelSelect').value = '3'; f.$('levelSelect').dispatchEvent(new f.w.Event('change'));
      f.m.advance(2600);
      f.w.TonalExercise.debug.clearIntro(); f.w.TonalExercise.debug.forceNextDistance(3); f.w.TonalExercise.debug.nextQuestion();
      f.m.advance(2000);
      f.d.querySelector('#answers .choice[data-interval="4"]').click(); f.m.advance(500);
      assert(f.w.TonalExercise.getState() === 'review' && f.$('total').textContent === '1', 'Нет разбора ошибки');
      f.$('repeat').click(); f.m.advance(200);
      assert(f.w.TonalExercise.getSession().answered === 1 && f.$('total').textContent === '1', 'Повтор записал второй ответ');
      assert(f.$('feedback').textContent.includes('Правильный ответ'), 'Повтор потерял разбор');
    } finally { f.close(); }
  });

  await test('Интеграция: 24 ответа дают итоги и кнопку «Ещё»', async () => {
    const f = await fixture();
    try {
      await f.start();
      const state = () => f.w.TonalExercise.getState();
      for (let i = 0; i < 24; i++) {
        let clicked = false;
        for (let guard = 0; guard < 8 && !clicked; guard++) {
          if (state() === 'summary') break;
          const question = f.w.TonalExercise.getCurrent();
          const button = question && f.d.querySelector(`#answers .choice[data-interval="${question.distance}"]`);
          if (state() === 'question' && button && !button.disabled) { button.click(); f.m.advance(2500); clicked = true; }
          else f.m.advance(3000);
        }
        assert(clicked || state() === 'summary', 'Не дождались вопроса ' + (i + 1));
      }
      f.m.advance(6000);
      assert(!f.$('summary').hidden, 'Нет итогов после 24 ответов');
      assert(f.$('summaryMain').textContent.includes('24'), 'Не 24 вопроса в итогах');
      assert(f.$('summaryTable').children.length > 0, 'Нет точности по интервалам');
      assert(f.$('summaryRecommendation').textContent.length > 0, 'Нет рекомендации');
      f.$('again').click(); f.m.advance(1000);
      assert(f.$('summary').hidden && f.w.TonalExercise.getSession().answered === 0, '«Ещё» не начал новую сессию');
    } finally { f.close(); }
  });

  await test('Интеграция: недоступные MIDI и микрофон не ломают упражнение', async () => {
    const f = await fixture();
    try {
      Object.defineProperty(f.w.navigator, 'requestMIDIAccess', { value: undefined, configurable: true });
      Object.defineProperty(f.w.navigator, 'mediaDevices', { value: undefined, configurable: true });
      await f.start();
      const select = f.$('answerMode');
      select.value = 'midi'; select.dispatchEvent(new f.w.Event('change')); await f.settle(); await f.settle();
      assert(select.value === 'buttons', 'MIDI не вернул кнопки');
      assert(!f.d.querySelector('#answers').hidden, 'Кнопки исчезли после недоступного MIDI');
      select.value = 'voice'; select.dispatchEvent(new f.w.Event('change')); await f.settle(); await f.settle();
      assert(select.value === 'buttons', 'Микрофон не вернул кнопки');
      assert(f.w.TonalExercise.getState() === 'question', 'Упражнение сломалось');
    } finally { f.close(); }
  });

  window.__tonalResults = results;
  document.getElementById('results').textContent = results.map(result =>
    (result.ok ? 'OK ' : 'ОШИБКА ') + result.name + (result.error ? ': ' + result.error : '')
  ).join('\n');
})();