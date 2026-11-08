import hashlib
import http.client
import io
import json
import urllib.error
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch
from dictation_bot import Bot, Telegram, MAGIC, make_parts, pair_messages


class FakeTelegram:
    def __init__(self):
        self.replies, self.sent, self.downloads = [], [], []

    def reply(self, chat, text):
        self.replies.append((chat, text))

    def download(self, file_id, path):
        self.downloads.append(file_id)
        if file_id == 'broken':
            raise RuntimeError('test failure')
        path.write_bytes(b'private-audio-' + file_id.encode())

    def call(self, method, data, document=None):
        self.sent.append(document)


def message(mid, **values):
    return {'message_id': mid, 'date': 1700000000, 'from': {'id': 1}, 'chat': {'id': 1, 'type': 'private'}, **values}


class DictationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.api = FakeTelegram()
        self.bot = Bot(self.api, self.temp.name, {1})

    def tearDown(self):
        self.bot.db.close()
        self.temp.cleanup()

    def test_literal_text_order_and_repeat_update(self):
        text = 'ИП №2 (т, 2). Тональность до мажор\n  ♭ ч.4 / 2/4 — буквально! '
        self.bot.handle(message(10, text=text, forward_origin={'type': 'hidden_user', 'sender_user_name': 'Преподаватель', 'date': 1}))
        self.bot.handle(message(11, voice={'file_id': 'voice', 'duration': 3}))
        self.bot.handle(message(11, voice={'file_id': 'voice', 'duration': 3}))
        self.bot.handle(message(12, text='ИП №1. Не переставлять по номеру.'))
        self.bot.handle(message(13, audio={'file_id': 'music', 'file_unique_id': 'original-audio-id', 'title': 'Исходное название', 'mime_type': 'audio/mpeg', 'file_name': 'ИП №1.mp3', 'duration': 2}))
        row = self.bot.active(1)
        tasks = pair_messages(self.bot.messages(row[0]), row[0])
        self.assertEqual([t['order'] for t in tasks], [10, 12])
        self.assertEqual(tasks[0]['text'], text)
        self.assertEqual(tasks[0]['title'], text.split('\n')[0])
        self.assertEqual(len(self.api.downloads), 2)
        self.assertEqual(tasks[0]['textSource']['message_id'], 10)
        self.assertEqual(tasks[0]['textSource']['forward_origin']['sender_user_name'], 'Преподаватель')
        self.assertEqual(tasks[1]['audioSource']['media']['file_unique_id'], 'original-audio-id')
        self.assertEqual(tasks[1]['audioSource']['media']['title'], 'Исходное название')

    def test_date_is_first_received_message_not_new_command(self):
        self.bot.handle(message(1, text='/new Описание'))
        self.bot.handle(message(2, text='ИП №2', date=1700000000))
        self.assertEqual(self.bot.active(1)[3], '2023-11-15')  # UTC 22:13 is next day in Moscow.

    def test_orphans_and_fifo_are_not_discarded(self):
        rows = [{'message_id': 1, 'kind': 'text', 'text': '№10', 'source': {}},
                {'message_id': 2, 'kind': 'text', 'text': '№2', 'source': {}},
                {'message_id': 3, 'kind': 'audio', 'source': {}},
                {'message_id': 4, 'kind': 'audio', 'source': {}},
                {'message_id': 5, 'kind': 'audio', 'source': {}},
                {'message_id': 6, 'kind': 'text', 'text': 'Нет записи', 'source': {}}]
        tasks = pair_messages(rows, 'lesson')
        self.assertEqual([t['text'] for t in tasks], ['№10', '№2', '', 'Нет записи'])
        self.assertIsNone(tasks[-1]['audioId'])

    def test_caption_is_literal(self):
        self.bot.handle(message(1, voice={'file_id': 'v', 'duration': 2}, caption='ИП №3 (т, 2)'))
        row = self.bot.active(1)
        self.assertEqual(pair_messages(self.bot.messages(row[0]), row[0])[0]['text'], 'ИП №3 (т, 2)')

    def test_failed_audio_does_not_consume_condition(self):
        self.bot.handle(message(1, text='Условие'))
        self.bot.handle(message(2, audio={'file_id': 'broken'}))
        self.bot.handle(message(3, text='Следующее условие'))
        self.bot.handle(message(4, audio={'file_id': 'good'}))
        items = self.bot.messages(self.bot.active(1)[0])
        self.assertEqual(len(items), 4)
        self.assertEqual(items[1]['downloadState'], 'failed')
        tasks = pair_messages(items, 'collection')
        self.assertEqual([t['audioSource']['message_id'] for t in tasks], [2, 4])
        self.bot.handle(message(5, text='/done'))
        self.assertFalse(self.api.sent)
        self.api.download = lambda file_id, path: path.write_bytes(b'recovered')
        self.bot.handle(message(6, text='/retry'))
        self.assertEqual(self.bot.messages(self.bot.active(1)[0])[1]['downloadState'], 'ready')
        self.bot.handle(message(7, text='/done'))
        self.assertEqual(len(self.api.sent), 1)

    def test_api_retries_without_logging_token(self):
        secret = '123456:fake_secret_must_not_appear'
        result = io.BytesIO(json.dumps({'ok': True, 'result': {'file_path': 'voice/a.ogg'}}).encode())
        output = io.StringIO()
        with patch('dictation_bot.urllib.request.urlopen', side_effect=[urllib.error.URLError('https://api.telegram.org/bot' + secret), result]) as request, patch('dictation_bot.time.sleep'), patch('sys.stdout', output):
            self.assertEqual(Telegram(secret).call('getFile', {'file_id': 'one'})['file_path'], 'voice/a.ogg')
            self.assertEqual(request.call_count, 2)
        self.assertNotIn(secret, output.getvalue())

    def test_http_429_respects_retry_after(self):
        error = urllib.error.HTTPError('https://api.telegram.org/botSECRET', 429, 'rate limit', {}, io.BytesIO(b'{"parameters":{"retry_after":2}}'))
        result = io.BytesIO(b'{"ok":true,"result":{}}')
        with patch('dictation_bot.urllib.request.urlopen', side_effect=[error, result]), patch('dictation_bot.time.sleep') as sleep:
            Telegram('SECRET').call('getFile')
            sleep.assert_called_once_with(2)

    def test_partial_download_is_retried_without_concatenation(self):
        class Broken(io.BytesIO):
            def read(self, *args):
                raise http.client.IncompleteRead(b'ab', 6)
        api = Telegram('SECRET')
        api.call = lambda *args, **kwargs: {'file_path': 'voice/test.ogg', 'file_size': 6}
        path = Path(self.temp.name) / 'retry.bin'
        with patch('dictation_bot.urllib.request.urlopen', side_effect=[Broken(), io.BytesIO(b'abcdef')]), patch('dictation_bot.time.sleep'):
            api.download('file-id', path)
        self.assertEqual(path.read_bytes(), b'abcdef')
        self.assertFalse(path.with_suffix('.partial').exists())

    def test_legacy_gap_is_not_exported_with_shifted_pairs(self):
        self.bot.handle(message(1, text='Условие'))
        row = self.bot.active(1)
        self.bot.db.execute('INSERT INTO settings VALUES(?,?)', ('needs_reforward:' + row[0], '1'))
        self.bot.db.commit()
        self.bot.handle(message(2, text='/done'))
        self.assertFalse(self.api.sent)
        self.assertIn('перешлите исходный набор заново', self.api.replies[-1][1])

    def test_allowlist_and_groups(self):
        self.bot.handle({'message_id': 1, 'from': {'id': 2}, 'chat': {'id': 2, 'type': 'private'}, 'voice': {'file_id': 'x'}})
        self.bot.handle({'message_id': 2, 'from': {'id': 1}, 'chat': {'id': 9, 'type': 'group'}, 'voice': {'file_id': 'x'}})
        self.assertFalse(self.api.downloads)
        self.assertFalse(self.bot.active(2))

    def test_sqlite_resume_and_export(self):
        self.bot.handle(message(1, text='ИП №2 (т, 2). Тональность до мажор'))
        self.bot.handle(message(2, voice={'file_id': 'v', 'duration': 3}))
        self.bot.db.close()
        self.bot = Bot(self.api, self.temp.name, {1})
        self.bot.handle(message(3, text='/done'))
        self.assertEqual(len(self.api.sent), 1)
        data = self.api.sent[0].read_bytes()
        self.assertTrue(data.startswith(MAGIC))
        size = struct.unpack('<I', data[len(MAGIC):len(MAGIC) + 4])[0]
        manifest = json.loads(data[len(MAGIC) + 4:len(MAGIC) + 4 + size])
        self.assertEqual(manifest['tasks'][0]['text'], 'ИП №2 (т, 2). Тональность до мажор')
        self.assertEqual(hashlib.sha256(data[len(MAGIC) + 4 + size:]).hexdigest(), manifest['assets'][0]['sha256'])
        self.assertIsNone(self.bot.active(1))

    def test_split_keeps_ids_and_original_order(self):
        path = Path(self.temp.name) / 'a.bin'; path.write_bytes(b'0' * 1024)
        tasks = [{'id': str(i), 'order': i, 'audioId': str(i)} for i in range(3)]
        assets = {str(i): {'path': str(path), 'mime': 'audio/ogg'} for i in range(3)}
        paths = make_parts({'id': 'collection', 'day': '2026-11-08'}, tasks, assets, self.temp.name, limit=3000)
        self.assertEqual(len(paths), 3)
        for i, path in enumerate(paths):
            data = path.read_bytes(); size = struct.unpack('<I', data[len(MAGIC):len(MAGIC) + 4])[0]
            manifest = json.loads(data[len(MAGIC) + 4:len(MAGIC) + 4 + size])
            self.assertEqual(manifest['part'], i + 1)
            self.assertEqual(manifest['tasks'][0]['id'], str(i))

    def test_purge_is_scoped_to_one_user(self):
        self.bot.allowed.add(2)
        self.bot.handle(message(1, voice={'file_id': 'one', 'duration': 2}))
        self.bot.handle(message(2, **{'from': {'id': 2}, 'chat': {'id': 2, 'type': 'private'}, 'voice': {'file_id': 'two', 'duration': 2}}))
        self.bot.handle(message(3, text='/purge YES'))
        self.assertFalse((Path(self.temp.name) / '1').exists())
        self.assertTrue((Path(self.temp.name) / '2').exists())
        self.assertIsNone(self.bot.active(1))
        self.assertIsNotNone(self.bot.active(2))


if __name__ == '__main__':
    unittest.main()
