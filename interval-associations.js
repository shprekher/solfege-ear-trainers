/* Reusable interval mnemonics. Audio is supplied by the exercise's note engine. */
(() => {
  'use strict';
  const definitions = {
    1: ['«Челюсти»', [0, 1, 0, 1], [.5, .5, .5, 1]],
    2: ['«Катюша»', [0, 2, 3, 0, 3], [.75, .25, .5, .5, 1]],
    3: ['«Подмосковные вечера»', [0, 3, 7, 3, 5], [1, .5, .5, .5, 1]],
    4: ['«Весна» Вивальди', [0, 4, 4, 4, 2, 0], [.5, .5, .5, .5, .5, 1]],
    5: ['Гимн России', [0, 5, 0, 2, 4], [.5, 1, .5, .5, 1]],
    6: ['«Симпсоны»', [0, 6, 7], [1, 1, 1]],
    7: ['«Звёздные войны»', [0, 7, 5, 4, 2, 12], [.5, 1.5, .5, .5, .5, 1.5]],
    8: ['«Прекрасное далёко»', [0, 8, 7, 5], [.5, 1, .5, 1]],
    9: ['«В лесу родилась ёлочка»', [0, 9, 9, 7, 9, 5], [.5, .5, .5, .5, .5, 1]],
    10: ['«Star Trek»', [0, 10, 9, 5, 3], [.5, 1.5, .5, .5, 1]],
    11: ['«Take On Me»', [0, 11, 12, 11, 7], [.5, .5, .5, .5, 1]],
    12: ['«Somewhere Over the Rainbow»', [0, 12, 11, 7, 9], [1.5, 1, .5, .5, 1]]
  };
  const melodies = Object.freeze(Object.fromEntries(Object.entries(definitions).map(
    ([distance, [name, offsets, beats]]) => [distance, Object.freeze({
      name, offsets: Object.freeze(offsets), beats: Object.freeze(beats)
    })]
  )));
  const bpm = 126, beat = 60 / bpm;
  const get = distance => melodies[distance] || null;
  const duration = distance => get(distance)?.beats.reduce((sum, n) => sum + n * beat, 0) || 0;
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
        melody.offsets.forEach((offset, i) => {
          const length = melody.beats[i] * beat;
          sources.push(note(base + offset, at, length * .9, volume));
          at += length;
        });
      } catch (error) { cancel(); throw error; }
      return { name: melody.name, duration: duration(distance) };
    }
    return Object.freeze({ play, cancel });
  }
  window.IntervalAssociations = Object.freeze({ melodies, get, duration, createPlayer, bpm });
})();
