/* Reusable interval mnemonics. Audio is supplied by the exercise's note engine. */
(() => {
  'use strict';
  const definitions = {
    1: ['«Челюсти»', [[0, 1], [1, .5], [0, 1], [1, .5]]],
    // "Расцветали": first two bars of 2/4; a slower teaching tempo.
    2: ['«Катюша»', [[0, 1.5], [2, .5], [3, 1.5], [0, .5]], {bpm:112}],
    3: ['«Подмосковные вечера»', [[0, .5], [3, .5], [7, .5], [3, .5], [5, 1.5]]],
    4: ['«Весна» Вивальди', [[0, .5], [4, .5], [4, .5], [4, .5], [2, .25]]],
    5: ['Гимн России', [[0, .35], [5, .7], [0, .5], [2, .2], [4, .7]]],
    6: ['«Симпсоны»', [[0, .75], [6, .75], [7, 1.5]]],
    7: ['«Звёздные войны»', [[0, 1.8], [7, 1.8], [5, .3], [4, .3], [2, .3]]],
    8: ['«Прекрасное далёко»', [[0, .5], [8, .5], [8, .5], [8, .5], [8, .5]]],
    9: ['«В лесу родилась ёлочка»', [[0, .5], [9, .5], [9, .5], [7, .5], [9, .5]]],
    // Opening five pitched notes of Riff A, bar 7: David Stanley score, quarter = 88.
    // null denotes silence (including the unpitched muted guitar stroke).
    10: ["RHCP — «Can't Stop»", [[0, .25], [null, .25], [10, .5], [12, .5], [0, .25], [0, .25]], {bpm:88, gate:.65}],
    // Vocal chorus, "Take — on — me": A3, G#4, A4; one 4/4 bar each.
    11: ['a-ha — «Take On Me»', [[0, 4], [11, 4], [12, 4]], {bpm:169}],
    12: ['«Somewhere Over the Rainbow»', [[0, 1], [12, 1], [11, .5], [7, .25], [9, .25]]]
  };
  const bpm = 140;
  const melodies = Object.freeze(Object.fromEntries(Object.entries(definitions).map(
    ([distance, [name, notes, playback = {}]]) => [distance, Object.freeze({
      name, notes: Object.freeze(notes.map(pair => Object.freeze(pair))),
      bpm: playback.bpm || bpm, gate: playback.gate ?? 1
    })]
  )));
  const get = distance => melodies[distance] || null;
  const duration = distance => {
    const melody = get(distance);
    return melody ? melody.notes.reduce((sum, [, beats]) => sum + beats * 60 / melody.bpm, 0) : 0;
  };
  // note(midi, audioTime, seconds, volume) must return a stoppable source.
  function createPlayer(note) {
    let sources = [];
    function cancel() {
      for (const source of sources) { try { source.stop(); } catch {} }
      sources = [];
    }
    function play(distance, base, start, volume = 1.15) {
      cancel();
      const melody = get(distance);
      if (!melody) return null;
      let at = start;
      try {
        melody.notes.forEach(([offset, beats]) => {
          const length = beats * 60 / melody.bpm;
          if (offset !== null) sources.push(note(base + offset, at, length * melody.gate, volume));
          at += length;
        });
      } catch (error) { cancel(); throw error; }
      return { name: melody.name, duration: duration(distance) };
    }
    return Object.freeze({ play, cancel });
  }
  window.IntervalAssociations = Object.freeze({ melodies, get, duration, createPlayer, bpm });
})();
