/* Interval-in-key exercise: audio, cadence, levels, MIDI/microphone and session UI. */
(() => {
  'use strict';
  const E = window.TonalEngine;
  const $ = id => document.getElementById(id);
  const levelSelect = $('levelSelect'), answerSelect = $('answerMode'), endlessInput = $('endless');
  const answers = $('answers'), perform = $('perform'), summary = $('summary');
  const card = $('card'), orb = $('orb');
  const progress = window.SolfegeProgress?.tracker('intervals-tonal') || { record() {}, reset() {} };
  const associations = window.IntervalAssociations;
  const recordKey = 'intervals-tonal-record', adaptiveKey = 'intervals-tonal-adaptive';
  const levelsKey = 'intervals-tonal-levels', introKey = 'intervals-tonal-intro';
  const dirCode = direction => direction === 1 ? 'up' : direction === -1 ? 'down' : 'together';

  let ctx = null, limiter = null, loading = false, loadingBank = null;
  const buffers = new Map();
  const liveSources = new Set();
  let state = 'idle', keyId = null, level = 1, direction = 1, questionType = 'tonic', answerMode = 'buttons';
  let current = null, session = E.createSession(), blockAnswered = 0, endless = false;
  let rates = loadJson(adaptiveKey, {}), levelResults = loadJson(levelsKey, {}), record = loadNumber(recordKey, 0);
  let introduced = new Set(loadJson(introKey, []));
  let introRemaining = new Map(), rechecks = E.createRecheckQueue();
  let lastDistance = null, lastError = null, forcedNextDistance = null, pendingLevel = null;
  let answerReady = false, answerLocked = false, sessionOver = false;
  let playTimer = null, endTimer = null, cadenceTimer = null, transitionTimer = null;
  let busyUntil = -Infinity, reviewAutoHint = false, autoHintWasShown = false;
  let midiAccess = null, midiInputs = [], midiActive = new Set();
  let micStream = null, micSource = null, micAnalyser = null, micRaf = null, micDetector = null, micStability = null;
  const associationPlayer = associations.createPlayer(note);

  function loadJson(key, fallback) {
    try { const value = JSON.parse(localStorage.getItem(key) || 'null'); return value && typeof value === 'object' ? value : fallback; }
    catch { return fallback; }
  }
  function loadNumber(key, fallback) {
    try { const value = Number(localStorage.getItem(key)); return Number.isFinite(value) ? value : fallback; }
    catch { return fallback; }
  }
  function saveJson(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }
  function saveNumber(key, value) { try { localStorage.setItem(key, String(value)); } catch {} }

  function setStatus(title, hint) { $('prompt').textContent = title; $('hintText').textContent = hint; }
  function syncMetrics() {
    $('total').textContent = session.answered;
    $('correct').textContent = session.correct;
    $('accuracy').textContent = session.answered ? Math.round(session.correct / session.answered * 100) + '%' : '—';
    $('streak').textContent = session.streak;
    $('record').textContent = record;
  }
  function clearFeedback() {
    $('feedback').textContent = ''; $('feedback').className = 'feedback';
    $('explanation').textContent = '';
    card.classList.remove('good', 'bad', 'summary-mode');
    $('feedbackIcon').textContent = '';
    for (const button of answers.querySelectorAll('.choice')) button.classList.remove('correct', 'wrong');
  }
  function setButtons(enabled) { for (const button of answers.querySelectorAll('.choice')) button.disabled = !enabled; }
  function refreshControls() {
    const questionReady = state === 'question' && answerReady && !answerLocked;
    if (answerMode === 'midi') { $('performTitle').textContent = 'Сыграйте верхний звук'; $('performStatus').textContent = 'MIDI: точное совпадение полутона.'; }
    if (answerMode === 'voice') { $('performTitle').textContent = 'Спойте верхний звук'; $('performStatus').textContent = 'Микрофон: ±60 центов, 3 стабильных кадра.'; }
    setButtons(answerMode === 'buttons' && questionReady);
    $('repeat').disabled = loading || !(state === 'review' || (state === 'question' && answerReady));
    $('repeat').setAttribute('aria-label', state === 'review' ? 'Повторить объяснение' : state === 'cadence' ? 'Повторить тональность' : 'Повторить вопрос');
    $('repeatLabel').textContent = state === 'review' ? 'Повторить объяснение' : state === 'cadence' ? 'Повторить тональность' : 'Повторить вопрос';
    $('tonic').disabled = loading || !keyId || state === 'summary' || state === 'idle';
    $('hint').disabled = loading || !current || direction !== 1 || current.noHint || state === 'summary' || state === 'idle' || state === 'cadence';
    $('hint').title = $('hint').disabled ? 'Подсказка доступна для восходящих вопросов без повторной проверки' : 'Мелодия-ассоциация';
    if (answerMode === 'buttons') { answers.hidden = false; perform.hidden = true; }
    else { answers.hidden = true; perform.hidden = false; }
    updateModeButtons();
  }
  function updateModeButtons() {
    for (const button of document.querySelectorAll('[data-dir]')) {
      const active = Number(button.dataset.dir) === direction;
      button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
    }
    for (const button of document.querySelectorAll('[data-type]')) {
      const active = button.dataset.type === questionType;
      button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
      button.disabled = level < 4 && button.dataset.type === 'between';
    }
    answerSelect.value = answerMode;
    endlessInput.checked = endless;
    levelSelect.value = String(level);
  }

  function fillLevels() {
    levelSelect.replaceChildren();
    for (const item of E.LEVELS) {
      const option = document.createElement('option');
      option.value = String(item.level);
      option.textContent = item.level + ' · ' + item.title;
      levelSelect.append(option);
    }
  }
  function buildButtons() {
    answers.replaceChildren();
    const distances = [...E.level(level).intervals].sort((a, b) => a - b);
    for (const distance of distances) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'choice'; button.dataset.interval = String(distance);
      button.textContent = E.INTERVALS[distance].button;
      button.setAttribute('aria-label', E.INTERVALS[distance].name);
      button.disabled = true;
      button.addEventListener('click', () => answerByButton(distance));
      answers.append(button);
    }
  }
  function resetIntro() {
    introRemaining = new Map(E.introDistances(level, introduced).map(distance => [distance, E.INTRO_REPEATS]));
  }
  function nextIntroDistance() {
    for (const distance of E.level(level).newIntervals) if ((introRemaining.get(distance) || 0) > 0) return distance;
    return null;
  }
  function completeIntro(distance) {
    const remaining = (introRemaining.get(distance) || 0) - 1;
    if (remaining <= 0) {
      introRemaining.delete(distance);
      introduced.add(level + ':' + distance);
      saveJson(introKey, [...introduced]);
    } else introRemaining.set(distance, remaining);
  }

  function unlock() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -1.5; limiter.knee.value = 0; limiter.ratio.value = 12;
      limiter.attack.value = .002; limiter.release.value = .12;
      limiter.connect(ctx.destination);
    }
    return ctx.state === 'suspended' ? ctx.resume() : Promise.resolve();
  }
  function ensureBank() {
    if (buffers.size === 31) return Promise.resolve();
    if (loadingBank) return loadingBank;
    const data = window.IntervalAudioData?.PIANO_MP3;
    if (!data) return Promise.reject(new Error('Нет аудиоданных'));
    loadingBank = Promise.all(Object.entries(data).map(async ([midi, base64]) => {
      const raw = atob(base64), bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      return [Number(midi), await ctx.decodeAudioData(bytes.buffer)];
    })).then(entries => { buffers.clear(); for (const [midi, buffer] of entries) buffers.set(midi, buffer); })
      .catch(error => { loadingBank = null; throw error; });
    return loadingBank;
  }
  function note(midi, start, duration, volume = 1.15) {
    const base = Math.max(48, Math.min(78, midi)), buffer = buffers.get(base);
    if (!buffer) throw new Error('Нет звукового сэмпла');
    const source = ctx.createBufferSource(), gain = ctx.createGain(), fade = Math.min(.05, duration * .17);
    source.buffer = buffer;
    source.playbackRate.setValueAtTime(Math.pow(2, (midi - base) / 12), start);
    gain.gain.setValueAtTime(.0001, start); gain.gain.linearRampToValueAtTime(volume, start + .006);
    gain.gain.setValueAtTime(volume, start + Math.max(.007, duration - fade)); gain.gain.linearRampToValueAtTime(.0001, start + duration);
    source.connect(gain); gain.connect(limiter); source.start(start); source.stop(start + duration + .005);
    liveSources.add(source);
    source.onended = () => { liveSources.delete(source); source.disconnect(); gain.disconnect(); };
    return source;
  }
  function feedbackSound(ok) {
    if (!$('sounds').checked || !ctx) return;
    const t = ctx.currentTime + .01;
    const tones = ok ? [[740, 0, .13, .1], [1110, .115, .22, .12]] : [[260, 0, .19, .13], [195, .115, .22, .1]];
    for (const [frequency, offset, duration, volume] of tones) {
      const source = ctx.createOscillator(), gain = ctx.createGain(), start = t + offset;
      source.type = ok ? 'sine' : 'triangle'; source.frequency.value = frequency;
      gain.gain.setValueAtTime(.0001, start); gain.gain.exponentialRampToValueAtTime(volume, start + .018); gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
      source.connect(gain); gain.connect(limiter); source.start(start); source.stop(start + duration + .03); liveSources.add(source);
      source.onended = () => { liveSources.delete(source); source.disconnect(); gain.disconnect(); };
    }
    busyUntil = Math.max(busyUntil, performance.now() + 400);
  }
  function clearTimer(name) { if (name !== null) { clearTimeout(name); return null; } return null; }
  function cancelPlayback() {
    playTimer = clearTimer(playTimer); endTimer = clearTimer(endTimer); cadenceTimer = clearTimer(cadenceTimer);
    associationPlayer.cancel(); stopListening();
    for (const source of liveSources) { try { source.stop(); } catch {} }
    liveSources.clear(); busyUntil = -Infinity; orb.classList.remove('playing'); answerReady = false;
  }
  function cancelTransition() { transitionTimer = clearTimer(transitionTimer); }
  function cancelAll() { cancelTransition(); cancelPlayback(); }

  function scheduleNext(delay) {
    cancelTransition();
    transitionTimer = setTimeout(() => { transitionTimer = null; advance(); }, Math.max(0, delay));
  }
  function begin() {
    if (state !== 'idle' || loading) return;
    loading = true; $('start').disabled = true; $('start').querySelector('small').textContent = 'ЗАГРУЗКА…';
    setStatus('Загрузка звука…', 'Подготовьтесь слушать.');
    unlock().then(ensureBank).then(() => {
      loading = false; $('start').disabled = false; $('start').querySelector('small').textContent = 'НАЧАТЬ';
      startSession();
    }).catch(error => {
      console.error('Не удалось загрузить звук:', error); loading = false; state = 'idle';
      $('start').disabled = false; $('start').querySelector('small').textContent = 'НАЧАТЬ';
      setStatus('Не удалось загрузить звук.', 'Попробуйте нажать «Начать» ещё раз.');
    });
  }
  function startSession() {
    if (pendingLevel && pendingLevel <= 7) { level = pendingLevel; pendingLevel = null; }
    cancelAll(); stopMic(); stopMidi();
    try { progress.reset(); } catch {}
    session = E.createSession(); sessionOver = false; blockAnswered = 0; current = null; lastDistance = null; lastError = null;
    rechecks = E.createRecheckQueue(); forcedNextDistance = null; answerLocked = false;
    summary.hidden = true; card.classList.remove('summary-mode', 'idle'); clearFeedback(); buildButtons(); resetIntro(); syncMetrics(); beginBlock(); restoreAnswerMode();
  }
  function beginBlock() {
    cancelAll();
    keyId = E.chooseKey(keyId).id;
    blockAnswered = 0; current = null; answerReady = false; state = 'cadence';
    setStatus('Слушайте тональность: ' + E.key(keyId).name, 'Каденция I–IV–V–I');
    refreshControls(); playCadence();
  }
  function playCadence() {
    if (!ctx || !keyId) return;
    cancelPlayback(); state = 'cadence';
    const t = ctx.currentTime + .04, chords = E.cadence(keyId), volume = 1.15 / 3;
    for (let i = 0; i < chords.length; i++) for (const midi of chords[i]) note(midi, t + i * E.CADENCE_STEP, E.CHORD_DURATION, volume);
    const total = E.CADENCE_TOTAL + .12;
    busyUntil = performance.now() + total * 1000; orb.classList.add('playing');
    cadenceTimer = setTimeout(() => {
      cadenceTimer = null; orb.classList.remove('playing');
      if (state === 'cadence') askQuestion();
    }, total * 1000);
    refreshControls();
  }
  function makeCurrent() {
    let forced = forcedNextDistance;
    if (forced !== null) forcedNextDistance = null;
    let intro = false, recheck = false, noHint = false, avoid = null;
    if (forced === null) {
      const introDistance = nextIntroDistance();
      if (introDistance !== null) { forced = introDistance; intro = true; }
      else {
        E.tickRechecks(rechecks);
        const due = E.takeDueRecheck(rechecks);
        if (due) { forced = due.distance; avoid = due.avoid; recheck = true; noHint = true; }
      }
    }
    let distance = forced;
    if (distance === null) distance = E.chooseDistance({ available: E.level(level).intervals, rates, last: lastDistance });
    let question = E.makeQuestion({ keyId, distance, type: questionType, direction, avoid });
    if (!question) {
      distance = E.chooseDistance({ available: E.level(level).intervals.filter(d => d !== distance), rates, last: lastDistance });
      question = E.makeQuestion({ keyId, distance, type: questionType, direction });
    }
    if (!question) return null;
    question = Object.freeze({ ...question, intro, recheck, noHint });
    lastDistance = question.distance;
    return question;
  }
  function askQuestion() {
    if (sessionOver || state === 'summary') return;
    cancelPlayback(); cancelTransition();
    current = makeCurrent();
    if (!current) { setStatus('Не удалось построить вопрос.', 'Смените уровень или направление.'); return; }
    state = 'question'; answerReady = false; answerLocked = false; reviewAutoHint = false; autoHintWasShown = false;
    $('performLive').textContent = '';
    clearFeedback();
    if (current.intro) setStatus('Слушайте: ' + E.INTERVALS[current.distance].short, 'Знакомство с интервалом · ' + E.key(keyId).name);
    else if (current.recheck) setStatus('Какой интервал звучит?', 'Повторная проверка · ' + E.key(keyId).name);
    else setStatus('Какой интервал звучит?', E.key(keyId).name + ' · ' + E.directionLabel(direction) + (current.fallback ? ' · тритон между ступенями' : ''));
    refreshControls(); playQuestion();
  }
  function playQuestion() {
    if (!current || !ctx) return;
    cancelPlayback();
    const t = ctx.currentTime + .035, volume = current.harmonic ? 1.15 / 2 : 1.15;
    let duration;
    if (current.harmonic) {
      note(current.lower, t, 1.5, volume); note(current.upper, t, 1.5, volume); duration = 1.5;
    } else {
      note(current.notes[0], t, .95, volume); note(current.notes[1], t + .82, 1.0, volume); duration = 1.82;
    }
    busyUntil = performance.now() + 35 + duration * 1000; orb.classList.add('playing');
    endTimer = setTimeout(() => {
      endTimer = null; orb.classList.remove('playing');
      if (state === 'question') { answerReady = true; refreshControls(); startListening(); }
    }, 35 + duration * 1000);
    refreshControls();
  }
  function repeatPlayback() {
    if (state === 'cadence') { playCadence(); return; }
    if (state === 'question') { cancelTransition(); playQuestion(); return; }
    if (state === 'review') { cancelTransition(); playReview(false); }
  }
  function playTonic() {
    if (!ctx || !keyId || loading) return;
    const previous = state;
    if (previous !== 'cadence' && previous !== 'question' && previous !== 'review') return;
    cancelAll(); state = previous; answerReady = false;
    const t = ctx.currentTime + .04, chord = E.tonicChord(keyId), volume = 1.15 / 3;
    for (const midi of chord) note(midi, t, 1.1, volume);
    const duration = 1.22;
    busyUntil = performance.now() + duration * 1000; orb.classList.add('playing');
    endTimer = setTimeout(() => {
      endTimer = null; orb.classList.remove('playing');
      if (previous === 'cadence') { state = 'cadence'; askQuestion(); }
      else if (previous === 'question') { state = 'question'; playQuestion(); }
      else if (previous === 'review') scheduleNext(900);
    }, duration * 1000);
    refreshControls();
    if (previous === 'question' || previous === 'cadence') setStatus('Тоника: ' + E.key(keyId).name, 'Сейчас прозвучит вопрос снова.');
  }
  function playHint() {
    if (!current || direction !== 1 || current.noHint || state === 'summary' || state === 'idle' || state === 'cadence') return;
    cancelTransition(); cancelPlayback();
    $('feedback').querySelector('.association-name')?.remove();
    const t = ctx.currentTime + .04;
    associationPlayer.play(current.distance, current.lower, t);
    $('feedback').append(associationLabel(current.distance, $('feedback').textContent ? ' · Подсказка: ' : 'Подсказка: '));
    if (!$('explanation').textContent) $('explanation').textContent = 'Мелодия играет от нижнего звука.';
    const duration = associations.duration(current.distance);
    busyUntil = performance.now() + (duration + .2) * 1000; orb.classList.add('playing');
    endTimer = setTimeout(() => {
      endTimer = null; orb.classList.remove('playing');
      if (state === 'question') { answerReady = true; refreshControls(); startListening(); }
      else if (state === 'review') scheduleNext(900);
    }, (duration + .2) * 1000);
    refreshControls();
  }

  function answerByButton(distance) {
    if (state !== 'question' || !answerReady || answerLocked || answerMode !== 'buttons') return;
    submit(distance, distance === current.distance, distance);
  }
  function actualDistanceFromPlayed(played) {
    const semitones = Math.abs(played - current.lower);
    return E.nearestDistance(E.level(level).intervals, semitones);
  }
  function submit(expected, ok, actual) {
    if (state !== 'question' || !answerReady || answerLocked) return;
    answerLocked = true; answerReady = false; state = 'review'; stopListening();
    const distance = current.distance;
    if (!ok && actual === distance) actual = null;
    blockAnswered++;
    session = E.recordSession(session, distance, actual, ok);
    rates[distance] = E.updateRate(E.rateOf(rates, distance), ok); saveJson(adaptiveKey, rates);
    const history = E.nextLevelResult(levelResults[level], ok); levelResults[level] = history; saveJson(levelsKey, levelResults);
    if (E.shouldAdvance(history, level)) pendingLevel = level + 1;
    if (session.streak > record) { record = session.streak; saveNumber(recordKey, record); }
    try {
      progress.record({
        correct: ok, mode: { level, direction: dirCode(direction), answer: answerMode, type: current.type, timbre: 'piano' },
        task: distance + ':' + dirCode(direction) + ':' + current.type,
        expected: E.INTERVALS[distance].name,
        actual: Number.isFinite(actual) ? E.INTERVALS[actual].name : '—'
      });
    } catch {}
    syncMetrics(); setButtons(false);
    const correctButton = answers.querySelector('[data-interval="' + distance + '"]');
    const actualButton = Number.isFinite(actual) ? answers.querySelector('[data-interval="' + actual + '"]') : null;
    if (correctButton) correctButton.classList.add('correct');
    if (!ok && actualButton) actualButton.classList.add('wrong');
    card.classList.add(ok ? 'good' : 'bad'); $('feedbackIcon').textContent = ok ? '✓' : '×';
    $('feedback').textContent = ok ? 'Верно!' : 'Не совсем. Правильный ответ: ' + E.INTERVALS[distance].short + '.';
    $('feedback').className = 'feedback ' + (ok ? 'good' : 'bad');
    $('explanation').textContent = E.questionText(current) + ' · ступени ' + current.lowerDegree + '–' + current.upperDegree + (current.fallback ? ' · тритон между ступенями' : '');
    if (current.intro) completeIntro(distance);
    const secondSame = !ok && lastError && lastError.distance === distance;
    if (ok) lastError = null; else lastError = { distance };
    if (ok) {
      burstConfetti(); feedbackSound(true);
      setStatus('Интервал определён', 'Следующее задание начнётся автоматически.');
      scheduleNext(1800);
    } else {
      feedbackSound(false);
      reviewAutoHint = secondSame && direction === 1 && !current.noHint;
      setStatus('Разберём интервал', 'Нижний → верхний → вместе.');
      playReview(reviewAutoHint);
      E.scheduleRecheck(rechecks, distance, { lower: current.lower, upper: current.upper });
    }
    refreshControls();
  }
  function playReview(autoHint) {
    if (!current || !ctx) return;
    cancelTransition(); cancelPlayback();
    $('feedback').querySelector('.association-name')?.remove();
    const t = ctx.currentTime + .035, volume = 1.15;
    note(current.lower, t, .8, volume); note(current.upper, t + .82, .8, volume);
    note(current.lower, t + 1.7, 1.2, volume / 2); note(current.upper, t + 1.7, 1.2, volume / 2);
    let duration = 2.95;
    let autoDuration = 0;
    if (autoHint) {
      associationPlayer.play(current.distance, current.lower, t + duration + .35);
      autoDuration = associations.duration(current.distance) + .35;
      autoHintWasShown = true;
      $('feedback').append(associationLabel(current.distance));
    }
    busyUntil = performance.now() + (duration + autoDuration + .2) * 1000; orb.classList.add('playing');
    endTimer = setTimeout(() => {
      endTimer = null; orb.classList.remove('playing');
      if (state === 'review') {
        answerReady = false; refreshControls();
        scheduleNext(900);
      }
    }, (duration + autoDuration + .2) * 1000);
    refreshControls();
  }
  function associationLabel(distance, prefix = ' · Мелодия: ') {
    const info = associations.get(distance);
    const label = document.createElement('span'); label.className = 'association-name';
    label.textContent = prefix + (info?.name || E.INTERVALS[distance].name);
    return label;
  }
  function advance() {
    if (session.answered >= E.DEFAULT_SESSION && !endless) { showSummary(); return; }
    if (pendingLevel) {
      level = pendingLevel; pendingLevel = null; rechecks = E.createRecheckQueue(); lastError = null; lastDistance = null;
      buildButtons(); resetIntro(); updateModeButtons();
      beginBlock(); return;
    }
    if (blockAnswered >= 10) { beginBlock(); return; }
    askQuestion();
  }
  function showSummary() {
    sessionOver = true; state = 'summary'; cancelAll(); stopMic(); stopMidi(); setButtons(false);
    card.classList.add('summary-mode'); summary.hidden = false;
    const result = E.sessionSummary(session);
    $('summaryMain').textContent = result.answered + ' вопросов · ' + result.correct + ' верно · ' + Math.round(result.accuracy * 100) + '%.';
    const table = $('summaryTable'); table.replaceChildren();
    for (const row of result.rows) {
      const line = document.createElement('div'); line.className = 'summary-row';
      const name = document.createElement('b'); name.textContent = row.short;
      const value = document.createElement('span'); value.textContent = row.correct + '/' + row.asked + ' · ' + Math.round(row.accuracy * 100) + '%';
      line.append(name, value); table.append(line);
    }
    if (!result.rows.length) { const empty = document.createElement('p'); empty.textContent = 'Пока нет ответов.'; table.append(empty); }
    $('summaryConfusion').textContent = result.confusion ? 'Чаще всего путали: ' + result.confusion.text + ' (' + result.confusion.count + ').' : 'Частых пар путаницы нет.';
    $('summaryRecommendation').textContent = result.recommendation;
    setStatus('Сессия завершена', 'Разберите итоги и нажмите «Ещё».');
    refreshControls();
  }
  function resetExercise() {
    cancelAll(); stopMic(); stopMidi(); loading = false;
    state = 'idle'; session = E.createSession(); current = null; keyId = null; blockAnswered = 0;
    sessionOver = false; pendingLevel = null; lastError = null; lastDistance = null; rechecks = E.createRecheckQueue();
    rates = {}; levelResults = {}; introduced = new Set(); record = 0; introRemaining = new Map();
    for (const key of [adaptiveKey, levelsKey, introKey, recordKey]) { try { localStorage.removeItem(key); } catch {} }
    try { progress.reset(); } catch {}
    summary.hidden = true; card.classList.remove('summary-mode'); card.classList.add('idle');
    clearFeedback(); buildButtons(); syncMetrics();
    $('start').disabled = false; $('start').querySelector('small').textContent = 'НАЧАТЬ';
    setStatus('Слушайте два звука.', 'Выберите уровень и нажмите «Начать».');
    refreshControls();
  }

  function setLevel(number) {
    const next = Math.max(1, Math.min(7, Number(number)));
    if (next === level) return;
    level = next; if (level < 4 && questionType === 'between') questionType = 'tonic';
    cancelAll(); stopListening(); current = null; rechecks = E.createRecheckQueue(); lastError = null; lastDistance = null; pendingLevel = null;
    buildButtons(); resetIntro(); updateModeButtons();
    if (state !== 'idle' && state !== 'summary') { blockAnswered = 0; beginBlock(); }
    else refreshControls();
  }
  function setDirection(next) {
    const value = Number(next);
    if (value === direction) return;
    direction = value; updateModeButtons();
    if (state === 'question' || state === 'review') { cancelAll(); askQuestion(); }
    else refreshControls();
  }
  function setQuestionType(next) {
    if (next === 'between' && level < 4) return;
    questionType = next; updateModeButtons();
    if (state === 'question' || state === 'review') { cancelAll(); askQuestion(); }
    else refreshControls();
  }
  async function setAnswerMode(next) {
    if (next === answerMode) return;
    answerMode = next; stopListening(); $('performLive').textContent = '';
    if (next !== 'voice') stopMic();
    if (next !== 'midi') stopMidi();
    if (state === 'idle' || state === 'summary') { updateModeButtons(); refreshControls(); return; }
    if (next === 'midi') { const ok = await initMidi(); if (!ok) { answerMode = 'buttons'; stopMidi(); setStatus('MIDI недоступен.', 'Отвечайте кнопками или выберите микрофон.'); } }
    if (next === 'voice') { const ok = await initMic(); if (!ok) { answerMode = 'buttons'; stopMic(); setStatus('Микрофон недоступен.', 'Разрешите доступ или отвечайте кнопками.'); } }
    updateModeButtons(); refreshControls();
    if (state === 'question') { cancelAll(); playQuestion(); }
    else if (state === 'review') { cancelAll(); playReview(false); }
  }
  function restoreAnswerMode() {
    if (answerMode === 'midi') initMidi().then(ok => {
      if (!ok) { answerMode = 'buttons'; updateModeButtons(); refreshControls(); setStatus('MIDI недоступен.', 'Отвечайте кнопками или выберите микрофон.'); }
    });
    if (answerMode === 'voice') initMic().then(ok => {
      if (!ok) { answerMode = 'buttons'; updateModeButtons(); refreshControls(); setStatus('Микрофон недоступен.', 'Разрешите доступ или отвечайте кнопками.'); }
    });
  }
  async function initMidi() {
    if (!navigator.requestMIDIAccess) return false;
    try {
      midiAccess = await navigator.requestMIDIAccess();
      attachMidi();
      midiAccess.onstatechange = attachMidi;
      return true;
    } catch { midiAccess = null; return false; }
  }
  function attachMidi() {
    if (!midiAccess) return;
    for (const input of midiInputs) input.onmidimessage = null;
    midiInputs = [...midiAccess.inputs.values()];
    for (const input of midiInputs) input.onmidimessage = onMidiMessage;
    if (!midiInputs.length && answerMode === 'midi') $('performLive').textContent = 'MIDI-клавиатура не найдена — подключите её или выберите «Кнопки».';
  }
  function stopMidi() { for (const input of midiInputs) input.onmidimessage = null; midiInputs = []; midiActive.clear(); }
  function onMidiMessage(event) {
    if (answerMode !== 'midi' || state !== 'question' || !answerReady || answerLocked) return;
    const data = event.data, status = data[0] & 0xf0, midi = data[1], velocity = data[2];
    if (status === 0x90 && velocity > 0) {
      if (midiActive.has(midi)) return; midiActive.add(midi);
      if (E.midiMatches(midi, current.target)) submit(current.distance, true, current.distance);
      else submit(current.distance, false, actualDistanceFromPlayed(midi));
    } else if (status === 0x80 || (status === 0x90 && velocity === 0)) midiActive.delete(midi);
  }
  async function initMic() {
    if (!navigator.mediaDevices?.getUserMedia) return false;
    try {
      await unlock();
      micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false } });
      micSource = ctx.createMediaStreamSource(micStream); micAnalyser = ctx.createAnalyser(); micAnalyser.fftSize = 2048;
      micSource.connect(micAnalyser);
      micDetector = window.PitchDetector.detector(); micStability = window.PitchDetector.stability({ minClarity: .9, maxDrift: 60, allowedGaps: 1 });
      return true;
    } catch { stopMic(); return false; }
  }
  function stopListening() { if (micRaf !== null) { cancelAnimationFrame(micRaf); micRaf = null; } }
  function startListening() {
    if (answerMode !== 'voice' || state !== 'question' || !answerReady || answerLocked || !micAnalyser) return;
    stopListening(); micStability?.reset();
    const buffer = new Float32Array(micAnalyser.fftSize), threshold = .008;
    const loop = () => {
      if (answerMode !== 'voice' || state !== 'question' || !answerReady || answerLocked) { micRaf = null; return; }
      micAnalyser.getFloatTimeDomainData(buffer);
      const level = window.PitchDetector.rms(buffer), pitch = micDetector(buffer, ctx.sampleRate);
      const stable = micStability.update(pitch, level, threshold, 440);
      if (pitch.frequency > 0 && pitch.clarity > .8) {
        const n = window.PitchDetector.note(pitch.frequency);
        $('performLive').textContent = n ? 'Слышу: ' + E.noteNameWithOctave(n.midi, keyId) + (Math.abs(n.cents) > 20 ? (n.cents > 0 ? ' +' : ' −') + Math.abs(Math.round(n.cents)) + ' ц.' : '') : '';
      } else $('performLive').textContent = '';
      if (stable) {
        const detected = stable.midi + stable.cents / 100;
        if (E.voiceMatches(stable.midi, stable.cents, current.target)) { submit(current.distance, true, current.distance); return; }
        submit(current.distance, false, actualDistanceFromPlayed(Math.round(detected))); return;
      }
      micRaf = requestAnimationFrame(loop);
    };
    micRaf = requestAnimationFrame(loop);
  }
  function stopMic() {
    stopListening();
    if (micStream) { for (const track of micStream.getTracks()) try { track.stop(); } catch {} }
    if (micSource) { try { micSource.disconnect(); } catch {} }
    micStream = null; micSource = null; micAnalyser = null; micDetector = null; micStability = null;
  }

  function burstConfetti() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const a = card.getBoundingClientRect(), b = orb.getBoundingClientRect();
    for (let i = 0; i < 28; i++) {
      const p = document.createElement('i'), angle = i * Math.PI / 14, r = 85 + Math.random() * 125;
      p.setAttribute('aria-hidden', 'true');
      p.style.cssText = `position:absolute;pointer-events:none;z-index:2;left:${b.left - a.left + b.width / 2}px;top:${b.top - a.top + b.height / 2}px;width:6px;height:10px;border-radius:2px;background:${['#b9f7ce', '#f8d36c', '#f4a0b5', '#95c6ff', '#ddd1ff'][i % 5]}`;
      card.append(p);
      p.animate([{ transform: 'translate(0,0)', opacity: 1 }, { transform: `translate(${Math.cos(angle) * r}px,${Math.sin(angle) * r + 27}px) rotate(${i * 33}deg)`, opacity: 0 }], { duration: 650, easing: 'cubic-bezier(.2,.72,.28,1)' }).onfinish = () => p.remove();
    }
  }

  $('start').addEventListener('click', begin);
  $('repeat').addEventListener('click', repeatPlayback);
  $('tonic').addEventListener('click', playTonic);
  $('hint').addEventListener('click', playHint);
  $('reset').addEventListener('click', resetExercise);
  $('again').addEventListener('click', startSession);
  levelSelect.addEventListener('change', () => setLevel(levelSelect.value));
  answerSelect.addEventListener('change', () => setAnswerMode(answerSelect.value));
  endlessInput.addEventListener('change', () => { endless = endlessInput.checked; });
  for (const button of document.querySelectorAll('[data-dir]')) button.addEventListener('click', () => setDirection(button.dataset.dir));
  for (const button of document.querySelectorAll('[data-type]')) button.addEventListener('click', () => setQuestionType(button.dataset.type));
  window.addEventListener('keydown', event => {
    if (event.target.matches('input,select,textarea')) return;
    if (event.code === 'Space') { event.preventDefault(); if (!event.repeat) repeatPlayback(); return; }
    if (event.code === 'KeyT') { event.preventDefault(); if (!event.repeat) playTonic(); return; }
    if (answerMode !== 'buttons' || state !== 'question' || !answerReady) return;
    if (/^[1-9]$/.test(event.key) || event.key === '0') {
      const index = event.key === '0' ? 9 : Number(event.key) - 1;
      const button = answers.querySelectorAll('.choice')[index];
      if (button) { event.preventDefault(); button.click(); }
    }
  });
  window.addEventListener('pagehide', () => { stopMic(); stopMidi(); cancelAll(); });

  fillLevels(); buildButtons(); syncMetrics(); updateModeButtons(); refreshControls();
  setStatus('Слушайте два звука.', 'Выберите уровень и нажмите «Начать».');
  window.TonalExercise = Object.freeze({
    getState: () => state, getCurrent: () => current, getSession: () => session, getLevel: () => level,
    getKeyId: () => keyId, getRechecks: () => rechecks, getIntroRemaining: () => introRemaining,
    getRates: () => rates, getLastError: () => lastError, getAnswerMode: () => answerMode,
    debug: {
      forceNextDistance: distance => { forcedNextDistance = Number(distance); },
      clearIntro: () => { introRemaining.clear(); },
      nextQuestion: () => { cancelAll(); askQuestion(); },
      getState: () => state, getCurrent: () => current, getSession: () => session,
      getRechecks: () => rechecks, getLevel: () => level, getKeyId: () => keyId
    }
  });
})();