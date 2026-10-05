import importlib.util
import io
import json
import multiprocessing
import os
from pathlib import Path
import signal
import sqlite3
import tempfile
import time
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('media_backfill', Path(__file__).parents[2] / 'scripts' / 'media-backfill.py')
media = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(media)


def _run_media_cli(args):
    media.main(args)


class MediaAcquisitionTests(unittest.TestCase):
    def test_cli_recovers_committed_games_after_process_kill(self):
        self.assertIn('fork', multiprocessing.get_all_start_methods())
        context = multiprocessing.get_context('fork')
        third_game_started = context.Event()
        catalog = [
            {'fs_id': str(i), 'title': f'Game {i}', 'publisher': 'Publisher', 'price_discounted_f': 1,
             'price_has_discount_b': True, 'system_type': ['nintendoswitch_downloadsoftware'], 'url': f'/game{i}'}
            for i in range(1, 5)
        ]
        run_metadata = ({}, '"synthetic-revision"')

        def first_pass_gallery(url):
            if url.endswith('/game3'):
                third_game_started.set()
                while True:
                    time.sleep(0.05)
            return {'source': 'nintendo', 'screenshots': [f'https://www.nintendo.com/{url.rsplit("/", 1)[-1]}.jpg'], 'videos': [], 'collection_complete': True}

        with tempfile.TemporaryDirectory() as directory:
            run_dir = Path(directory) / 'run'
            argv = ['--base-url', 'https://example.test', '--all', '--run-dir', str(run_dir)]
            with patch.object(media, 'read_snapshot', side_effect=[run_metadata, ({}, None), ({}, None)]), \
                    patch.object(media, 'fetch_all_games', return_value=catalog), \
                    patch.object(media, 'fetch_nintendo_gallery', side_effect=first_pass_gallery), \
                    patch.object(media.steam, 'get_validated_steam_details', return_value=None), \
                    patch.object(media, 'TWITCH_CLIENT_ID', ''), patch.object(media, 'TWITCH_CLIENT_SECRET', ''), \
                    patch('sys.stdout', new_callable=io.StringIO):
                child = context.Process(target=_run_media_cli, args=(argv,))
                child.start()
                deadline = time.monotonic() + 20
                while child.is_alive() and not third_game_started.is_set() and time.monotonic() < deadline:
                    child.join(0.05)
                if not third_game_started.is_set():
                    if child.is_alive():
                        os.kill(child.pid, signal.SIGKILL)
                        child.join(10)
                    self.fail(f'crawler exited before game 3 (exit code {child.exitcode})')
                os.kill(child.pid, signal.SIGKILL)
                child.join(10)
                self.assertFalse(child.is_alive())
                self.assertEqual(child.exitcode, -signal.SIGKILL)

            resumed_urls = []
            def resumed_gallery(url):
                resumed_urls.append(url)
                return {'source': 'nintendo', 'screenshots': [f'https://www.nintendo.com/{url.rsplit("/", 1)[-1]}.jpg'], 'videos': [], 'collection_complete': True}

            with patch.object(media, 'read_snapshot', side_effect=AssertionError('resume must use frozen snapshots')), \
                    patch.object(media, 'fetch_all_games', side_effect=AssertionError('resume must use frozen catalog')), \
                    patch.object(media, 'fetch_nintendo_gallery', side_effect=resumed_gallery), \
                    patch.object(media.steam, 'get_validated_steam_details', return_value=None), \
                    patch.object(media, 'TWITCH_CLIENT_ID', ''), patch.object(media, 'TWITCH_CLIENT_SECRET', ''), \
                    patch('sys.stdout', new_callable=io.StringIO):
                media.main(['--base-url', 'https://example.test', '--resume', str(run_dir)])

            manifest = json.loads((run_dir / 'staged-manifest.json').read_text())
            self.assertEqual(set(manifest['records']), {'1', '2', '3', '4'})
            self.assertEqual(resumed_urls, ['/game3', '/game4'])
            database = sqlite3.connect(run_dir / 'checkpoint.sqlite3')
            try:
                self.assertEqual(database.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
            finally:
                database.close()

    def test_checkpoint_lock_and_resume_target_validation(self):
        with tempfile.TemporaryDirectory() as directory:
            run_dir = Path(directory) / 'run'
            checkpoint = media.RunCheckpoint(run_dir, create=True)
            metadata = {'base_url': 'https://example.test', 'existing': {}, 'ratings': {}, 'steam_ratings': {}}
            checkpoint.initialize(metadata, [])
            with self.assertRaisesRegex(RuntimeError, 'already locked'):
                media.RunCheckpoint(run_dir)
            checkpoint.close()
            with patch.object(media, 'read_snapshot', side_effect=AssertionError('resume must not read remote snapshots')):
                with self.assertRaisesRegex(RuntimeError, 'target does not match'):
                    media.main(['--base-url', 'https://other.test', '--resume', str(run_dir)])

    def test_checkpoint_write_failure_preserves_last_committed_game(self):
        with tempfile.TemporaryDirectory() as directory:
            run_dir = Path(directory) / 'run'
            checkpoint = media.RunCheckpoint(run_dir, create=True)
            metadata = {'base_url': 'https://example.test', 'existing': {}, 'ratings': {}, 'steam_ratings': {}}
            game = {'fs_id': '1', 'title': 'Game'}
            checkpoint.initialize(metadata, [game])
            committed = {'screenshots': ['https://www.nintendo.com/old.jpg'], 'videos': [], 'collection_complete': False}
            checkpoint.save_game('1', committed, {'nintendo': {'complete': False}})
            checkpoint.database.execute("CREATE TRIGGER reject_result_update BEFORE UPDATE ON results BEGIN SELECT RAISE(ABORT, 'injected write failure'); END")
            with self.assertRaises(sqlite3.IntegrityError):
                checkpoint.save_game('1', {'screenshots': [], 'videos': [], 'collection_complete': True}, {})
            self.assertEqual(checkpoint.results()['1']['after'], committed)
            checkpoint.close()

    def test_provider_failure_is_logged_and_later_games_continue(self):
        game = {'fs_id': '1', 'title': 'Game', 'publisher': 'Publisher', 'price_discounted_f': 1,
                'price_has_discount_b': True, 'system_type': ['nintendoswitch_downloadsoftware'], 'url': '/game'}
        second_game = {**game, 'fs_id': '2', 'title': 'Second Game', 'url': '/second'}
        requests = []
        def gallery(url):
            requests.append(url)
            if url == '/game':
                raise TimeoutError
            return {'source': 'nintendo', 'screenshots': ['https://www.nintendo.com/second.jpg'], 'videos': [], 'collection_complete': True}
        with tempfile.TemporaryDirectory() as directory:
            run_dir = Path(directory) / 'run'
            output = io.StringIO()
            with patch.object(media, 'read_snapshot', side_effect=[({}, '"rev"'), ({}, None), ({}, None)]), \
                    patch.object(media, 'fetch_all_games', return_value=[game, second_game]), \
                    patch.object(media, 'fetch_nintendo_gallery', side_effect=gallery), \
                    patch.object(media, 'fetch_validated_igdb_media', return_value={'source': 'igdb', 'screenshots': [], 'videos': [], 'collection_complete': True}), \
                    patch.object(media.steam, 'get_validated_steam_details', return_value=None), \
                    patch.object(media, 'read_url', return_value=b'{"access_token":"synthetic"}'), \
                    patch.object(media, 'TWITCH_CLIENT_ID', 'synthetic-client'), patch.object(media, 'TWITCH_CLIENT_SECRET', 'synthetic-secret'), \
                    patch('sys.stdout', output):
                media.main(['--base-url', 'https://example.test', '--all', '--run-dir', str(run_dir)])
            first = json.loads((run_dir / 'staged-manifest.json').read_text())
            self.assertEqual(first['checkpointed_count'], 2)
            self.assertEqual(first['complete_count'], 1)
            self.assertEqual(first['incomplete_count'], 1)
            self.assertEqual(first['pending_count'], 0)
            self.assertEqual(first['outcomes']['1']['providers']['nintendo']['error'], 'TimeoutError')
            self.assertEqual(requests, ['/game', '/second'])
            self.assertIn('1: Nintendo acquisition failed (TimeoutError)', output.getvalue())
            exported = Path(directory) / 'partial-export.json'
            with patch.object(media, 'read_snapshot', side_effect=AssertionError('export must not read snapshots')), \
                    patch.object(media, 'fetch_all_games', side_effect=AssertionError('export must not fetch catalog')), \
                    patch.object(media, 'fetch_nintendo_gallery', side_effect=AssertionError('export must not call providers')), \
                    patch.object(media, 'read_url', side_effect=AssertionError('export must not call providers')), \
                    patch('sys.stdout', new_callable=io.StringIO):
                media.main(['--base-url', 'https://example.test', '--resume', str(run_dir), '--export-only', '--output', str(exported)])
            exported_manifest = json.loads(exported.read_text())
            self.assertEqual(exported_manifest['pending_count'], 0)
            self.assertEqual(exported_manifest['incomplete_count'], 1)

    def test_vercel_oversize_response_refuses_apply_before_api_write(self):
        with tempfile.TemporaryDirectory() as directory:
            run_dir = Path(directory) / 'run'
            checkpoint = media.RunCheckpoint(run_dir, create=True)
            metadata = {
                'schema_version': 1,
                'base_url': 'https://nintendo-deals.vercel.app', 'revision': '"rev"',
                'run_id': 'run', 'run_dir': str(run_dir), 'created_at': 'now', 'catalog_count': 1,
                'selected_count': 1, 'existing': {'large': {'note': 'x' * (media.VERCEL_BODY_LIMIT + 1)}},
                'ratings': {}, 'steam_ratings': {},
            }
            game = {'fs_id': '1', 'title': 'Game'}
            checkpoint.initialize(metadata, [game])
            checkpoint.save_game('1', {'screenshots': ['https://www.nintendo.com/new.jpg'], 'videos': [], 'collection_complete': True}, {})
            reviewed_manifest = run_dir / 'staged-manifest.json'
            media.write_manifest(reviewed_manifest, checkpoint.metadata(), checkpoint.games(), checkpoint.results())
            checkpoint.close()
            with patch.dict(os.environ, {'RATINGS_API_KEY': 'synthetic'}), \
                    patch.object(media, 'save_to_vercel') as save, \
                    patch('sys.stdout', new_callable=io.StringIO):
                with self.assertRaisesRegex(RuntimeError, 'no write attempted'):
                    media.main(['--base-url', metadata['base_url'], '--resume', str(run_dir), '--apply', '--apply-manifest', str(reviewed_manifest)])
            save.assert_not_called()

    def test_retry_incomplete_explicitly_refetches_saved_partial_games(self):
        with tempfile.TemporaryDirectory() as directory:
            run_dir = Path(directory) / 'run'
            checkpoint = media.RunCheckpoint(run_dir, create=True)
            games = [
                {'fs_id': str(i), 'title': f'Game {i}', 'url': f'/game{i}'}
                for i in range(1, 4)
            ]
            metadata = {
                'schema_version': 1, 'run_id': 'run', 'run_dir': str(run_dir), 'created_at': 'now',
                'base_url': 'https://example.test', 'revision': '"rev"', 'catalog_count': 3,
                'selected_count': 3, 'existing': {}, 'ratings': {}, 'steam_ratings': {},
            }
            checkpoint.initialize(metadata, games)
            checkpoint.save_game('1', {'screenshots': [], 'videos': [], 'collection_complete': True}, {})
            checkpoint.save_game('2', {'screenshots': [], 'videos': [], 'collection_complete': False}, {})
            checkpoint.close()
            requested = []
            def gallery(url):
                requested.append(url)
                return {'source': 'nintendo', 'screenshots': [], 'videos': [], 'collection_complete': True}
            with patch.object(media, 'fetch_nintendo_gallery', side_effect=gallery), \
                    patch.object(media.steam, 'get_validated_steam_details', return_value=None), \
                    patch.object(media, 'TWITCH_CLIENT_ID', ''), patch.object(media, 'TWITCH_CLIENT_SECRET', ''), \
                    patch('sys.stdout', new_callable=io.StringIO):
                media.main(['--base-url', metadata['base_url'], '--resume', str(run_dir), '--retry-incomplete'])
            self.assertEqual(requested, ['/game2', '/game3'])

    def test_apply_requires_a_separate_resume_run(self):
        with patch('sys.stderr', new_callable=io.StringIO), self.assertRaises(SystemExit):
            media.main(['--base-url', 'https://example.test', '--apply'])

    def test_apply_requires_manifest_to_match_checkpoint_exactly(self):
        with tempfile.TemporaryDirectory() as directory:
            run_dir = Path(directory) / 'run'
            checkpoint = media.RunCheckpoint(run_dir, create=True)
            metadata = {
                'schema_version': 1, 'run_id': 'run', 'run_dir': str(run_dir), 'created_at': 'now',
                'base_url': 'https://example.test', 'revision': '"rev"', 'catalog_count': 1,
                'selected_count': 1, 'existing': {}, 'ratings': {}, 'steam_ratings': {},
            }
            after = {'screenshots': ['https://www.nintendo.com/game.jpg'], 'videos': [], 'collection_complete': True}
            checkpoint.initialize(metadata, [{'fs_id': '1', 'title': 'Game'}])
            checkpoint.save_game('1', after, {})
            manifest, _ = media.build_manifest(checkpoint.metadata(), checkpoint.games(), checkpoint.results())
            checkpoint.close()
            manifest['outcomes']['1']['title'] = 'Changed after review'
            manifest_path = run_dir / 'changed-manifest.json'
            with manifest_path.open('x') as output:
                json.dump(manifest, output)
            with patch.dict(os.environ, {'RATINGS_API_KEY': 'synthetic'}), \
                    patch.object(media, 'save_to_vercel') as save, \
                    patch('sys.stdout', new_callable=io.StringIO):
                with self.assertRaisesRegex(RuntimeError, 'does not match'):
                    media.main(['--base-url', metadata['base_url'], '--resume', str(run_dir), '--apply', '--apply-manifest', str(manifest_path)])
            save.assert_not_called()

    def test_matching_reviewed_manifest_applies_frozen_revision(self):
        with tempfile.TemporaryDirectory() as directory:
            run_dir = Path(directory) / 'run'
            checkpoint = media.RunCheckpoint(run_dir, create=True)
            metadata = {
                'schema_version': 1, 'run_id': 'run', 'run_dir': str(run_dir), 'created_at': 'now',
                'base_url': 'https://example.test', 'revision': '"rev"', 'catalog_count': 1,
                'selected_count': 1, 'existing': {}, 'ratings': {}, 'steam_ratings': {},
            }
            after = {'screenshots': ['https://www.nintendo.com/game.jpg'], 'videos': [], 'collection_complete': True}
            checkpoint.initialize(metadata, [{'fs_id': '1', 'title': 'Game'}])
            checkpoint.save_game('1', after, {})
            manifest_path = run_dir / 'staged-manifest.json'
            media.write_manifest(manifest_path, checkpoint.metadata(), checkpoint.games(), checkpoint.results())
            checkpoint.close()
            with patch.dict(os.environ, {'RATINGS_API_KEY': 'synthetic'}), \
                    patch.object(media, 'save_to_vercel', return_value={'ok': True}) as save, \
                    patch('sys.stdout', new_callable=io.StringIO):
                media.main(['--base-url', metadata['base_url'], '--resume', str(run_dir), '--apply', '--apply-manifest', str(manifest_path)])
            save.assert_called_once_with({'1': after}, metadata['base_url'], 'synthetic', metadata['revision'])

    def test_cli_stages_before_after_without_writes_and_refuses_output_overwrite(self):
        old = {'screenshots': ['https://www.nintendo.com/old.jpg'], 'videos': [], 'source': 'nintendo', 'igdb_url': None, 'last_updated': 'old'}
        urls = []
        class Response(io.BytesIO):
            headers = {'ETag': '"synthetic-revision"'}
        def provider(request, **kwargs):
            url = request if isinstance(request, str) else request.full_url
            urls.append(url)
            if not isinstance(request, str):
                self.assertEqual(request.get_method(), 'GET')
            if url.endswith('/api/media'): body = json.dumps({'123': old})
            elif url.endswith('/api/steam'): body = '{"123":{"steam_id":5}}'
            elif url.endswith('/api/ratings'): body = '{}'
            elif 'select?' in url: body = json.dumps({'response': {'numFound': 1, 'docs': [{'fs_id': '123', 'title': 'Game', 'publisher': 'Publisher', 'system_type': ['nintendoswitch_downloadsoftware'], 'url': '/game'}]}})
            elif 'appdetails?' in url: body = '{"5":{"success":false}}'
            else: body = "_gItems.push({'isVideo': false, 'image_url': 'https://www.nintendo.com/new.jpg'});"
            return Response(body.encode())
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'new-manifest.json'
            args = ['--base-url', 'https://example.test', '--game-id', '123', '--output', str(output)]
            with patch.object(media.urllib.request, 'urlopen', side_effect=provider), patch.object(media, 'TWITCH_CLIENT_ID', ''), patch('sys.stdout', new_callable=io.StringIO):
                media.main(args)
            manifest = json.loads(output.read_text())
            self.assertEqual(manifest['records']['123']['before'], old)
            self.assertEqual(manifest['records']['123']['after']['screenshots'], [old['screenshots'][0], 'https://www.nintendo.com/new.jpg'])
            original = output.read_bytes()
            with patch('sys.stderr', new_callable=io.StringIO), self.assertRaises(SystemExit):
                media.main(args)
            self.assertEqual(output.read_bytes(), original)
            self.assertFalse(any('/api/preferences' in url for url in urls))

    def test_all_cli_revisits_complete_entries_without_small_run_cap(self):
        old = {'screenshots': ['https://www.nintendo.com/old.jpg'], 'videos': [], 'source': 'nintendo', 'igdb_url': None, 'last_updated': 'old', 'collection_complete': True}
        snapshot = {str(i): old for i in range(1, 4)}
        catalog = [{'fs_id': str(i), 'title': 'Game', 'publisher': 'Publisher', 'price_discounted_f': 1, 'price_has_discount_b': True, 'system_type': ['nintendoswitch_downloadsoftware'], 'url': '/game'} for i in range(1, 4)]
        catalog += [{**catalog[0], 'fs_id': '99', 'price_discounted_f': 20}, {**catalog[0], 'fs_id': '98', 'title': 'Hentai Game'}]
        class Response(io.BytesIO):
            headers = {'ETag': '"synthetic-revision"'}
        def provider(request, **kwargs):
            url = request if isinstance(request, str) else request.full_url
            if url.endswith('/api/media'): body = json.dumps(snapshot)
            elif url.endswith('/api/steam'): body = json.dumps({str(i): {'steam_id': 5} for i in range(1, 4)})
            elif url.endswith('/api/ratings'): body = '{}'
            elif 'select?' in url: body = json.dumps({'response': {'numFound': len(catalog), 'docs': catalog}})
            elif 'appdetails?' in url: body = '{"5":{"success":false}}'
            else: body = "_gItems.push({'isVideo': false, 'image_url': 'https://www.nintendo.com/new.jpg'});"
            return Response(body.encode())
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'all.json'
            with patch.object(media.urllib.request, 'urlopen', side_effect=provider), patch.object(media, 'TWITCH_CLIENT_ID', ''), patch('sys.stdout', new_callable=io.StringIO):
                media.main(['--base-url', 'https://example.test', '--all', '--limit', '1', '--output', str(output)])
            self.assertEqual(set(json.loads(output.read_text())['records']), {'1', '2', '3'})

    def test_addon_rating_does_not_authorize_media_acquisition(self):
        addon = {'id': 171205, 'name': 'Blaster Master Zero: EX Character - Shantae', 'platforms': [{'name': 'Nintendo Switch'}], 'game_type': {'type': 'DLC Addon'}, 'parent_game': 123, 'url': 'https://www.igdb.com/games/shantae-addon'}
        urls = []
        def provider(url, *args):
            urls.append(url)
            return json.dumps([addon] if len(urls) == 1 else []).encode()
        with patch.object(media, 'read_url', side_effect=provider), patch.object(media.time, 'sleep'):
            result = media.fetch_validated_igdb_media({'title': 'Blaster Master Zero'}, 171205, 'synthetic')
        self.assertFalse(result['collection_complete'])
        self.assertEqual(result['videos'], [])
        self.assertTrue(all(url.endswith('/games') for url in urls))

    def test_verified_identity_replaces_link_without_erasing_legacy_assets(self):
        game = {'title': 'Blaster Master Zero'}
        identity = {'id': 123, 'name': game['title'], 'platforms': [{'name': 'Nintendo Switch'}], 'game_type': {'type': 'Main Game'}, 'url': 'https://www.igdb.com/games/blaster-master-zero'}
        responses = [json.dumps([identity]).encode(), b'[{"game":123,"image_id":"base"},{"game":999,"image_id":"wrong"}]', b'[{"game":123,"video_id":"abcdefghijk"}]']
        with patch.object(media, 'read_url', side_effect=responses), patch.object(media.time, 'sleep'):
            acquired = media.fetch_validated_igdb_media(game, 123, 'synthetic')
        self.assertEqual(acquired['screenshots'], ['https://images.igdb.com/igdb/image/upload/t_1080p/base.jpg'])
        self.assertFalse(acquired['collection_complete'])
        old = {'screenshots': ['https://www.nintendo.com/old.jpg'], 'videos': [{'type': 'youtube', 'video_id': 'VCKtO0HTgAk'}], 'igdb_url': 'https://www.igdb.com/games/shantae-addon', 'source': 'nintendo'}
        merged = media.merge_media(old, [acquired])
        self.assertEqual(merged['igdb_match']['igdb_id'], 123)
        self.assertEqual(merged['legacy_igdb_url'], old['igdb_url'])
        self.assertEqual(merged['igdb_url'], identity['url'])
        self.assertIn(old['screenshots'][0], merged['screenshots'])
        self.assertIn(old['videos'][0], merged['videos'])

    def test_ambiguous_and_wrong_platform_identity_is_not_selected(self):
        base = {'id': 123, 'name': 'Blaster Master Zero', 'platforms': [{'name': 'Nintendo Switch'}], 'game_type': {'type': 'Main Game'}, 'url': 'https://www.igdb.com/games/blaster-master-zero'}
        for candidates in [[base, {**base, 'id': 124}], [{**base, 'platforms': [{'name': 'Nintendo Switch 2'}]}], [{**base, 'parent_game': 4}], [{**base, 'game_type': {'type': 'Update'}}]]:
            with patch.object(media, 'read_url', return_value=json.dumps(candidates).encode()), patch.object(media.time, 'sleep'):
                result = media.fetch_validated_igdb_media({'title': base['name']}, None, 'synthetic')
            self.assertFalse(result['collection_complete'])
            self.assertNotIn('igdb_match', result)

    def test_rejected_cached_id_resolves_unique_base_game(self):
        bad = {'id': 171205, 'name': 'Blaster Master Zero: EX Character - Shantae', 'platforms': [{'name': 'Nintendo Switch'}], 'game_type': {'type': 'DLC Addon'}, 'url': 'https://www.igdb.com/games/shantae-addon'}
        good = {'id': 123, 'name': 'Blaster Master Zero', 'platforms': [{'name': 'Nintendo Switch'}], 'game_type': {'type': 'Main Game'}, 'url': 'https://www.igdb.com/games/blaster-master-zero'}
        with patch.object(media, 'read_url', side_effect=[json.dumps([bad]).encode(), json.dumps([good]).encode(), b'[]', b'[]']), patch.object(media.time, 'sleep'):
            result = media.fetch_validated_igdb_media({'title': good['name']}, 171205, 'synthetic')
        self.assertEqual(result['igdb_match']['igdb_id'], 123)
        self.assertEqual(result['igdb_url'], good['url'])
        self.assertTrue(result['collection_complete'])

    def test_future_knight_six_nintendo_gallery_images(self):
        document = '\n'.join("_gItems.push({'isVideo': false, 'image_url': 'https://assets.nintendo.eu/image/private/future-%d', 'type': 'limelight',});" % index for index in range(6))
        result = media.parse_nintendo_gallery(document, 'https://www.nintendo.com/future-knight')
        self.assertEqual(len(result['screenshots']), 6)
        self.assertEqual(result['videos'], [])

    def test_merges_all_sources_and_retains_cached_assets_on_failure(self):
        old = {'screenshots': ['https://www.nintendo.com/old.jpg'], 'videos': [], 'source': 'nintendo'}
        result = media.merge_media(old, [
            {'source': 'igdb', 'screenshots': ['https://images.igdb.com/new.jpg'], 'videos': [{'type': 'youtube', 'video_id': 'abcdefghijk'}]},
            {'source': 'steam', 'screenshots': ['https://images.igdb.com/new.jpg', 'https://shared.fastly.steamstatic.com/steam.jpg']},
            {'source': 'nintendo', 'collection_complete': False},
        ])
        self.assertEqual(len(result['screenshots']), 3)
        self.assertIn('https://www.nintendo.com/old.jpg', result['screenshots'])
        self.assertFalse(result['collection_complete'])
        self.assertEqual(result['asset_sources']['https://shared.fastly.steamstatic.com/steam.jpg'], 'steam')

    def test_steam_identity_and_streams_do_not_depend_on_reviews(self):
        result = media.steam_media({'steam_appid': 4235410, 'name': 'Future Knight', 'publishers': ['Aeternum Game Studios'], 'screenshots': [], 'movies': [
            {'id': 257386668, 'name': 'Gameplay Trailer', 'hls_h264': 'https://video.fastly.steamstatic.com/game.m3u8'},
            {'id': 257250066, 'name': 'Gameplay', 'hls_h264': 'https://video.fastly.steamstatic.com/play.m3u8'},
        ]})
        self.assertEqual(result['steam_match']['steam_id'], 4235410)
        self.assertEqual(len(result['videos']), 2)
        self.assertNotIn('score_pct', result['steam_match'])

    def test_catalog_includes_page_url_and_rejects_count_drift(self):
        calls = []
        def request(url, *args):
            calls.append(url)
            return json.dumps({'response': {'numFound': 1, 'docs': [{'fs_id': '3151132', 'system_type': ['nintendoswitch_downloadsoftware'], 'url': '/es-es/future-knight'}]}}).encode()
        with patch.object(media, 'read_url', side_effect=request):
            result = media.fetch_all_games('3151132')
        self.assertEqual(result[0]['url'], '/es-es/future-knight')
        self.assertIn('url', calls[0])
        with patch.object(media, 'read_url', return_value=b'{"response":{"numFound":2,"docs":[]}}'):
            with self.assertRaisesRegex(RuntimeError, 'Incomplete'):
                media.fetch_all_games()

    def test_igdb_paginates_and_reports_provider_failure_without_emptying_images(self):
        responses = [json.dumps([{'image_id': f'image{i}'} for i in range(50)]).encode(), b'[{"image_id":"last"}]', b'[{"video_id":"abcdefghijk","name":"Trailer"}]', b'[{"url":"https://www.igdb.com/games/future-knight"}]']
        with patch.object(media, 'read_url', side_effect=responses) as request, patch.object(media.time, 'sleep'):
            result = media.fetch_igdb_media(123, 'synthetic-token')
        self.assertEqual(len(result['screenshots']), 51)
        self.assertIn(b'offset 50', request.call_args_list[1].args[1])
        self.assertTrue(result['collection_complete'])
        self.assertEqual(media.merge_media({}, [result])['igdb_url'], 'https://www.igdb.com/games/future-knight')
        with patch.object(media, 'read_url', side_effect=[responses[0], RuntimeError('offline')]), patch.object(media.time, 'sleep'):
            with self.assertRaisesRegex(RuntimeError, 'offline'):
                media.fetch_igdb_media(123, 'synthetic-token')

    def test_partial_video_refresh_preserves_stream_and_failed_parser_is_incomplete(self):
        old = {'screenshots': [], 'videos': [{'type': 'steam', 'video_id': '1', 'hls_url': 'https://video.fastly.steamstatic.com/working.m3u8'}], 'source': 'steam'}
        result = media.merge_media(old, [{'source': 'steam', 'videos': [{'type': 'steam', 'video_id': '1', 'name': 'New name'}]}])
        self.assertEqual(result['videos'][0]['hls_url'], 'https://video.fastly.steamstatic.com/working.m3u8')
        result = media.parse_nintendo_gallery("_gItems.push({'malformed': invalid});", 'https://www.nintendo.com/game')
        self.assertFalse(result['collection_complete'])

    def test_untrusted_assets_and_revisionless_publish_are_rejected(self):
        for url in ['http://www.nintendo.com/image.jpg', 'https://attacker.test/file', 'https://images.igdb.com.attacker.test/file', 'https://user:pass@images.igdb.com/file']:
            self.assertFalse(media.safe_url(url))
        with self.assertRaisesRegex(RuntimeError, 'revision'):
            media.save_to_vercel({}, 'https://app.test', 'synthetic', None)


if __name__ == '__main__':
    unittest.main()
