(() => {
  'use strict';
  const D = window.Dictations, $ = id => document.getElementById(id), audio = $('audio');
  const collectionId = new URLSearchParams(location.search).get('id');
  let collection, tasks = [], states = new Map(), active = null, state = null, version = 0, loading = false;
  let objectURL, context, peaks = [], decodedDuration = 0, page = 0, lastSave = 0, loopTimer, raf, searchTimer, scrollTimer, drag = null, restorePending = false;
  let decoding = false, pendingWave = null;
  const pageSize = 40, downloadURLs = [];
  const node = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
  const status = (text, bad = false) => { $('status').textContent = text; $('status').classList.toggle('error', bad); };
  const problem = error => status(D.errorMessage(error), true);
  const time = value => { const n = Math.round(Math.max(0, Number.isFinite(value) ? value : 0) * 100); return Math.floor(n / 6000) + ':' + (n % 6000 / 100).toFixed(2).padStart(5, '0'); };
  const duration = () => Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : decodedDuration || active?.duration || 0;
  const clamp = value => Math.max(0, Math.min(duration(), value));
  const validLoop = () => state?.loopEnabled && state.loopA !== null && state.loopB !== null && state.loopB - state.loopA >= .1 && state.loopB <= duration() + .05;
  function save(patch = {}) {
    if (!active || !state || loading) return;
    const taskId = active.id;
    state = { ...state, ...patch }; states.set(taskId, state);
    D.store.saveState(taskId, patch).catch(problem);
  }
  function savePosition() {
    if (active?.audioId && state && !loading && !restorePending && Number.isFinite(audio.currentTime)) save({ position: audio.currentTime });
    lastSave = performance.now();
  }
  function stopLoopClock() { clearTimeout(loopTimer); cancelAnimationFrame(raf); }
  function loopClock() {
    stopLoopClock();
    if (audio.paused || loading) return;
    const tick = () => {
      if (audio.paused || loading) return;
      if (validLoop() && audio.currentTime >= state.loopB - .005) audio.currentTime = state.loopA;
      paintPosition(); raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    if (validLoop()) {
      const boundary = () => {
        if (audio.paused || !validLoop()) return;
        if (audio.currentTime >= state.loopB - .005) audio.currentTime = state.loopA;
        loopTimer = setTimeout(boundary, Math.max(15, (state.loopB - audio.currentTime) / audio.playbackRate * 1000));
      };
      loopTimer = setTimeout(boundary, Math.max(15, (state.loopB - audio.currentTime) / audio.playbackRate * 1000));
    }
  }
  function drawWave() {
    const canvas = $('wave'), box = canvas.getBoundingClientRect(), ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(box.width * ratio)), height = Math.round(90 * ratio);
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    if (state && state.loopA !== null && state.loopB !== null && duration()) { ctx.fillStyle = '#77c5ab30'; ctx.fillRect(state.loopA / duration() * width, 0, (state.loopB - state.loopA) / duration() * width, height); }
    ctx.strokeStyle = '#9ac9ba'; ctx.lineWidth = Math.max(1, ratio);
    ctx.beginPath();
    if (peaks.length) peaks.forEach((peak, i) => { const x = i / peaks.length * width, h = Math.max(1, peak * height * .44); ctx.moveTo(x, height / 2 - h); ctx.lineTo(x, height / 2 + h); });
    else { ctx.moveTo(0, height / 2); ctx.lineTo(width, height / 2); }
    ctx.stroke();
    if (duration()) { ctx.strokeStyle = '#f1f4f6'; ctx.lineWidth = 2 * ratio; ctx.beginPath(); const x = audio.currentTime / duration() * width; ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
  }
  function paintPosition() {
    const max = duration(), now = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    $('seek').max = max; $('seek').disabled = !max; $('seek').value = now;
    $('currentTime').textContent = time(now); $('duration').textContent = time(max);
    $('wave').setAttribute('aria-valuemax', max); $('wave').setAttribute('aria-valuenow', now); $('wave').setAttribute('aria-valuetext', time(now) + ' из ' + time(max));
    drawWave();
  }
  async function decodeWave(blob, token) {
    if (token !== version) return;
    if (blob.size > 20_000_000 || (duration() > 300)) { $('waveNote').textContent = 'Для длинной записи волна не рассчитывается. Ползунок, A–B и перемотка работают.'; return; }
    try {
      if (!context || context.state === 'closed') context = new (window.AudioContext || window.webkitAudioContext)();
      const raw = await blob.arrayBuffer(); if (token !== version) return;
      const buffer = await context.decodeAudioData(raw);
      if (token !== version) return;
      decodedDuration = buffer.duration;
      // Reduce all channels to peaks; release the decoded buffer after this function.
      const count = Math.min(1000, buffer.length), next = new Array(count).fill(0), step = Math.ceil(buffer.length / count);
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const values = buffer.getChannelData(channel);
        for (let i = 0; i < count; i++) for (let n = i * step; n < Math.min(values.length, (i + 1) * step); n++) next[i] = Math.max(next[i], Math.abs(values[n]));
      }
      peaks = next; paintPosition();
      $('waveNote').textContent = 'Нажмите на волну для перемотки. Протяните по ней, чтобы выделить A–B.';
    } catch { if (token === version) $('waveNote').textContent = 'Волна недоступна для этого формата. Используйте ползунок и точные значения A–B.'; }
  }
  async function requestWave(blob, token) {
    // Only one decode in flight; rapid navigation keeps only the newest pending request.
    pendingWave = { blob, token }; if (decoding) return;
    decoding = true;
    try { while (pendingWave) { const job = pendingWave; pendingWave = null; await decodeWave(job.blob, job.token); } }
    finally { decoding = false; }
  }
  function seek(value) { if (!duration() || loading) return; audio.currentTime = clamp(value); paintPosition(); loopClock(); }
  function play() {
    if (!active?.audioId || loading) return;
    if (validLoop() && (audio.currentTime < state.loopA || audio.currentTime >= state.loopB)) seek(state.loopA);
    else if (audio.currentTime >= duration() - .01) seek(0);
    audio.play().catch(() => status('Не удалось начать воспроизведение. Нажмите «Слушать» или проверьте формат записи.', true));
  }
  function loopFields() {
    $('loopA').value = state?.loopA === null ? '' : state.loopA.toFixed(2);
    $('loopB').value = state?.loopB === null ? '' : state.loopB.toFixed(2);
    $('loopEnabled').checked = !!state?.loopEnabled;
    drawWave();
  }
  function setLoop(a, b, enabled) {
    if (!state || !duration()) return;
    if (a !== null) a = clamp(a); if (b !== null) b = clamp(b);
    if (enabled && (a === null || b === null || b - a < .1)) { $('loopEnabled').checked = false; status('Выберите участок A–B длиной не менее 0,1 секунды.', true); return; }
    save({ loopA: a, loopB: b, loopEnabled: enabled }); loopFields();
    if (enabled && (audio.currentTime < a || audio.currentTime >= b)) seek(a);
    loopClock();
  }
  function filtered() { const q = $('search').value.toLocaleLowerCase().trim(); return tasks.filter(t => !q || (t.title + '\n' + t.text + '\n' + t.originalName).toLocaleLowerCase().includes(q)); }
  function renderList() {
    const result = filtered(), pages = Math.max(1, Math.ceil(result.length / pageSize)); page = Math.min(page, pages - 1);
    $('tasks').replaceChildren();
    for (const t of result.slice(page * pageSize, (page + 1) * pageSize)) {
      const button = node('button', t.title || 'Текст условия не получен', 'task-button' + (states.get(t.id)?.done ? ' done' : ''));
      button.type = 'button'; button.setAttribute('aria-current', String(t.id === active?.id));
      if (!t.audioId) button.append(node('span', ' · нет аудио', 'error'));
      button.addEventListener('click', () => selectTask(t.id).catch(problem)); $('tasks').append(button);
    }
    if (!result.length) $('tasks').append(node('p', 'По этому номеру или тексту ничего не найдено.', 'muted'));
    $('pageInfo').textContent = (page + 1) + '/' + pages + ' · найдено ' + result.length;
    $('pageBack').disabled = page === 0; $('pageNext').disabled = page >= pages - 1;
    $('listTitle').textContent = 'Задания · ' + tasks.length + ' · выполнено ' + tasks.filter(t => states.get(t.id)?.done).length;
  }
  async function selectTask(id) {
    const task = tasks.find(t => t.id === id); if (!task) return;
    savePosition(); audio.pause(); stopLoopClock(); loading = true; restorePending = true; const token = ++version;
    audio.removeAttribute('src'); audio.load(); if (objectURL) { URL.revokeObjectURL(objectURL); objectURL = null; }
    peaks = []; decodedDuration = 0; active = task; state = null;
    $('taskTitle').textContent = task.title || 'Текст условия не получен'; $('condition').textContent = task.text;
    $('caption').textContent = task.caption; $('caption').hidden = !task.caption || task.caption === task.text;
    $('source').textContent = JSON.stringify({ условие: task.textSource, запись: task.audioSource, исходныйФайл: task.originalName }, null, 2);
    const index = tasks.indexOf(task); $('positionLabel').textContent = 'Позиция в наборе: ' + (index + 1) + ' из ' + tasks.length + '. Название ниже — исходное.';
    $('previous').disabled = index === 0; $('next').disabled = index === tasks.length - 1; $('audioControls').hidden = true;
    $('play').textContent = '▶ Слушать'; $('complete').disabled = true; renderList();
    const url = new URL(location.href); url.searchParams.set('task', id); history.replaceState(null, '', url);
    D.store.saveCollection(collectionId, { lastTaskId: id }).catch(problem);
    const restored = await D.store.state(id); if (token !== version) return;
    state = restored; states.set(id, restored); $('complete').checked = state.done; $('complete').disabled = false;
    $('rate').value = String(state.rate); loopFields();
    if (!task.audioId) { loading = false; restorePending = false; status('У этого условия нет аудио. Оно сохранено без изменений; проверьте пересланные сообщения.', true); return; }
    const asset = await D.store.audio(collectionId, task.audioId); if (token !== version) return;
    if (!asset) { loading = false; status('Запись отсутствует. Импортируйте соответствующую часть набора.', true); return; }
    objectURL = URL.createObjectURL(asset.blob); loading = false;
    $('audioControls').hidden = false; audio.src = objectURL; audio.playbackRate = pitchKey ? state.rate : 1; audio.load();
    status(task.textSource ? 'Запись загружена. Воспроизведение — только по вашему нажатию.' : 'Аудио получено без текстового условия. Проверьте исходные сообщения.', !task.textSource);
    $('waveNote').textContent = 'Строим звуковую волну…'; requestWave(asset.blob, token); renderList();
  }
  function header() { $('lessonTitle').textContent = collection.day + (collection.description ? ' · ' + collection.description : ''); document.title = $('lessonTitle').textContent + ' — диктанты'; $('description').value = collection.description; }
  if (!D || !collectionId) { status('Занятие не выбрано. Вернитесь к списку диктантов.', true); return; }
  const pitchKey = ['preservesPitch', 'mozPreservesPitch', 'webkitPreservesPitch'].find(key => key in audio);
  if (pitchKey) audio[pitchKey] = true; else { $('rate').disabled = true; $('rate').title = 'Браузер не гарантирует сохранение высоты. Скорость оставлена 1×.'; }
  audio.addEventListener('loadedmetadata', () => {
    if (!state || loading) return;
    audio.playbackRate = pitchKey ? state.rate : 1;
    const position = state.position; restorePending = false;
    if (duration()) audio.currentTime = clamp(position);
    paintPosition();
  });
  audio.addEventListener('durationchange', paintPosition);
  audio.addEventListener('timeupdate', () => { paintPosition(); if (performance.now() - lastSave > 2000) savePosition(); });
  audio.addEventListener('play', () => { $('play').textContent = 'Ⅱ Пауза'; loopClock(); });
  audio.addEventListener('pause', () => { $('play').textContent = '▶ Слушать'; stopLoopClock(); savePosition(); });
  audio.addEventListener('seeked', () => { savePosition(); loopClock(); });
  audio.addEventListener('ended', () => { if (validLoop()) { seek(state.loopA); play(); } else { stopLoopClock(); savePosition(); $('play').textContent = '▶ Слушать'; } });
  audio.addEventListener('error', () => { if (active?.audioId && audio.getAttribute('src')) status('Браузер не смог воспроизвести запись. На Android используйте актуальный Chrome; проверьте MP3, M4A или OGG/Opus. Оригинал не изменён.', true); });
  $('play').addEventListener('click', () => audio.paused ? play() : audio.pause());
  $('replay').addEventListener('click', () => { seek(validLoop() ? state.loopA : 0); play(); });
  $('back').addEventListener('click', () => seek(audio.currentTime - 3)); $('forward').addEventListener('click', () => seek(audio.currentTime + 3));
  $('seek').addEventListener('input', () => seek(Number($('seek').value))); $('seek').addEventListener('change', savePosition);
  $('rate').addEventListener('change', () => { const rate = Number($('rate').value); audio.playbackRate = rate; if (pitchKey) audio[pitchKey] = true; save({ rate }); loopClock(); });
  $('markA').addEventListener('click', () => setLoop(audio.currentTime, state.loopB, false));
  $('markB').addEventListener('click', () => setLoop(state.loopA ?? 0, audio.currentTime, true));
  $('clearLoop').addEventListener('click', () => setLoop(null, null, false));
  const readLoop = () => setLoop($('loopA').value === '' ? null : Number($('loopA').value), $('loopB').value === '' ? null : Number($('loopB').value), $('loopEnabled').checked);
  $('loopA').addEventListener('change', readLoop); $('loopB').addEventListener('change', readLoop); $('loopEnabled').addEventListener('change', readLoop);
  const waveTime = event => { const rect = $('wave').getBoundingClientRect(); return clamp((event.clientX - rect.left) / rect.width * duration()); };
  $('wave').addEventListener('pointerdown', e => { if (!duration() || loading) return; drag = { x: e.clientX, a: waveTime(e) }; $('wave').setPointerCapture(e.pointerId); });
  $('wave').addEventListener('pointerup', e => { if (!drag) return; const old = drag; drag = null; const end = waveTime(e); if (Math.abs(e.clientX - old.x) > 6) { setLoop(Math.min(old.a, end), Math.max(old.a, end), true); seek(Math.min(old.a, end)); } else seek(end); });
  $('wave').addEventListener('pointercancel', () => { drag = null; });
  $('wave').addEventListener('keydown', e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); seek(audio.currentTime + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? .1 : 3)); } });
  $('complete').addEventListener('change', () => { save({ done: $('complete').checked }); renderList(); });
  for (const [button, delta] of [['previous', -1], ['next', 1]]) $(button).addEventListener('click', () => { const next = tasks[tasks.indexOf(active) + delta]; if (next) selectTask(next.id).catch(problem); });
  $('search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { page = 0; renderList(); D.store.saveCollection(collectionId, { search: $('search').value }).catch(problem); }, 150); });
  for (const [button, delta] of [['pageBack', -1], ['pageNext', 1]]) $(button).addEventListener('click', () => { page = Math.max(0, page + delta); renderList(); $('tasks').scrollTop = 0; });
  $('tasks').addEventListener('scroll', () => { clearTimeout(scrollTimer); scrollTimer = setTimeout(() => D.store.saveCollection(collectionId, { listScroll: $('tasks').scrollTop }).catch(problem), 300); });
  $('saveDescription').addEventListener('click', async () => { try { collection = await D.store.saveCollection(collectionId, { description: $('description').value }); header(); status('Описание сохранено. Оригинальные условия не изменены.'); } catch (error) { problem(error); } });
  $('export').addEventListener('click', async () => {
    savePosition(); $('export').disabled = true;
    try {
      const parts = await D.store.exportParts(collectionId); $('downloads').replaceChildren(); downloadURLs.splice(0).forEach(url => URL.revokeObjectURL(url));
      for (const part of parts) { const link = node('a', 'Скачать ' + part.name); link.href = URL.createObjectURL(part.blob); link.download = part.name; downloadURLs.push(link.href); $('downloads').append(link); }
      status('Резервная копия подготовлена. Скачайте все части по ссылкам — вместе с отметками и позициями.');
    } catch (error) { problem(error); } finally { $('export').disabled = false; }
  });
  $('delete').addEventListener('click', async () => { if (!confirm('Удалить это занятие, его записи и отметки из браузера? Сначала можно сделать экспорт. Это не удаляет файлы у бота и сообщения Telegram.')) return; try { audio.pause(); await D.store.remove(collectionId); location.href = './dictations.html'; } catch (error) { problem(error); } });
  window.addEventListener('resize', drawWave);
  window.addEventListener('pagehide', () => { savePosition(); audio.pause(); stopLoopClock(); });
  window.addEventListener('dictation-blocked', () => status('Закройте другие вкладки диктантов для обновления хранилища.', true));
  (async () => {
    collection = await D.store.collection(collectionId); if (!collection) throw new Error('Это занятие не найдено в данном браузере. Импортируйте набор или вернитесь к списку.');
    tasks = await D.store.tasks(collectionId); states = new Map((await D.store.states()).map(s => [s.id, s])); header(); $('content').hidden = false;
    $('search').value = collection.search || '';
    const requested = new URLSearchParams(location.search).get('task'), selected = tasks.find(t => t.id === requested) || tasks.find(t => t.id === collection.lastTaskId) || tasks[0];
    if (!selected) throw new Error('В занятии пока нет заданий.');
    page = Math.max(0, Math.floor(filtered().findIndex(t => t.id === selected.id) / pageSize));
    await selectTask(selected.id); $('tasks').scrollTop = collection.listScroll || 0;
  })().catch(problem);
})();
