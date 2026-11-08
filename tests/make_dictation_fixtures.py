"""Synthetic recordings only. Generated binary fixtures are ignored by Git."""
from pathlib import Path
import math
import shutil
import struct
import subprocess
import sys
import wave
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'bot'))
from dictation_bot import make_parts, pair_messages

out = Path(__file__).parent / 'dictation-fixtures'
out.mkdir(exist_ok=True)
wav = out / 'tone.wav'
with wave.open(str(wav), 'wb') as stream:
    stream.setparams((1, 2, 8000, 0, 'NONE', 'not compressed'))
    stream.writeframes(b''.join(struct.pack('<h', int(math.sin(2 * math.pi * 440 * i / 8000) * 8000)) for i in range(32000)))
opus = out / 'voice.ogg'
if shutil.which('ffmpeg'):
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', str(wav), '-c:a', 'libopus', str(opus)], check=True)
else:
    opus = wav
collection = {'id': 'fixture-dictations', 'day': '2026-11-08', 'receivedAt': '2026-11-08T10:00:00+00:00', 'description': 'Проверочное занятие'}
messages = []
for i, text in enumerate(['ИП №2 (т, 2). Тональность до мажор\n  ♭ ч.4 / 2/4 — буквально! ', 'ИП №10. Тональность соль мажор', 'ИП №1. <img src=x onerror=alert(1)>']):
    mid = 100 + i * 2
    source = {'message_id': mid, 'date': 1794132000, 'forward_origin': {'type': 'hidden_user', 'sender_user_name': 'Учитель', 'date': 1794130000}}
    audio = opus if i == 0 else wav
    messages.extend([{'message_id': mid, 'kind': 'text', 'text': text, 'source': source},
                     {'message_id': mid + 1, 'kind': 'audio', 'source': {'message_id': mid + 1}, 'path': str(audio), 'mime': 'audio/ogg' if audio == opus and opus != wav else 'audio/wav', 'duration': 4, 'originalName': audio.name}])
tasks = pair_messages(messages, collection['id'])
paths = make_parts(collection, tasks, {f'audio-{m["message_id"]}': m for m in messages if m['kind'] == 'audio'}, out)
shutil.copyfile(paths[0], out / 'sample.solfege')
parts_collection = {**collection, 'id': 'fixture-dictations-parts'}
parts_tasks = pair_messages(messages, parts_collection['id'])
parts = make_parts(parts_collection, parts_tasks, {f'audio-{m["message_id"]}': m for m in messages if m['kind'] == 'audio'}, out / 'parts', limit=100000)
for index, path in enumerate(parts, 1):
    shutil.copyfile(path, out / f'part{index}.solfege')
large = {**collection, 'id': 'fixture-dictations-large', 'description': '240 коротких записей'}
large_messages = []
for i in range(240):
    mid = 2000 + i * 2
    large_messages.extend([{'message_id': mid, 'kind': 'text', 'text': f'ИП №{i + 1} (т, 2). Тональность до мажор', 'source': {'message_id': mid}},
                           {'message_id': mid + 1, 'kind': 'audio', 'source': {'message_id': mid + 1}, 'path': str(wav), 'mime': 'audio/wav', 'duration': 4, 'originalName': 'tone.wav'}])
large_parts = make_parts(large, pair_messages(large_messages, large['id']), {f'audio-{m["message_id"]}': m for m in large_messages if m['kind'] == 'audio'}, out / 'large')
shutil.copyfile(large_parts[0], out / 'large.solfege')
print(out / 'sample.solfege')
