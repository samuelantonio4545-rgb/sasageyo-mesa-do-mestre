"""Mesa do Mestre: local campaign desk. Python 3.11+, standard library only."""
import base64
import datetime as dt
import io
import json
import mimetypes
import os
from pathlib import Path
import secrets
import sqlite3
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import webbrowser
import zipfile
import traceback
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parent
DATA = Path(os.environ.get('MESA_DATA_DIR', ROOT / 'data'))
SESSION = secrets.token_urlsafe(32)
TOKEN = os.environ.get('DISCORD_BOT_TOKEN', '')
LOCK = threading.RLock()
KINDS = {'personagem', 'imagem', 'musica', 'cena', 'nota', 'pasta'}
EXTENSIONS = {'.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp3', '.ogg', '.wav', '.m4a', '.pdf'}


@contextmanager
def db():
    con = sqlite3.connect(DATA / 'mesa.sqlite3', timeout=15)
    con.row_factory = sqlite3.Row
    try:
        with con:
            yield con
    finally:
        con.close()


def init():
    (DATA / 'files').mkdir(parents=True, exist_ok=True)
    with db() as con:
        con.executescript('''
          CREATE TABLE IF NOT EXISTS items(id TEXT PRIMARY KEY, body TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY, body TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, due REAL NOT NULL,
            status TEXT NOT NULL, body TEXT NOT NULL, result TEXT NOT NULL DEFAULT '');
          CREATE TABLE IF NOT EXISTS history(id INTEGER PRIMARY KEY, at REAL NOT NULL,
            label TEXT NOT NULL, detail TEXT NOT NULL);
        ''')
        con.execute('INSERT OR IGNORE INTO settings VALUES(1, ?)', (json.dumps({
            'campaign': 'Minha campanha', 'channel': '', 'ambience_channel': '', 'kenku_port': 3333}),))
        con.execute("UPDATE jobs SET status='incerto', result='O programa fechou durante o envio. Confira o Discord antes de reagendar.' WHERE status='enviando'")


def settings():
    with db() as con:
        return json.loads(con.execute('SELECT body FROM settings WHERE id=1').fetchone()[0])


def log(label, detail):
    with db() as con:
        con.execute('INSERT INTO history(at,label,detail) VALUES(?,?,?)', (time.time(), label, detail))


def require(value, message):
    if not value:
        raise ValueError(message)


def clean_item(item):
    require(isinstance(item, dict), 'Item inválido.')
    kind = item.get('kind', '')
    require(kind in KINDS, 'Tipo de item inválido.')
    title = str(item.get('title', '')).strip()
    require(0 < len(title) <= 200, 'Informe um nome de até 200 caracteres.')
    result = {'id': str(item.get('id') or uuid.uuid4()), 'kind': kind, 'title': title}
    limits = {'description': 3500, 'private': 8000, 'affiliation': 200, 'category': 120,
              'url': 2000, 'file': 100, 'channel': 30, 'kenku_id': 200, 'tags': 300, 'folder_id': 100, 'section': 30}
    for key, limit in limits.items():
        result[key] = str(item.get(key, '')).strip()
        require(len(result[key]) <= limit, f'O campo {key} ultrapassa {limit} caracteres.')
    result['section'] = result['section'] or ('personagens' if kind == 'personagem' else 'audio' if kind == 'musica' else 'outros')
    require(result['section'] in ('personagens', 'ambientacao', 'outros', 'audio'), 'Seção inválida.')
    if result['folder_id']:
        parent = get_item(result['folder_id'])
        require(parent['kind'] == 'pasta' and parent.get('section') == result['section'], 'Escolha uma pasta desta seção.')
        seen = {result['id']}
        while parent:
            require(parent['id'] not in seen, 'Uma pasta não pode conter ela mesma.')
            seen.add(parent['id'])
            parent = get_item(parent['folder_id']) if parent.get('folder_id') else None
    if result['url']:
        require(urllib.parse.urlparse(result['url']).scheme in ('https', 'http'), 'Use um link HTTP ou HTTPS.')
    if result['file']:
        require(Path(result['file']).name == result['file'] and (DATA / 'files' / result['file']).is_file(), 'Arquivo não encontrado.')
    if result['channel']:
        channel_id(result['channel'])
    result['kenku_type'] = 'soundboard' if item.get('kenku_type') == 'soundboard' else 'playlist'
    result['members'] = list(dict.fromkeys(str(x) for x in item.get('members', [])))[:20]
    require(result['id'] not in result['members'], 'Uma cena não pode conter ela mesma.')
    return result


