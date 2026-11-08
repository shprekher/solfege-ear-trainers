"""Private Telegram importer. Python 3.9+, standard library only; no web server."""
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import sqlite3
import struct
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

MAGIC = b'SOLFEGE-DICTATION\n'
MAX_AUDIO = 20_000_000  # Cloud Bot API getFile limit; originals are never transcoded.
MAX_PART = 44_000_000  # Leave room below Telegram sendDocument's 50 MB limit.
MIMES = {'.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.oga': 'audio/ogg',
         '.opus': 'audio/ogg', '.wav': 'audio/wav', '.flac': 'audio/flac', '.aac': 'audio/aac'}


def source_info(message):
    """Keep Telegram provenance separately from the teacher's literal text."""
    return {key: message[key] for key in ('message_id', 'date', 'forward_origin') if key in message}


def pair_messages(messages, collection_id):
    """FIFO pairing in received Telegram order. No musical parsing or renumbering."""
    pending, tasks = [], []
    for message in sorted(messages, key=lambda m: m['message_id']):
        if message['kind'] == 'text':
            pending.append(message)
            continue
        text = pending.pop(0) if pending else None
        if text is None and message.get('caption'):
            text = {'message_id': message['message_id'], 'text': message['caption'], 'source': message['source']}
        mid = text['message_id'] if text else message['message_id']
        tasks.append({'id': f'{collection_id}:{mid}', 'order': mid,
                      'title': text['text'].split('\n', 1)[0] if text else '',
                      'text': text['text'] if text else '',
                      'textSource': text['source'] if text else None,
                      'audioSource': message['source'], 'audioId': f'audio-{message["message_id"]}',
                      'duration': message.get('duration', 0), 'originalName': message.get('originalName', ''), 'caption': message.get('caption', '')})
    for text in pending:
        tasks.append({'id': f'{collection_id}:{text["message_id"]}', 'order': text['message_id'],
                      'title': text['text'].split('\n', 1)[0], 'text': text['text'], 'textSource': text['source'],
                      'audioSource': None, 'audioId': None, 'duration': 0, 'originalName': ''})
    return sorted(tasks, key=lambda t: t['order'])


