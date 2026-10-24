"""Local-only tests: never makes a GitHub request or reads a credential."""
import importlib.util
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('publisher',Path(__file__).resolve().parents[1]/'tools/publish.py')
publisher=importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)

class PublisherTests(unittest.TestCase):
    def test_git_blob_digest(self):
        self.assertEqual(publisher.git_blob_sha(b''),'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391')

    def test_refuses_main(self):
        with patch.object(publisher.shutil,'which',return_value='/test/gh'):
            with self.assertRaises(publisher.PublishError):publisher.upload('main',{})

    def test_checksum_rejects_modified_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            (root/'x.txt').write_bytes(b'modified')
            (root/'release-manifest.json').write_text(json.dumps({'files':{'x.txt':hashlib.sha256(b'original').hexdigest()}}))
            with self.assertRaises(publisher.PublishError):publisher.release_files(root)

    def test_single_commit_and_only_stale_images_removed(self):
        calls=[]
        prefix='repos/abtrk95/Chamsine-Catalog'
        ref=f'{prefix}/git/ref/heads/review-test'
        def fake(endpoint,method='GET',payload=None,allow_404=False):
            calls.append((endpoint,method,payload))
            if endpoint==prefix:return {'default_branch':'main'}
            if endpoint==ref:return {'object':{'sha':'old-head'}}
            if '/git/commits/old-head' in endpoint:return {'tree':{'sha':'old-tree'}}
            if '/git/trees/old-tree' in endpoint:return {'truncated':False,'tree':[
                {'path':'images/old.jpg','sha':'old-image','type':'blob'},
                {'path':'other.txt','sha':'unrelated','type':'blob'}]}
            if endpoint.endswith('/git/blobs'):
                import base64
                return {'sha':publisher.git_blob_sha(base64.b64decode(payload['content']))}
            if endpoint.endswith('/git/trees'):return {'sha':'new-tree'}
            if endpoint.endswith('/git/commits'):return {'sha':'new-head'}
            if '/git/refs/heads/' in endpoint:return {'object':{'sha':'new-head'}}
            if '/pulls?' in endpoint:return [{'html_url':'https://example.invalid/pr'}]
            raise AssertionError(endpoint)
        with patch.object(publisher.shutil,'which',return_value='/test/gh'),patch.object(publisher,'api',side_effect=fake),patch.object(publisher.time,'sleep'):
            publisher.upload('review-test',{'index.html':b'<html></html>','images/new.webp':b'image bytes'})
        patch_calls=[c for c in calls if c[1]=='PATCH']
        self.assertEqual(len(patch_calls),1)
        self.assertTrue(patch_calls[0][0].endswith('/heads/review-test'))
        self.assertIs(patch_calls[0][2]['force'],False)
        tree_payload=next(c[2] for c in calls if c[0].endswith('/git/trees'))
        deleted=[item['path'] for item in tree_payload['tree'] if item['sha'] is None]
        self.assertEqual(deleted,['images/old.jpg'])
        commit_payload=next(c[2] for c in calls if c[0].endswith('/git/commits'))
        self.assertEqual(commit_payload['parents'],['old-head'])

if __name__=='__main__':unittest.main()
