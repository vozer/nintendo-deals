import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('media_backfill', Path(__file__).parents[2] / 'scripts' / 'media-backfill.py')
media = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(media)


class MediaAcquisitionTests(unittest.TestCase):
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
        with patch.object(media, 'read_url', side_effect=[responses[0], RuntimeError('offline'), b'[]', responses[3]]), patch.object(media.time, 'sleep'):
            result = media.fetch_igdb_media(123, 'synthetic-token')
        self.assertEqual(len(result['screenshots']), 50)
        self.assertFalse(result['collection_complete'])

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
