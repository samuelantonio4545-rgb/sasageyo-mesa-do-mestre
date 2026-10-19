import base64
import http.cookiejar
import io
import json
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app


class MesaTests(unittest.TestCase):
    def setUp(self):
        test_root = Path(__file__).resolve().parents[3] / 'work' / 'tests'
        test_root.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=test_root)
        self.old_data = app.DATA
        app.DATA = Path(self.temp.name)
        app.TOKEN = ''
        app.init()

    def tearDown(self):
        app.DATA = self.old_data
        app.TOKEN = ''
        self.temp.cleanup()

    def item(self, **fields):
        data = app.clean_item(dict(kind='personagem', title='Seraphine', private='SEGREDO', **fields))
        with app.db() as con:
            con.execute('INSERT INTO items VALUES(?,?)', (data['id'], json.dumps(data)))
        return data

    def test_private_notes_never_leave_in_payload(self):
        item = self.item(description='Embaixadora', affiliation='Conselho')
        steps = app.build_steps(item, '123456789012345678')
        self.assertNotIn('SEGREDO', json.dumps(steps))
        self.assertEqual(steps[0]['payload']['allowed_mentions'], {'parse': []})
        self.assertIn('Conselho', json.dumps(steps))

    def test_general_and_ambience_channels(self):
        config = dict(app.settings(), channel='111111111111111111', ambience_channel='222222222222222222')
        with app.db() as con:
            con.execute('UPDATE settings SET body=? WHERE id=1', (json.dumps(config),))
        item = self.item()
        self.assertEqual(app.build_steps(item, '')[0]['channel'], config['ambience_channel'])
        self.assertEqual(app.make_poll({'title':'Quando?', 'answers':['Sexta','Sábado']})[0]['channel'], config['channel'])
        self.assertEqual(app.build_steps(item, '333333333333333333')[0]['channel'], '333333333333333333')

    def test_snapshot_preserves_scheduled_public_content(self):
        item = self.item(description='Original')
        job = app.create_job({'item_id':item['id'], 'channel':'123456789012345678', 'due':time.time()+60})
        with app.db() as con:
            item['description'] = 'Alterado'
            con.execute('UPDATE items SET body=? WHERE id=?', (json.dumps(item),item['id']))
            saved = con.execute('SELECT body FROM jobs WHERE id=?', (job['id'],)).fetchone()[0]
        self.assertIn('Original', saved)
        self.assertNotIn('Alterado', saved)

    def test_missing_token_holds_job_and_success_does_not_repeat(self):
        item = self.item()
        job = app.create_job({'item_id':item['id'], 'channel':'123456789012345678'})
        app.run_job(job['id'])
        self.assertEqual(app.state()['jobs'][0]['status'], 'pendente')
        app.TOKEN = 'test-only'
        with patch.object(app,'discord', return_value={'id':'987654321098765432'}) as send:
            app.run_job(job['id'])
            app.run_job(job['id'])
        self.assertEqual(send.call_count, 1)
        self.assertEqual(app.state()['jobs'][0]['status'], 'enviado')

    def test_failure_is_not_automatically_retried(self):
        item = self.item()
        job = app.create_job({'item_id':item['id'], 'channel':'123456789012345678'})
        app.TOKEN = 'test-only'
        with patch.object(app, 'discord', side_effect=ValueError('Sem conexão')) as send:
            app.run_job(job['id'])
            app.run_job(job['id'])
        self.assertEqual(send.call_count, 1)
        self.assertEqual(app.state()['jobs'][0]['status'], 'falhou')

    def test_weekly_poll_skips_missed_weeks(self):
        job=app.create_job({'type':'poll','title':'Quando?', 'answers':['Sexta','Sábado'], 'channel':'123456789012345678','weekly':True,'due':time.time()-15*86400})
        app.TOKEN='test-only'
        with patch.object(app,'discord',return_value={'id':'123456789012345678'}):
            app.run_job(job['id'])
        pending=[j for j in app.state()['jobs'] if j['status']=='pendente']
        self.assertEqual(len(pending),1)
        self.assertGreater(pending[0]['due'], time.time())
        self.assertLess(pending[0]['due'], time.time()+7*86400)

    def test_restarted_inflight_job_needs_review(self):
        item=self.item()
        job=app.create_job({'item_id':item['id'],'channel':'123456789012345678'})
        with app.db() as con:
            con.execute("UPDATE jobs SET status='enviando' WHERE id=?",(job['id'],))
        app.init()
        self.assertEqual(app.state()['jobs'][0]['status'],'incerto')

    def test_validation_and_poll_bounds(self):
        for url in ['javascript:alert(1)', 'file:///C:/secret']:
            with self.assertRaises(ValueError):
                app.clean_item({'kind':'musica','title':'Teste','url':url})
        with self.assertRaises(ValueError):
            app.clean_item({'kind':'imagem','title':'Teste','file':'../private.txt'})
        for answers in [['x'], ['x','x'], ['x'*56,'y']]:
            with self.assertRaises(ValueError):
                app.make_poll({'title':'Quando?','answers':answers,'channel':'123456789012345678'})

    def test_session_confirmation_creates_only_future_reminders(self):
        app.TOKEN='test-only'
        result=app.confirm_session({'title':'A aventura','when':time.time()+2*86400,'channel':'123456789012345678'})
        self.assertEqual(len(result['ids']),3)
        soon=app.confirm_session({'title':'Sessão breve','when':time.time()+1800,'channel':'123456789012345678'})
        self.assertEqual(len(soon['ids']),1)

    def test_kenku_documented_routes(self):
        with patch.object(app,'http_json',return_value={}) as request:
            app.kenku('play',{'id':'track-1'})
            self.assertEqual(request.call_args.args, ('http://127.0.0.1:3333/v1/playlist/play','PUT',{'id':'track-1'}))
            app.kenku('next')
            self.assertEqual(request.call_args.args[1], 'POST')
            app.kenku('previous')
            self.assertEqual(request.call_args.args, ('http://127.0.0.1:3333/v1/playlist/playback/previous','POST',None))
            app.kenku('effect',{'id':'effect-1'})
            self.assertIn('/soundboard/play', request.call_args.args[0])

    def test_http_auth_upload_persistence_and_backup(self):
        server=app.ThreadingHTTPServer(('127.0.0.1',0),app.Handler)
        thread=threading.Thread(target=server.serve_forever,daemon=True)
        thread.start()
        base=f'http://127.0.0.1:{server.server_port}'
        client=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        def post(path,data,headers=None):
            req=urllib.request.Request(base+path,data=json.dumps(data).encode(),headers=headers or {'Content-Type':'application/json','X-Mesa':'local'})
            with client.open(req) as res:
                return json.load(res)
        try:
            with self.assertRaises(urllib.error.HTTPError) as error:
                client.open(base+'/api/state')
            self.assertEqual(error.exception.code,403)
            client.open(base+'/open?key='+app.SESSION).close()
            with self.assertRaises(urllib.error.HTTPError):
                post('/api/items/save',{}, {'Content-Type':'application/json'})
            uploaded=post('/api/upload',{'name':'map.png','content':base64.b64encode(b'example asset').decode()})
            saved=post('/api/items/save',{'kind':'imagem','title':'Mapa','file':uploaded['file']})
            self.assertEqual(saved['title'],'Mapa')
            with client.open(base+'/api/state') as res:
                self.assertEqual(json.load(res)['items'][0]['file'],uploaded['file'])
            app.TOKEN='secret-not-exported'
            with client.open(base+'/api/backup') as res:
                archive=zipfile.ZipFile(io.BytesIO(res.read()))
            self.assertIn('data/mesa.sqlite3',archive.namelist())
            self.assertIn('data/files/'+uploaded['file'],archive.namelist())
            self.assertNotIn(b'secret-not-exported',archive.read('data/mesa.sqlite3'))
        finally:
            server.shutdown()
            server.server_close()


if __name__=='__main__':
    unittest.main()
