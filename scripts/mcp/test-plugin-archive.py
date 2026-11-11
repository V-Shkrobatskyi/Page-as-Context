# Copyright (c) 2026 Vitalii Shkrobatskyi; SPDX-License-Identifier: GPL-3.0-only
import importlib.util
import stat
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('plugin_archive', Path(__file__).with_name('plugin-archive.py'))
archive = importlib.util.module_from_spec(spec)
spec.loader.exec_module(archive)


class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def fixture(self, entries):
        path = self.root / 'fixture.zip'
        with zipfile.ZipFile(path, 'w') as output:
            for name, data in entries:
                output.writestr(name, data)
        return path

    def test_single_plugin_and_executable_permissions(self):
        source = self.root / 'page-as-context'
        (source / 'runtime').mkdir(parents=True)
        (source / 'plugin.json').write_text('{"name":"page-as-context"}')
        node = source / 'runtime/node'
        node.write_bytes(b'fixture executable')
        node.chmod(0o755)
        output = self.root / 'plugin.zip'
        report = archive.create(source, output)
        self.assertEqual(report['entries'], 2)
        with zipfile.ZipFile(output) as z:
            self.assertIn('page-as-context/plugin.json', z.namelist())
            self.assertTrue((z.getinfo('page-as-context/runtime/node').external_attr >> 16) & stat.S_IXUSR)
            self.assertFalse(any(x.is_dir() or '__MACOSX' in x.filename for x in z.infolist()))

    def test_member_limit(self):
        path = self.fixture([('plugin/node', b'12345')])
        with patch.object(archive, 'MAX_MEMBER', 4), self.assertRaisesRegex(ValueError, 'member_too_large'):
            archive.validate(path)

    def test_entry_limit(self):
        path = self.fixture([('a', b''), ('b', b'')])
        with patch.object(archive, 'MAX_ENTRIES', 1), self.assertRaisesRegex(ValueError, 'too_many_entries'):
            archive.validate(path)

    def test_total_limit(self):
        path = self.fixture([('a', b'123'), ('b', b'456')])
        with patch.object(archive, 'MAX_TOTAL', 5), self.assertRaisesRegex(ValueError, 'uncompressed_too_large'):
            archive.validate(path)

    def test_zip_limit(self):
        path = self.fixture([('a', b'123')])
        with patch.object(archive, 'MAX_ZIP', 1), self.assertRaisesRegex(ValueError, 'archive_too_large'):
            archive.validate(path)

    def test_unsafe_paths(self):
        for name in ['../escape', '/absolute', 'a//b', 'a/../b', 'a/ b', 'a\\b', '/'.join(['deep'] * 21)]:
            with self.subTest(name=name):
                with self.assertRaisesRegex(ValueError, 'unsafe_archive_path'):
                    archive.validate(self.fixture([(name, b'')]))

    def test_case_and_unicode_collisions(self):
        for names in [('A', 'a'), ('café', 'cafe\u0301')]:
            with self.subTest(names=names), self.assertRaisesRegex(ValueError, 'collision'):
                archive.validate(self.fixture([(name, b'') for name in names]))

    def test_symlink_rejected(self):
        source = self.root / 'plugin'
        source.mkdir()
        (source / 'link').symlink_to('/etc/passwd')
        with self.assertRaisesRegex(ValueError, 'symlink'):
            archive.create(source, self.root / 'link.zip')

    def test_metadata_rejected(self):
        source = self.root / 'plugin'
        source.mkdir()
        (source / '._node').write_bytes(b'AppleDouble')
        with self.assertRaisesRegex(ValueError, 'metadata'):
            archive.create(source, self.root / 'metadata.zip')


if __name__ == '__main__':
    unittest.main()
