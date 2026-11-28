/* Pure tonal-interval logic: keys, scales, questions, levels, weights and session stats. */
(() => {
  'use strict';
  const MAJOR = [0, 2, 4, 5, 7, 9, 11];
  const KEYS = Object.freeze([
    { id: 'C', name: 'до мажор', tonic: 0, names: ['до', 'ре', 'ми', 'фа', 'соль', 'ля', 'си'] },
    { id: 'G', name: 'соль мажор', tonic: 7, names: ['соль', 'ля', 'си', 'до', 'ре', 'ми', 'фа-диез'] },
    { id: 'D', name: 'ре мажор', tonic: 2, names: ['ре', 'ми', 'фа-диез', 'соль', 'ля', 'си', 'до-диез'] },
    { id: 'F', name: 'фа мажор', tonic: 5, names: ['фа', 'соль', 'ля', 'си-бемоль', 'до', 'ре', 'ми'] },
    { id: 'A', name: 'ля мажор', tonic: 9, names: ['ля', 'си', 'до-диез', 'ре', 'ми', 'фа-диез', 'соль-диез'] },
    { id: 'E', name: 'ми мажор', tonic: 4, names: ['ми', 'фа-диез', 'соль-диез', 'ля', 'си', 'до-диез', 'ре-диез'] }
  ]);
  const KEY_BY_ID = new Map(KEYS.map(key => [key.id, key]));
  const GENERAL_NAMES = Object.freeze(['до', 'до-диез', 'ре', 'ре-диез', 'ми', 'фа', 'фа-диез', 'соль', 'соль-диез', 'ля', 'ля-диез', 'си']);

  const INTERVALS = Object.freeze({
    1: Object.freeze({ short: 'м.2', button: 'м. секунда', name: 'малая секунда', semitones: 1 }),
    2: Object.freeze({ short: 'б.2', button: 'б. секунда', name: 'большая секунда', semitones: 2 }),
    3: Object.freeze({ short: 'м.3', button: 'м. терция', name: 'малая терция', semitones: 3 }),
    4: Object.freeze({ short: 'б.3', button: 'б. терция', name: 'большая терция', semitones: 4 }),
    5: Object.freeze({ short: 'ч.4', button: 'ч. кварта', name: 'чистая кварта', semitones: 5 }),
    6: Object.freeze({ short: 'ув.4/ум.5', button: 'тритон', name: 'тритон', semitones: 6 }),
    7: Object.freeze({ short: 'ч.5', button: 'ч. квинта', name: 'чистая квинта', semitones: 7 }),
    8: Object.freeze({ short: 'м.6', button: 'м. секста', name: 'малая секста', semitones: 8 }),
    9: Object.freeze({ short: 'б.6', button: 'б. секста', name: 'большая секста', semitones: 9 }),
    10: Object.freeze({ short: 'м.7', button: 'м. септима', name: 'малая септима', semitones: 10 }),
    11: Object.freeze({ short: 'б.7', button: 'б. септима', name: 'большая септима', semitones: 11 }),
    12: Object.freeze({ short: 'ч.8', button: 'ч. октава', name: 'чистая октава', semitones: 12 })
  });
  const INTERVAL_ORDER = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

  const LEVELS = Object.freeze([
    Object.freeze({ level: 1, title: 'Опорные', intervals: Object.freeze([1, 7, 12]), newIntervals: Object.freeze([12, 7, 1]) }),
    Object.freeze({ level: 2, title: 'Терции', intervals: Object.freeze([1, 3, 4, 7, 12]), newIntervals: Object.freeze([3, 4]) }),
    Object.freeze({ level: 3, title: 'Секунды', intervals: Object.freeze([1, 2, 3, 4, 7, 12]), newIntervals: Object.freeze([2]) }),
    Object.freeze({ level: 4, title: 'Сексты', intervals: Object.freeze([1, 2, 3, 4, 7, 8, 9, 12]), newIntervals: Object.freeze([8, 9]) }),
    Object.freeze({ level: 5, title: 'Кварта', intervals: Object.freeze([1, 2, 3, 4, 5, 7, 8, 9, 12]), newIntervals: Object.freeze([5]) }),
    Object.freeze({ level: 6, title: 'Септимы', intervals: Object.freeze([1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12]), newIntervals: Object.freeze([10, 11]) }),
    Object.freeze({ level: 7, title: 'Тритон', intervals: Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), newIntervals: Object.freeze([6]) })
  ]);
  const LEVEL_BY_NUMBER = new Map(LEVELS.map(item => [item.level, item]));
  const DEFAULT_SESSION = 24;
  const AUTO_WINDOW = 30;
  const AUTO_THRESHOLD = .85;
  const INTRO_REPEATS = 3;
  const CADENCE_STEP = .62;
  const CHORD_DURATION = .56;
  const CADENCE_TOTAL = 3 * CADENCE_STEP + CHORD_DURATION;

  const key = id => KEY_BY_ID.get(id) || KEYS[0];
  const level = number => LEVEL_BY_NUMBER.get(Number(number)) || LEVELS[0];
  const interval = distance => INTERVALS[distance] || null;
  const directionLabel = direction => direction === 1 ? 'вверх' : direction === -1 ? 'вниз' : 'вместе';
  const pick = (list, rng = Math.random) => list[Math.floor(rng() * list.length)];

  const scaleCache = new Map();
  function scaleNotes(keyId) {
    if (scaleCache.has(keyId)) return scaleCache.get(keyId);
    const info = key(keyId), notes = [];
    for (let octave = 3; octave <= 5; octave++) {
      for (let i = 0; i < 7; i++) {
        const midi = 12 * (octave + 1) + info.tonic + MAJOR[i];
        if (midi >= 48 && midi <= 83) notes.push(Object.freeze({ midi, degree: i + 1, octave, name: info.names[i] }));
      }
    }
    notes.sort((a, b) => a.midi - b.midi);
    scaleCache.set(keyId, Object.freeze(notes));
    return scaleCache.get(keyId);
  }

  const pairCache = new Map();
  function pairsFor(keyId, distance) {
    const cacheKey = keyId + ':' + distance;
    if (pairCache.has(cacheKey)) return pairCache.get(cacheKey);
    const notes = scaleNotes(keyId), byMidi = new Map(notes.map(note => [note.midi, note])), pairs = [];
    for (const lower of notes) {
      const upper = byMidi.get(lower.midi + distance);
      if (upper) pairs.push(Object.freeze({ lower, upper, distance }));
    }
    pairCache.set(cacheKey, Object.freeze(pairs));
    return pairCache.get(cacheKey);
  }

  function makeQuestion({ keyId, distance, type = 'tonic', direction = 1, avoid = null, rng = Math.random }) {
    const pairs = pairsFor(keyId, distance);
    if (!pairs.length) return null;
    let candidates = pairs, fallback = false;
    if (type === 'tonic') {
      const tonicPairs = pairs.filter(pair => pair.lower.degree === 1 || pair.upper.degree === 1);
      if (tonicPairs.length) {
        const fromTonic = tonicPairs.filter(pair => pair.lower.degree === 1);
        candidates = fromTonic.length ? fromTonic : tonicPairs;
      } else {
        // In a major scale a tritone never includes the tonic; ask it between degrees.
        candidates = pairs;
        fallback = true;
      }
    }
    if (avoid) {
      const filtered = candidates.filter(pair => !(pair.lower.midi === avoid.lower && pair.upper.midi === avoid.upper));
      if (filtered.length) candidates = filtered;
    }
    const pair = pick(candidates, rng);
    const actualType = type === 'tonic' && !fallback ? 'tonic' : 'between';
    const notes = direction === 1 ? [pair.lower.midi, pair.upper.midi] : direction === -1 ? [pair.upper.midi, pair.lower.midi] : [pair.lower.midi, pair.upper.midi];
    return Object.freeze({
      keyId: key(keyId).id,
      distance,
      type: actualType,
      requestedType: type,
      fallback,
      direction,
      lower: pair.lower.midi,
      upper: pair.upper.midi,
      lowerName: pair.lower.name,
      upperName: pair.upper.name,
      lowerDegree: pair.lower.degree,
      upperDegree: pair.upper.degree,
      lowerOctave: pair.lower.octave,
      upperOctave: pair.upper.octave,
      target: pair.upper.midi,
      notes: Object.freeze(notes),
      harmonic: direction === 0
    });
  }

  function chooseKey(previous = null, rng = Math.random) {
    const available = KEYS.filter(item => item.id !== previous);
    return pick(available.length ? available : KEYS, rng);
  }

  function rateOf(rates, distance) {
    const value = Number(rates?.[distance]);
    return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  }

  function updateRate(rate, ok) {
    const current = Number.isFinite(rate) ? Math.max(0, Math.min(1, rate)) : 0;
    return ok ? current * .85 : Math.min(1, current + .35);
  }

  function chooseDistance({ available, rates = {}, last = null, rng = Math.random }) {
    const allowed = available.filter(distance => !!INTERVALS[distance]);
    const pool = allowed.length > 1 && last !== null ? allowed.filter(distance => distance !== last) : allowed;
    if (!pool.length) return null;
    const mean = pool.reduce((sum, distance) => sum + rateOf(rates, distance), 0) / pool.length;
    const weights = pool.map(distance => Math.min(5, 1 + 4 * Math.max(0, rateOf(rates, distance) - mean)));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let value = rng() * total;
    for (let i = 0; i < pool.length; i++) {
      value -= weights[i];
      if (value <= 0) return pool[i];
    }
    return pool[pool.length - 1];
  }

  function cadence(keyId) {
    const tonic = 12 * (3 + 1) + key(keyId).tonic;
    return Object.freeze([
      Object.freeze([tonic, tonic + 4, tonic + 7]),
      Object.freeze([tonic + 5, tonic + 9, tonic + 12]),
      Object.freeze([tonic + 7, tonic + 11, tonic + 14]),
      Object.freeze([tonic, tonic + 4, tonic + 7])
    ]);
  }
  const tonicChord = keyId => cadence(keyId)[0];

  function noteName(midi, keyId = 'C') {
    const note = scaleNotes(keyId).find(item => item.midi === midi);
    if (note) return note.name;
    return GENERAL_NAMES[((midi % 12) + 12) % 12];
  }
  function noteNameWithOctave(midi, keyId = 'C') {
    return noteName(midi, keyId) + (Math.floor(midi / 12) - 1);
  }
  function questionText(question) {
    if (!question) return '';
    return question.lowerName + '–' + question.upperName + ' = ' + INTERVALS[question.distance].short;
  }
  function midiMatches(played, target) { return played === target; }
function voiceMatches(midi, cents, target, tolerance = .6) { return Math.abs((midi + cents / 100) - target) <= tolerance; }
function nearestDistance(available, semitones) {
    if (!available.length) return null;
    return available.reduce((best, distance) => Math.abs(distance - semitones) < Math.abs(best - semitones) ? distance : best, available[0]);
  }

  function createSession() {
    return { answered: 0, correct: 0, streak: 0, byInterval: {}, confusion: {} };
  }
  function recordSession(session, distance, actual, ok) {
    session.answered++;
    const row = session.byInterval[distance] || (session.byInterval[distance] = { asked: 0, correct: 0 });
    row.asked++;
    if (ok) { session.correct++; session.streak++; row.correct++; }
    else {
      session.streak = 0;
      if (INTERVALS[actual]) {
        const pair = distance + '>' + actual;
        session.confusion[pair] = (session.confusion[pair] || 0) + 1;
      }
    }
    return session;
  }
  function sessionSummary(session) {
    const rows = Object.entries(session.byInterval).map(([distance, row]) => {
      const info = INTERVALS[distance];
      return { distance: Number(distance), short: info.short, name: info.name, asked: row.asked, correct: row.correct, accuracy: row.correct / row.asked };
    }).sort((a, b) => a.distance - b.distance);
    const confusion = Object.entries(session.confusion).map(([pair, count]) => {
      const [expected, actual] = pair.split('>').map(Number);
      return { expected, actual, count, text: INTERVALS[expected].short + ' → ' + INTERVALS[actual].short };
    }).sort((a, b) => b.count - a.count || a.expected - b.expected);
    const weakest = rows.filter(row => row.asked).sort((a, b) => a.accuracy - b.accuracy || b.asked - a.asked)[0] || null;
    let recommendation;
    if (!weakest) recommendation = 'Продолжайте с текущего уровня.';
    else if (weakest.accuracy >= .9) recommendation = 'Ошибок почти нет — попробуйте следующий уровень.';
    else recommendation = 'Завтра потренируйте ' + weakest.short + ': ' + weakest.correct + ' из ' + weakest.asked + ' верно.';
    return {
      answered: session.answered,
      correct: session.correct,
      accuracy: session.answered ? session.correct / session.answered : 0,
      rows,
      confusion: confusion[0] || null,
      recommendation
    };
  }

  function nextLevelResult(history, ok) {
    const next = (Array.isArray(history) ? history : []).concat(ok ? 1 : 0);
    return next.slice(-AUTO_WINDOW);
  }
  function levelAccuracy(history) {
    if (!Array.isArray(history) || !history.length) return 0;
    return history.filter(Boolean).length / history.length;
  }
  function shouldAdvance(history, currentLevel) {
    return currentLevel < LEVELS.length && Array.isArray(history) && history.length >= AUTO_WINDOW && levelAccuracy(history) >= AUTO_THRESHOLD;
  }

  function createRecheckQueue() { return []; }
  function scheduleRecheck(queue, distance, avoid = null, rng = Math.random) {
    const due = 2 + Math.floor(rng() * 2);
    const existing = queue.find(item => item.distance === distance);
    if (existing) { existing.due = due; existing.avoid = avoid; return existing; }
    const item = { distance, due, avoid };
    queue.push(item);
    return item;
  }
  function tickRechecks(queue) {
    for (const item of queue) if (item.due > 0) item.due--;
    return queue;
  }
  function takeDueRecheck(queue) {
    const index = queue.findIndex(item => item.due <= 0);
    if (index < 0) return null;
    return queue.splice(index, 1)[0];
  }
  function introDistances(levelNumber, introduced = new Set()) {
    return level(levelNumber).newIntervals.filter(distance => !introduced.has(levelNumber + ':' + distance));
  }

  window.TonalEngine = Object.freeze({
    KEYS, INTERVALS, INTERVAL_ORDER, LEVELS, DEFAULT_SESSION, AUTO_WINDOW, AUTO_THRESHOLD, INTRO_REPEATS,
    CADENCE_STEP, CHORD_DURATION, CADENCE_TOTAL, key, level, interval, directionLabel, scaleNotes, pairsFor,
    makeQuestion, chooseKey, rateOf, updateRate, chooseDistance, cadence, tonicChord, noteName, noteNameWithOctave,
    questionText, midiMatches, voiceMatches, nearestDistance, createSession, recordSession, sessionSummary, nextLevelResult, levelAccuracy,
    shouldAdvance, createRecheckQueue, scheduleRecheck, tickRechecks, takeDueRecheck, introDistances
  });
})();