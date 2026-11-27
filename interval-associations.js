/* Reusable interval mnemonics. Audio is supplied by the exercise's note engine. */
(() => {
  'use strict';
  const definitions = {
    1: ['«Челюсти»', [[0, 1], [1, .5], [0, 1], [1, .5], [0, .5], [1, .5]]],
    2: ['«Катюша»', [[0, .75], [2, .25], [3, .5], [0, .5], [3, .25], [3, .25], [2, .25], [0, .25], [2, .5], [-5, .75]]],
    3: ['«Подмосковные вечера»', [[0, .5], [3, .5], [7, .5], [3, .5], [5, 1.5]]],
    4: ['«Весна» Вивальди', [[0, .5], [4, .5], [4, .5], [4, .5], [2, .25], [0, .25], [7, 1.5]]],
    5: ['Гимн России', [[0, .35], [5, .7], [0, .5], [2, .2], [4, .7], [-3, .35], [-3, .35], [2, .7], [0, .5], [-2, .2], [0, .7], [-7, .8]]],
    6: ['«Симпсоны»', [[0, .75], [6, .75], [7, 1.5]]],
    7: ['«Звёздные войны»', [[0, 1.8], [7, 1.8], [5, .3], [4, .3], [2, .3], [12, 1.8], [7, .9], [5, .3], [4, .3], [2, .3], [12, 1.8], [7, .9], [5, .3], [4, .3], [5, .3], [2, 1.8]]],
    8: ['«Прекрасное далёко»', [[0, .5], [8, .5], [8, .5], [8, .5], [8, .5], [8, .5], [7, 1]]],
    9: ['«В лесу родилась ёлочка»', [[0, .5], [9, .5], [9, .5], [7, .5], [9, .5], [5, .5], [0, .5], [0, 1]]],
    // Riff A, bar 7: David Stanley guitar score, quarter = 88.
    // null denotes silence (including the unpitched muted guitar stroke).
    10: ["RHCP — «Can't Stop»", [[0, .25], [null, .25], [10, .5], [12, .5], [0, .25], [0, .25], [0, .25], [10, .25], [null, .25], [12, .5], [0, .25], [0, .25], [0, .25]], {bpm:88, gate:.65}],
    11: ['a-ha — «Take On Me»', [[0, 1], [11, .5], [9, 1], [0, 1], [11, .5], [9, 1]]],
    12: ['«Somewhere Over the Rainbow»', [[0, 1], [12, 1], [11, .5], [7, .25], [9, .25], [11, .5], [12, 1]]]
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
