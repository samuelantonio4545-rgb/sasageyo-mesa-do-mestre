import json
from unittest.mock import patch
from test_app import MesaTests, app


class FolderTests(MesaTests):
    def save(self, **values):
        item = app.clean_item(values)
        with app.db() as con:
            con.execute('INSERT OR REPLACE INTO items VALUES(?,?)', (item['id'], json.dumps(item)))
        return item

    def test_nested_folders_and_cycle_protection(self):
        parent = self.save(kind='pasta', title='Cidade', section='ambientacao')
        child = self.save(kind='pasta', title='Taverna', section='ambientacao', folder_id=parent['id'])
        image = self.save(kind='imagem', title='Salão', section='ambientacao', folder_id=child['id'])
        app.init()
        self.assertEqual(app.get_item(image['id'])['folder_id'], child['id'])
        with self.assertRaises(ValueError):
            app.clean_item(dict(parent, folder_id=child['id']))
        with self.assertRaises(ValueError):
            app.clean_item(dict(image, section='outros'))

    def test_folder_sequence_expands_playlists_in_order(self):
        folder = self.save(kind='pasta', title='Luta', section='audio')
        self.save(kind='musica', title='Entrada', section='audio', folder_id=folder['id'], kenku_id='one')
        sub = self.save(kind='pasta', title='Chefe', section='audio', folder_id=folder['id'])
        self.save(kind='musica', title='Final', section='audio', folder_id=sub['id'], kenku_id='list')
        library = {'tracks': [{'id': 'one'}, {'id': 'two'}, {'id': 'three'}], 'playlists': [{'id': 'list', 'tracks': ['two', 'three']}]}
        with patch.object(app, 'http_json', side_effect=[library, {'ok': True}]) as request:
            app.kenku('folder', {'id': folder['id']})
        self.assertEqual(request.call_args.args[2], {'id': 'one', 'tracks': ['one', 'two', 'three']})

    def test_unconfigured_music_does_not_start_partial_queue(self):
        folder = self.save(kind='pasta', title='Luta', section='audio')
        self.save(kind='musica', title='Sem áudio', section='audio', folder_id=folder['id'])
        with patch.object(app, 'http_json') as request:
            with self.assertRaises(ValueError):
                app.kenku('folder', {'id': folder['id']})
            request.assert_not_called()