def make_parts(collection, tasks, assets, directory, limit=MAX_PART):
    """A small binary container: magic + u32 JSON length + UTF-8 JSON + raw files.

    Splitting keeps a stable collection/task ID. Re-importing a part is idempotent.
    """
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    groups, group, size = [], [], 0
    for task in tasks:
        audio_size = Path(assets[task['audioId']]['path']).stat().st_size if task['audioId'] else 0
        estimated = audio_size + len(json.dumps(task, ensure_ascii=False).encode('utf-8')) + 1000
        if estimated > limit:
            raise ValueError('Одна запись превышает размер переносимого набора.')
        if group and size + estimated > limit:
            groups.append(group)
            group, size = [], 0
        group.append(task)
        size += estimated
    if group:
        groups.append(group)
    paths = []
    for index, group in enumerate(groups, 1):
        included = []
        for task in group:
            if not task['audioId']:
                continue
            asset = assets[task['audioId']]
            path = Path(asset['path'])
            digest = hashlib.sha256()
            with path.open('rb') as stream:
                for block in iter(lambda: stream.read(1024 * 1024), b''):
                    digest.update(block)
            included.append({'id': task['audioId'], 'size': path.stat().st_size, 'sha256': digest.hexdigest(),
                             'mime': asset['mime'], 'originalName': task.get('originalName', '')})
        manifest = {'app': 'solfege-dictations', 'version': 1, 'collection': collection,
                    'part': index, 'parts': len(groups), 'tasks': group, 'assets': included}
        header = json.dumps(manifest, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        if len(header) > 4 * 1024 * 1024:
            raise ValueError('Слишком большой список условий. Разделите занятие на несколько наборов.')
        path = directory / f'dictations-{collection["day"]}-{collection["id"][:8]}-{index}.solfege'
        with path.open('wb') as out:
            out.write(MAGIC + struct.pack('<I', len(header)) + header)
            for asset in included:
                with Path(assets[asset['id']]['path']).open('rb') as stream:
                    shutil.copyfileobj(stream, out)
        paths.append(path)
    return paths


class Telegram:
    def __init__(self, token):
        self.token = token

    def call(self, method, data=None, document=None):
        if document:
            boundary = 'solfege-' + uuid.uuid4().hex
            body = io.BytesIO()
            for key, value in (data or {}).items():
                body.write(f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode())
            body.write(f'--{boundary}\r\nContent-Disposition: form-data; name="document"; filename="{document.name}"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode())
            with document.open('rb') as stream:
                shutil.copyfileobj(stream, body)
            body.write(f'\r\n--{boundary}--\r\n'.encode())
            raw, content_type = body.getvalue(), 'multipart/form-data; boundary=' + boundary
        else:
            raw, content_type = json.dumps(data or {}).encode(), 'application/json'
        request = urllib.request.Request(f'https://api.telegram.org/bot{self.token}/{method}', data=raw,
                                         headers={'Content-Type': content_type})
        try:
            with urllib.request.urlopen(request, timeout=180 if document else 55) as response:
                result = json.load(response)
        except (OSError, ValueError, urllib.error.URLError):
            # Never leak an exception URL containing the token into logs or chat.
            raise RuntimeError('Telegram временно недоступен. Повторите команду позже.') from None
        if not result.get('ok'):
            raise RuntimeError('Telegram отклонил запрос. Проверьте доступ бота и размер файла.')
        return result['result']

    def reply(self, chat, text):
        return self.call('sendMessage', {'chat_id': chat, 'text': text})

    def download(self, file_id, path):
        info = self.call('getFile', {'file_id': file_id})
        remote = info.get('file_path', '')
        if not remote or '..' in remote or remote.startswith('/'):
            raise RuntimeError('Telegram не предоставил запись для скачивания.')
        temp = path.with_suffix('.partial')
        try:
            with urllib.request.urlopen(f'https://api.telegram.org/file/bot{self.token}/{remote}', timeout=90) as response, temp.open('wb') as out:
                count = 0
                while True:
                    block = response.read(256 * 1024)
                    if not block:
                        break
                    count += len(block)
                    if count > MAX_AUDIO:
                        raise ValueError('Запись больше 20 МБ. Пришлите более короткий файл.')
                    out.write(block)
            temp.replace(path)
        except Exception:
            temp.unlink(missing_ok=True)
            raise RuntimeError('Не удалось скачать запись (лимит 20 МБ). Условие сохранено; перешлите аудио ещё раз.') from None


HELP = ('Перешлите условия и записи в исходном порядке: текст → аудио. Поддерживаются музыка и голосовые Telegram.\n\n'
        '/new описание — новое занятие (описание необязательно)\n/title описание — изменить описание текущего занятия\n'
        '/status — сколько сообщений получено\n/done — собрать файл(ы) для раздела «Диктанты»\n'
        '/last — повторно получить последнее готовое занятие\n/cancel — отменить черновик\n'
        '/id — узнать свой Telegram ID\n/purge YES — удалить все свои файлы и черновики с компьютера бота\n\n'
        'Оригинальный текст и порядок сохраняются. При первом сообщении занятие создаётся автоматически. '
        'Файлы набора импортируйте на сайте в разделе «Диктанты».')


class Bot:
    def __init__(self, api, data, allowed, timezone_name='Europe/Moscow', site_url=''):
        self.api, self.root, self.allowed = api, Path(data).resolve(), set(allowed)
        self.zone = ZoneInfo(timezone_name)
        self.site_url = site_url
        self.root.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.root / 'bot.sqlite3')
        self.db.executescript('''
          PRAGMA journal_mode=WAL;
          CREATE TABLE IF NOT EXISTS batches(id TEXT PRIMARY KEY,user INTEGER,received TEXT,day TEXT,description TEXT,status TEXT);
          CREATE TABLE IF NOT EXISTS messages(user INTEGER,mid INTEGER,batch TEXT,payload TEXT,PRIMARY KEY(user,mid));
          CREATE INDEX IF NOT EXISTS messages_batch ON messages(batch,mid);
          CREATE TABLE IF NOT EXISTS seen(user INTEGER,mid INTEGER,PRIMARY KEY(user,mid));
          CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT);
        ''')

    def active(self, user):
        return self.db.execute("SELECT * FROM batches WHERE user=? AND status='open' ORDER BY received DESC LIMIT 1", (user,)).fetchone()

    def new(self, user, description=''):
        now = datetime.now(timezone.utc)
        row = (str(uuid.uuid4()), user, now.isoformat(), now.astimezone(self.zone).date().isoformat(), description, 'open')
        self.db.execute('INSERT INTO batches VALUES(?,?,?,?,?,?)', row)
        self.db.commit()
        return row

    def messages(self, batch):
        return [json.loads(row[0]) for row in self.db.execute('SELECT payload FROM messages WHERE batch=? ORDER BY mid', (batch,))]

    def export(self, user, row):
        messages = self.messages(row[0])
        if not messages:
            self.api.reply(user, 'Пока нет сообщений. Перешлите текст и аудио.')
            return
        tasks = pair_messages(messages, row[0])
        assets = {f'audio-{m["message_id"]}': m for m in messages if m['kind'] == 'audio'}
        collection = {'id': row[0], 'receivedAt': row[2], 'day': row[3], 'description': row[4]}
        paths = make_parts(collection, tasks, assets, self.root / str(user) / row[0])
        missing = sum(not t['audioId'] or not t['textSource'] for t in tasks)
        self.api.reply(user, f'Набор: {len(tasks)} заданий, частей: {len(paths)}. '
                            + (f'Неполных пар: {missing}; они сохранены с пометкой, а не удалены. ' if missing else '')
                            + 'Импортируйте все части в «Диктанты». Повторный импорт не создаёт дубликатов.'
                            + ('\nОткрыть: ' + self.site_url if self.site_url else ''))
        for index, path in enumerate(paths, 1):
            self.api.call('sendDocument', {'chat_id': user, 'caption': f'{row[3]} · часть {index}/{len(paths)}'}, document=path)
        self.db.execute("UPDATE batches SET status='done' WHERE id=?", (row[0],))
        self.db.commit()

    def handle(self, message):
        user = message.get('from', {}).get('id')
        if message.get('chat', {}).get('type') != 'private' or message.get('chat', {}).get('id') != user:
            return
        text = message.get('text', '')
        command = text.split(maxsplit=1)[0].split('@')[0] if text.startswith('/') and not message.get('forward_origin') else ''
        if command == '/id':
            self.api.reply(user, f'Ваш Telegram ID: {user}')
            return
        if user not in self.allowed:
            self.api.reply(user, 'Доступ не настроен. Узнайте ID командой /id и добавьте его в TELEGRAM_ALLOWED_USER_IDS на компьютере бота.')
            return
        mid = message['message_id']
        if self.db.execute('SELECT 1 FROM seen WHERE user=? AND mid=?', (user, mid)).fetchone():
            return
        if command in ('/start', '/help'):
            self.api.reply(user, HELP)
        elif command == '/new':
            if self.active(user):
                self.api.reply(user, 'Сначала завершите текущий набор командой /done или отмените его: /cancel.')
            else:
                self.new(user, text.partition(' ')[2])
                self.api.reply(user, 'Новое занятие создано. Перешлите сообщения в исходном порядке, затем /done.')
        elif command == '/title':
            row = self.active(user) or self.new(user)
            self.db.execute('UPDATE batches SET description=? WHERE id=?', (text.partition(' ')[2], row[0]))
            self.api.reply(user, 'Описание занятия сохранено. Условия заданий не изменялись.')
        elif command == '/status':
            row = self.active(user)
            items = self.messages(row[0]) if row else []
            self.api.reply(user, f'Получено: текстов — {sum(m["kind"] == "text" for m in items)}, записей — {sum(m["kind"] == "audio" for m in items)}.')
        elif command == '/done':
            row = self.active(user)
            self.export(user, row) if row else self.api.reply(user, 'Нет открытого набора. Перешлите сообщения или отправьте /new.')
        elif command == '/last':
            row = self.db.execute("SELECT * FROM batches WHERE user=? AND status='done' ORDER BY received DESC LIMIT 1", (user,)).fetchone()
            self.export(user, row) if row else self.api.reply(user, 'Готовых наборов пока нет.')
        elif command == '/cancel':
            self.db.execute("UPDATE batches SET status='cancelled' WHERE user=? AND status='open'", (user,))
            self.api.reply(user, 'Черновик отменён. Уже импортированные занятия на сайте не изменены.')
        elif command == '/purge' and text.strip() == '/purge YES':
            directory = self.root / str(user)
            if directory.is_dir():
                shutil.rmtree(directory)  # This user's explicitly requested, bot-owned private directory only.
            self.db.execute('DELETE FROM messages WHERE user=?', (user,))
            self.db.execute('DELETE FROM batches WHERE user=?', (user,))
            self.db.execute('DELETE FROM seen WHERE user=?', (user,))
            self.api.reply(user, 'Ваши локальные файлы и черновики бота удалены. Сообщения в Telegram и данные браузера не удалялись.')
        elif command:
            self.api.reply(user, 'Неизвестная команда. Доступные команды: /help. Для удаления данных: /purge YES.')
        else:
            audio = message.get('voice') or message.get('audio')
            document = message.get('document', {})
            if not audio and (document.get('mime_type', '').startswith('audio/') or Path(document.get('file_name', '')).suffix.lower() in MIMES):
                audio = document
            if not audio and not text:
                self.api.reply(user, 'Нужно текстовое условие, аудиофайл или голосовое сообщение. Эта запись не добавлена.')
                return
            row = self.active(user) or self.new(user)
            payload = {'message_id': mid, 'source': source_info(message), 'kind': 'text', 'text': text}
            if audio:
                if audio.get('file_size', 0) > MAX_AUDIO:
                    self.api.reply(user, 'Запись больше 20 МБ. Условие не потеряно; пришлите меньший аудиофайл.')
                    return
                directory = self.root / str(user) / row[0]
                directory.mkdir(parents=True, exist_ok=True)
                path = directory / f'audio-{mid}.bin'
                self.api.download(audio['file_id'], path)
                original = audio.get('file_name', '')
                mime = (audio.get('mime_type') or '').split(';', 1)[0].strip().lower()
                if not mime.startswith('audio/'):
                    mime = 'audio/ogg' if 'voice' in message else MIMES.get(Path(original).suffix.lower(), 'audio/mpeg')
                payload.update(kind='audio', path=str(path), mime=mime, originalName=original, duration=audio.get('duration', 0))
                payload['source']['media'] = {key: audio[key] for key in ('file_unique_id', 'file_name', 'title', 'performer', 'duration', 'mime_type', 'file_size') if key in audio}
                # A caption is additional literal source text; never overwrite a separate condition.
                if message.get('caption'):
                    payload['caption'] = message['caption']
            if not self.db.execute('SELECT 1 FROM messages WHERE batch=? LIMIT 1', (row[0],)).fetchone():
                received = datetime.fromtimestamp(message.get('date', time.time()), timezone.utc)
                self.db.execute('UPDATE batches SET received=?,day=? WHERE id=?', (received.isoformat(), received.astimezone(self.zone).date().isoformat(), row[0]))
            self.db.execute('INSERT INTO messages VALUES(?,?,?,?)', (user, mid, row[0], json.dumps(payload, ensure_ascii=False)))
        self.db.execute('INSERT OR IGNORE INTO seen VALUES(?,?)', (user, mid))
        self.db.commit()

    def run(self):
        stored = self.db.execute("SELECT value FROM settings WHERE key='offset'").fetchone()
        offset = int(stored[0]) if stored else 0
        while True:
            try:
                updates = self.api.call('getUpdates', {'offset': offset, 'timeout': 40, 'allowed_updates': ['message']})
                for update in updates:
                    try:
                        if 'message' in update:
                            self.handle(update['message'])
                    except Exception:
                        # Keep original pending texts on failure. Never log recordings, text, token or URLs.
                        self.db.rollback()
                        chat = update.get('message', {}).get('chat', {})
                        if chat.get('type') == 'private':
                            self.api.reply(chat['id'], 'Не удалось обработать сообщение. Перешлите его ещё раз или повторите команду. Уже принятые условия сохранены.')
                    offset = update['update_id'] + 1
                    self.db.execute("INSERT OR REPLACE INTO settings VALUES('offset',?)", (str(offset),))
                    self.db.commit()
            except Exception:
                print('Связь с Telegram прервана; повторная попытка через 5 секунд.', flush=True)
                time.sleep(5)


if __name__ == '__main__':
    os.umask(0o077)
    token = os.environ.get('TELEGRAM_BOT_TOKEN', '')
    if not token:
        raise SystemExit('Задайте TELEGRAM_BOT_TOKEN в окружении. Не записывайте токен в код.')
    allowed = {int(value.strip()) for value in os.environ.get('TELEGRAM_ALLOWED_USER_IDS', '').split(',') if value.strip()}
    Bot(Telegram(token), os.environ.get('DICTATION_DATA_DIR', str(Path.home() / '.local/share/solfege-dictation-bot')), allowed,
        os.environ.get('DICTATION_TIMEZONE', 'Europe/Moscow'), os.environ.get('DICTATION_SITE_URL', '')).run()
