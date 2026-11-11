# Copyright (c) 2026 Vitalii Shkrobatskyi; SPDX-License-Identifier: GPL-3.0-only
"""Build a metadata-free ZIP and check published OpenAI archive limits.

These are portal limits, not a guarantee for every desktop importer version.
"""
import argparse
import json
import stat
import unicodedata
import zipfile
from pathlib import Path, PurePosixPath

MAX_ENTRIES = 5000
MAX_MEMBER = 100 * 1024 * 1024
MAX_TOTAL = 512 * 1024 * 1024
MAX_ZIP = 100_000_000


def validate(path):
    if Path(path).stat().st_size > MAX_ZIP:
        raise ValueError('archive_too_large')
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        if not entries or len(entries) > MAX_ENTRIES:
            raise ValueError('archive_empty_or_too_many_entries')
        total = 0
        names = set()
        for item in entries:
            name = item.filename.rstrip('/')
            parts = name.split('/')
            if not name or name.startswith('/') or '\\' in name or any(p in ('', '.', '..') or p != p.strip() for p in parts) or len(parts) > 20:
                raise ValueError('unsafe_archive_path')
            key = unicodedata.normalize('NFC', name).casefold()
            if key in names:
                raise ValueError('archive_path_collision')
            names.add(key)
            mode = item.external_attr >> 16
            if stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR):
                raise ValueError('unsupported_archive_entry')
            if item.file_size > MAX_MEMBER:
                raise ValueError('archive_member_too_large: ' + item.filename)
            total += item.file_size
        if total > MAX_TOTAL:
            raise ValueError('archive_uncompressed_too_large')
        if archive.testzip() is not None:
            raise ValueError('archive_crc_mismatch')
        return {'entries': len(entries), 'extractedBytes': total, 'zipBytes': Path(path).stat().st_size,
                'largestMemberBytes': max(x.file_size for x in entries)}


def create(source, destination):
    source = Path(source)
    with zipfile.ZipFile(destination, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in sorted(source.rglob('*')):
            if path.is_symlink():
                raise ValueError('package_symlink')
            if path.is_file():
                relative = path.relative_to(source)
                if any(p in ('__MACOSX', '.DS_Store') or p.startswith('._') for p in relative.parts):
                    raise ValueError('package_contains_macos_metadata')
                archive.write(path, str(PurePosixPath(source.name) / PurePosixPath(relative.as_posix())))
    return validate(destination)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('path')
    parser.add_argument('--output')
    args = parser.parse_args()
    print(json.dumps(create(args.path, args.output) if args.output else validate(args.path), indent=2))