def all_items():
    with db() as con:
        return [json.loads(r[0]) for r in con.execute('SELECT body FROM items ORDER BY rowid DESC')]


def get_item(item_id):
    with db() as con:
        row = con.execute('SELECT body FROM items WHERE id=?', (item_id,)).fetchone()
    require(row, 'Item não encontrado.')
    return json.loads(row[0])


def channel_id(value):
    require(str(value).isdigit() and 15 <= len(str(value)) <= 22, 'Informe o ID do canal de texto do Discord (15 a 22 números).')
    return str(value)


def http_json(url, method='GET', data=None, headers=None, raw=None):
    headers = dict(headers or {})
    if data is not None:
        raw = json.dumps(data).encode('utf-8')
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(url, data=raw, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            body = response.read()
            return json.loads(body) if body else {}
    except urllib.error.HTTPError as exc:
        # Never include request headers or credentials in diagnostics.
        messages = {401: 'Token do bot inválido.', 403: 'O bot não tem permissão neste canal.',
                    404: 'Recurso não encontrado. Confira os IDs.', 429: 'Limite de pedidos atingido. Aguarde antes de tentar novamente.'}
        detail = ''
        if exc.code == 400:
            try:
                detail = ': ' + json.loads(exc.read()).get('message', 'Dados recusados')
            except (ValueError, AttributeError):
                pass
        raise ValueError(messages.get(exc.code, f'O serviço recusou o pedido ({exc.code}){detail}')) from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise ValueError('Não foi possível alcançar o serviço. Confira a conexão e se ele está aberto. Se era um envio, confira o Discord antes de repetir.') from None


def discord(path, method='GET', payload=None, file=None):
    require(TOKEN, 'Conecte o bot na aba Conexões antes de enviar.')
    headers = {'Authorization': 'Bot ' + TOKEN, 'User-Agent': 'MesaDoMestre/0.1 (local campaign app)'}
    raw = None
    if file:
        boundary = 'mesa' + secrets.token_hex(16)
        name = Path(file).name
        content = (DATA / 'files' / name).read_bytes()
        payload = dict(payload)
        payload['attachments'] = [{'id': 0, 'filename': name}]
        raw = (f'--{boundary}\r\nContent-Disposition: form-data; name="payload_json"\r\nContent-Type: application/json\r\n\r\n'.encode()
               + json.dumps(payload).encode() + f'\r\n--{boundary}\r\nContent-Disposition: form-data; name="files[0]"; filename="{name}"\r\nContent-Type: {mimetypes.guess_type(name)[0] or "application/octet-stream"}\r\n\r\n'.encode()
               + content + f'\r\n--{boundary}--\r\n'.encode())
        headers['Content-Type'] = 'multipart/form-data; boundary=' + boundary
        payload = None
    return http_json('https://discord.com/api/v10' + path, method, payload, headers, raw)


def embed_payload(item):
    embed = {'title': item['title'], 'color': 12297836,
             'footer': {'text': settings()['campaign'][:200]}, 'description': item.get('description') or ' '}
    if item.get('affiliation'):
        embed['fields'] = [{'name': 'Afiliação', 'value': item['affiliation'], 'inline': True}]
    file = item.get('file') or None
    if file and Path(file).suffix.lower() in {'.png', '.jpg', '.jpeg', '.webp', '.gif'}:
        embed['image'] = {'url': 'attachment://' + file}
    return {'embeds': [embed], 'allowed_mentions': {'parse': []}}, file


def kenku(action, data=None):
    if action == 'folder':
        folder = get_item(data['id'])
        require(folder['kind'] == 'pasta' and folder.get('section') == 'audio', 'Pasta de músicas inválida.')
        items = all_items()
        def tracks_in(parent):
            result = []
            for item in reversed(items):
                if item.get('folder_id') != parent: continue
                if item['kind'] == 'pasta': result.extend(tracks_in(item['id']))
                elif item['kind'] == 'musica':
                    require(item.get('kenku_id') and item.get('kenku_type') != 'soundboard', 'Associe todas as músicas da pasta a faixas ou playlists do player integrado.')
                    result.append(item['kenku_id'])
            return result
        ids = tracks_in(folder['id'])
        require(ids and len(ids) <= 500, 'A pasta precisa ter de 1 a 500 músicas.')
        library = kenku('library')
        known = {t['id'] for t in library.get('tracks', [])}
        playlists = {p['id']: p for p in library.get('playlists', [])}
        tracks = []
        for entry in ids:
            require(entry in known or entry in playlists, 'Uma música não existe mais no player. Importe-a novamente.')
            tracks.extend([entry] if entry in known else playlists[entry]['tracks'])
        require(tracks and len(tracks) <= 2000, 'A sequência deve conter de 1 a 2000 faixas.')
        return http_json(f'http://127.0.0.1:{settings()["kenku_port"]}/v1/playlist/play', 'PUT', {'id': tracks[0], 'tracks': tracks})
    routes = {'library': ('GET', '/playlist'), 'sounds': ('GET', '/soundboard'),
              'state': ('GET', '/playlist/playback'), 'play': ('PUT', '/playlist/play'),
              'effect': ('PUT', '/soundboard/play'), 'stop_effect': ('PUT', '/soundboard/stop'),
              'pause': ('PUT', '/playlist/playback/pause'), 'resume': ('PUT', '/playlist/playback/play'),
              'next': ('POST', '/playlist/playback/next'), 'previous': ('POST', '/playlist/playback/previous'),
              'volume': ('PUT', '/playlist/playback/volume')}
    require(action in routes, 'Ação de áudio inválida.')
    method, path = routes[action]
    payload = None
    if action in ('play', 'effect', 'stop_effect'):
        require(data and data.get('id'), 'Informe o ID do item no Kenku.')
        payload = {'id': str(data['id'])}
    if action == 'volume':
        value = float(data['volume'])
        require(0 <= value <= 1, 'Volume inválido.')
        payload = {'volume': value}
    return http_json(f'http://127.0.0.1:{settings()["kenku_port"]}/v1' + path, method, payload)


def build_steps(item, channel):
    """Snapshot public content at scheduling time; private notes never leave the app."""
    config = settings()
    channel = channel or item.get('channel') or config.get('ambience_channel') or config['channel']
    entries = [item]
    if item['kind'] == 'cena':
        children = [get_item(i) for i in item.get('members', [])]
        require(all(i['kind'] not in ('cena', 'nota') for i in children), 'Cenas aceitam personagens, imagens e músicas.')
        entries += children
    steps = []
    for entry in entries:
        if entry['kind'] == 'musica':
            require(entry.get('kenku_id'), f'Associe “{entry["title"]}” a um ID do Kenku para disparar áudio.')
            steps.append({'type': 'audio', 'action': 'effect' if entry['kenku_type'] == 'soundboard' else 'play', 'id': entry['kenku_id']})
        else:
            require(entry['kind'] != 'nota', 'Notas são privadas e não podem ser publicadas.')
            payload, file = embed_payload(entry)
            steps.append({'type': 'message', 'channel': channel_id(channel), 'payload': payload, 'file': file})
    return steps


def make_poll(data):
    title = str(data.get('title', '')).strip()
    answers = [str(x).strip() for x in data.get('answers', []) if str(x).strip()]
    require(0 < len(title) <= 200, 'Informe uma pergunta de até 200 caracteres.')
    require(2 <= len(answers) <= 10 and all(len(x) <= 55 for x in answers), 'Use de 2 a 10 opções, com até 55 caracteres cada.')
    require(len(set(answers)) == len(answers), 'As opções devem ser diferentes.')
    duration = int(data.get('duration', 48))
    require(1 <= duration <= 768, 'A enquete deve durar de 1 a 768 horas.')
    payload = {'allowed_mentions': {'parse': []}, 'embeds': [{
        'title': '📅 Próxima sessão', 'description': 'Marque todos os horários em que você pode jogar.',
        'color': 12297836, 'footer': {'text': settings()['campaign'][:200]}}],
        'poll': {'question': {'text': title}, 'answers': [{'poll_media': {'text': x}} for x in answers],
                 'duration': duration, 'allow_multiselect': True, 'layout_type': 1}}
    return [{'type': 'message', 'channel': channel_id(data.get('channel') or settings()['channel']), 'payload': payload}]


def create_job(data):
    if data.get('type') == 'poll':
        steps = make_poll(data)
        title = data['title']
    else:
        item = get_item(data['item_id'])
        steps = build_steps(item, data.get('channel'))
        title = item['title']
    due = float(data.get('due') or time.time())
    require(due > 0 and due < time.time() + 366 * 86400, 'Escolha uma data dentro dos próximos 12 meses.')
    repeat = bool(data.get('weekly'))
    require(not repeat or data.get('type') == 'poll', 'A repetição semanal é reservada às enquetes.')
    job_id = str(uuid.uuid4())
    body = {'title': title, 'steps': steps, 'weekly': repeat, 'sent': []}
    with db() as con:
        con.execute('INSERT INTO jobs(id,due,status,body) VALUES(?,?,?,?)', (job_id, due, 'pendente', json.dumps(body)))
    return {'id': job_id}


def confirm_session(data):
    title = str(data.get('title', '')).strip()
    require(0 < len(title) <= 200, 'Informe um nome de até 200 caracteres para a sessão.')
    when = float(data['when'])
    require(time.time() < when < time.time() + 366 * 86400, 'Escolha uma data futura dentro de 12 meses.')
    channel = channel_id(data.get('channel') or settings()['channel'])
    require(TOKEN, 'Conecte o bot antes de confirmar a sessão.')
    jobs = [(time.time(), 'Sessão confirmada', f'Nos encontramos em <t:{int(when)}:F>.\nAté lá, aventureiros!')]
    if data.get('reminders', True):
        for delta, label in [(86400, 'Sua sessão é amanhã'), (3600, 'Sua sessão começa em 1 hora')]:
            if when - delta > time.time():
                jobs.append((when - delta, label, f'Prepare os dados! Nossa sessão será em <t:{int(when)}:F>.'))
    ids = []
    with db() as con:
        for due, label, description in jobs:
            job_id = str(uuid.uuid4())
            payload = {'allowed_mentions': {'parse': []}, 'embeds': [{'title': label + ' · ' + title,
                'description': description, 'color': 12297836, 'footer': {'text': settings()['campaign']}}]}
            body = {'title': label + ' · ' + title, 'weekly': False, 'sent': [],
                    'steps': [{'type': 'message', 'channel': channel, 'payload': payload}]}
            con.execute('INSERT INTO jobs(id,due,status,body) VALUES(?,?,?,?)', (job_id, due, 'pendente', json.dumps(body)))
            ids.append(job_id)
    return {'ids': ids}


def run_job(job_id):
    with LOCK:
        with db() as con:
            row = con.execute('SELECT * FROM jobs WHERE id=?', (job_id,)).fetchone()
            if not row or row['status'] != 'pendente':
                return
            body = json.loads(row['body'])
            if any(s['type'] == 'message' for s in body['steps']) and not TOKEN:
                return
            con.execute("UPDATE jobs SET status='enviando' WHERE id=?", (job_id,))
        try:
            for step in body['steps']:
                if step['type'] == 'audio':
                    kenku(step['action'], {'id': step['id']})
                else:
                    result = discord('/channels/' + step['channel'] + '/messages', 'POST', step['payload'], step.get('file'))
                    body['sent'].append({'channel': step['channel'], 'id': result['id'], 'poll': 'poll' in step['payload']})
                with db() as con:
                    con.execute('UPDATE jobs SET body=? WHERE id=?', (json.dumps(body), job_id))
            with db() as con:
                con.execute("UPDATE jobs SET status='enviado',result='Enviado com sucesso.' WHERE id=?", (job_id,))
                if body['weekly']:
                    next_due = row['due'] + 7 * 86400
                    while next_due <= time.time():
                        next_due += 7 * 86400
                    next_body = dict(body, sent=[])
                    con.execute('INSERT INTO jobs(id,due,status,body) VALUES(?,?,?,?)', (str(uuid.uuid4()), next_due, 'pendente', json.dumps(next_body)))
            log(body['title'], 'Disparo concluído.')
        except Exception as exc:
            with db() as con:
                con.execute("UPDATE jobs SET status='falhou',result=? WHERE id=?", (str(exc), job_id))
            log(body['title'], 'Falha no disparo. Verifique a agenda e o Discord antes de repetir.')


def scheduler():
    while True:
        try:
            with db() as con:
                rows = con.execute("SELECT id FROM jobs WHERE status='pendente' AND due<=? ORDER BY due", (time.time(),)).fetchall()
            for row in rows:
                run_job(row[0])
        except Exception:
            pass
        time.sleep(3)


def state():
    with db() as con:
        jobs = [dict(r) for r in con.execute('SELECT * FROM jobs ORDER BY due DESC LIMIT 100')]
        history = [dict(r) for r in con.execute('SELECT * FROM history ORDER BY id DESC LIMIT 30')]
    for job in jobs:
        job['body'] = json.loads(job['body'])
    return {'settings': settings(), 'items': all_items(), 'jobs': jobs, 'history': history, 'connected': bool(TOKEN)}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def respond(self, body, status=200, mime='application/json', extra=None):
        if not isinstance(body, bytes):
            body = json.dumps(body, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; media-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def authorized(self):
        host = self.headers.get('Host', '')
        cookie = self.headers.get('Cookie', '')
        return host == f'127.0.0.1:{self.server.server_port}' and ('mesa=' + SESSION) in cookie.split('; ')

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == '/health' and self.headers.get('Host') == f'127.0.0.1:{self.server.server_port}':
            self.respond({'app': 'MesaDoMestre', 'ready': True})
            return
        if parsed.path == '/open' and urllib.parse.parse_qs(parsed.query).get('key', [''])[0] == SESSION and self.headers.get('Host') == f'127.0.0.1:{self.server.server_port}':
            self.respond(b'', 302, extra={'Location': '/', 'Set-Cookie': f'mesa={SESSION}; HttpOnly; SameSite=Strict; Path=/'})
            return
        if not self.authorized():
            self.respond({'error': 'Abra o programa pelo Iniciar.cmd.'}, 403)
            return
        try:
            if parsed.path == '/api/state':
                self.respond(state())
            elif parsed.path == '/api/backup':
                buffer = io.BytesIO()
                with LOCK, zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as archive:
                    snapshot = DATA / 'backup-snapshot.sqlite3'
                    with db() as source:
                        target = sqlite3.connect(snapshot)
                        try:
                            source.backup(target)
                        finally:
                            target.close()
                    archive.write(snapshot, 'data/mesa.sqlite3')
                    snapshot.unlink()
                    for file in (DATA / 'files').iterdir():
                        if file.is_file():
                            archive.write(file, 'data/files/' + file.name)
                self.respond(buffer.getvalue(), mime='application/zip', extra={'Content-Disposition': 'attachment; filename="mesa-backup.zip"'})
            else:
                if parsed.path.startswith('/files/'):
                    name = urllib.parse.unquote(parsed.path[7:])
                    require(Path(name).name == name and Path(name).suffix.lower() in EXTENSIONS, 'Arquivo inválido.')
                    path = DATA / 'files' / name
                else:
                    name = 'index.html' if parsed.path == '/' else parsed.path.lstrip('/')
                    require(name in {'index.html', 'app.js', 'style.css', 'kenku-theme.css'}, 'Página não encontrada.')
                    path = ROOT / 'static' / name
                self.respond(path.read_bytes(), mime=mimetypes.guess_type(path.name)[0] or 'application/octet-stream')
        except (ValueError, FileNotFoundError) as exc:
            self.respond({'error': str(exc)}, 404)

    def do_POST(self):
        global TOKEN
        if not self.authorized() or self.headers.get('X-Mesa') != 'local' or self.headers.get('Origin', f'http://127.0.0.1:{self.server.server_port}') != f'http://127.0.0.1:{self.server.server_port}':
            self.respond({'error': 'Acesso local necessário.'}, 403)
            return
        try:
            length = int(self.headers.get('Content-Length', 0))
            require(0 < length <= 18_000_000, 'Pedido vazio ou arquivo muito grande (máximo 12 MB).')
            data = json.loads(self.rfile.read(length))
            route = self.path
            result = {'ok': True}
            if route == '/api/items/save':
                item = clean_item(data)
                with db() as con:
                    con.execute('INSERT INTO items VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body', (item['id'], json.dumps(item)))
                result = item
            elif route == '/api/items/delete':
                require(not any(i.get('folder_id') == data['id'] for i in all_items()), 'Mova os itens para fora da pasta antes de excluir.')
                require(not any(data['id'] in i.get('members', []) for i in all_items()), 'Remova este item das cenas antes de excluir.')
                with db() as con:
                    con.execute('DELETE FROM items WHERE id=?', (data['id'],))
            elif route == '/api/upload':
                extension = Path(data['name']).suffix.lower()
                require(extension in EXTENSIONS, 'Use imagem PNG/JPG/WebP/GIF, áudio MP3/OGG/WAV/M4A ou PDF.')
                content = base64.b64decode(data['content'], validate=True)
                require(len(content) <= 12_000_000, 'O limite por arquivo é 12 MB.')
                name = uuid.uuid4().hex + extension
                (DATA / 'files' / name).write_bytes(content)
                result = {'file': name}
            elif route == '/api/settings':
                config = settings()
                require(0 < len(str(data.get('campaign', '')).strip()) <= 200, 'Informe o nome da campanha (até 200 caracteres).')
                config['campaign'] = data['campaign'].strip()
                config['channel'] = str(data.get('channel', '')).strip()
                if config['channel']:
                    channel_id(config['channel'])
                config['ambience_channel'] = str(data.get('ambience_channel', config.get('ambience_channel', ''))).strip()
                if config['ambience_channel']:
                    channel_id(config['ambience_channel'])
                config['kenku_port'] = int(data.get('kenku_port', 3333))
                require(1024 <= config['kenku_port'] <= 65535, 'Porta do Kenku inválida.')
                with db() as con:
                    con.execute('UPDATE settings SET body=? WHERE id=1', (json.dumps(config),))
            elif route == '/api/connect':
                previous = TOKEN
                TOKEN = str(data.get('token', '')).strip()
                try:
                    user = discord('/users/@me')
                    require(user.get('bot'), 'Use um token de bot do Discord.')
                except Exception:
                    TOKEN = previous
                    raise
                result = {'name': user['username'], 'id': user['id']}
            elif route == '/api/disconnect':
                TOKEN = ''
            elif route == '/api/preview':
                result = {'steps': build_steps(get_item(data['item_id']), data.get('channel'))}
            elif route == '/api/jobs':
                result = create_job(data)
            elif route == '/api/session':
                result = confirm_session(data)
            elif route == '/api/jobs/cancel':
                with db() as con:
                    con.execute("UPDATE jobs SET status='cancelado' WHERE id=? AND status='pendente'", (data['id'],))
            elif route == '/api/poll/results':
                with db() as con:
                    row = con.execute('SELECT body FROM jobs WHERE id=?', (data['id'],)).fetchone()
                require(row, 'Enquete não encontrada.')
                sent = [x for x in json.loads(row[0])['sent'] if x['poll']]
                require(sent, 'A enquete ainda não foi enviada.')
                ref = sent[-1]
                result = discord('/channels/' + ref['channel'] + '/messages/' + ref['id'])
            elif route == '/api/kenku':
                result = kenku(data['action'], data)
            else:
                raise ValueError('Ação não encontrada.')
            self.respond(result)
        except (ValueError, KeyError, TypeError, OSError) as exc:
            self.respond({'error': str(exc)}, 400)
        except Exception:
            self.respond({'error': 'Falha inesperada. Seus dados salvos foram preservados.'}, 500)


def wait_ready(port):
    # Local requests must not be sent through a corporate/system HTTP proxy.
    client = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for attempt in range(5):
        try:
            with client.open(f'http://127.0.0.1:{port}/health', timeout=2) as response:
                return json.load(response).get('app') == 'MesaDoMestre'
        except (OSError, ValueError):
            time.sleep(.2)
    return False


def main():
    DATA.mkdir(parents=True, exist_ok=True)
    instance_path = DATA / 'instance.json'
    lock = open(DATA / 'instance.lock', 'a+b')
    if os.name == 'nt':
        import msvcrt
        lock.seek(0, 2)
        if not lock.tell():
            lock.write(b'0')
            lock.flush()
        lock.seek(0)
        try:
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            lock.close()
            try:
                existing = json.loads(instance_path.read_text(encoding='utf-8'))
                if wait_ready(existing['port']):
                    webbrowser.open(existing['url'])
                    print('A Mesa do Mestre já está funcionando. O painel foi reaberto.', flush=True)
                    return
            except (OSError, ValueError, KeyError):
                pass
            raise RuntimeError('Outra Mesa do Mestre está iniciando ou parou de responder. Feche a janela anterior e tente novamente.')
    server = None
    try:
        init()
        # Let Windows choose a free port instead of relying on a fixed one.
        server = ThreadingHTTPServer(('127.0.0.1', int(os.environ.get('MESA_PORT', '0'))), Handler)
        server.daemon_threads = True
        threading.Thread(target=server.serve_forever, daemon=True).start()
        if not wait_ready(server.server_port):
            raise RuntimeError('O servidor iniciou, mas a conexão local não respondeu. Confira o registro de inicialização antes de tentar de novo.')
        url = f'http://127.0.0.1:{server.server_port}/open?key={SESSION}'
        instance_path.write_text(json.dumps({'port': server.server_port, 'url': url}), encoding='utf-8')
        (DATA / 'Abrir painel.url').write_text('[InternetShortcut]\nURL=' + url + '\n', encoding='utf-8')
        if os.environ.get('MESA_TEST_URL_FILE'):
            Path(os.environ['MESA_TEST_URL_FILE']).write_text(url)
        (DATA / 'inicio.log').write_text(f'OK: painel local respondendo na porta {server.server_port}.\n', encoding='utf-8')
        threading.Thread(target=scheduler, daemon=True).start()
        print('Mesa do Mestre pronta. Mantenha esta janela aberta enquanto usar o programa.', flush=True)
        print('Se o navegador não abrir, use o atalho data/Abrir painel.url nesta pasta.', flush=True)
        if not os.environ.get('MESA_NO_BROWSER'):
            webbrowser.open(url)
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    finally:
        if server:
            server.shutdown()
            server.server_close()
        lock.close()


if __name__ == '__main__':
    try:
        main()
    except Exception:
        DATA.mkdir(parents=True, exist_ok=True)
        (DATA / 'inicio.log').write_text(traceback.format_exc(), encoding='utf-8')
        print('Não foi possível iniciar a Mesa do Mestre. O detalhe está em data/inicio.log.', flush=True)
        raise SystemExit(1)
