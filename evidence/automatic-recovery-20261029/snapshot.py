import hashlib
import json
import sqlite3
import sys
from pathlib import Path

project = Path(__file__).resolve().parents[2]
runtime = project / 'runtime'
output = Path(__file__).parent / (sys.argv[1] + '-state.json')


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


db = sqlite3.connect((runtime / 'live-harness/messages.db').resolve().as_uri() + '?mode=ro', uri=True)
db.execute('BEGIN')
messages = db.execute('select thread_id,id,at,json from messages order by thread_id,id').fetchall()
memory = db.execute('select bot_id,path,text from memory_files order by bot_id,path').fetchall()
bots = json.loads((runtime / 'live-harness/bots.json').read_text(encoding='utf-8'))
state = {
    'messageCount': len(messages),
    'messageHash': digest(messages),
    'lastMessageAt': max(row[2] for row in messages),
    'memoryHash': digest(memory),
    'identityHash': digest([{key: bot.get(key) for key in ['id', 'name', 'profile', 'soul', 'role', 'instructions']} for bot in bots]),
    'session': json.loads((runtime / 'live-session.json').read_text(encoding='utf-8')),
    'settings': {name: hashlib.sha256((runtime / name).read_bytes()).hexdigest() for name in ['companion-settings.json', 'native-capabilities.json', 'folder-access.json', 'team-members.jsonl']},
}
db.close()
output.write_text(json.dumps(state, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'output': str(output), 'messageCount': state['messageCount'], 'lastMessageAt': state['lastMessageAt']}))
