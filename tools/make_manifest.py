#!/usr/bin/env python3
"""Regenerate the checked release manifest after intentional source changes."""
from pathlib import Path
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]
SKIP_PARTS = {'.git', '__pycache__', 'node_modules', '.DS_Store', 'test-artifacts'}
files = {}
for file in sorted(ROOT.rglob('*')):
    relative = file.relative_to(ROOT)
    if not file.is_file() or file.is_symlink() or any(part in SKIP_PARTS for part in relative.parts):
        continue
    if relative.as_posix() == 'release-manifest.json' or file.suffix in {'.pyc', '.zip'}:
        continue
    files[relative.as_posix()] = hashlib.sha256(file.read_bytes()).hexdigest()
(ROOT / 'release-manifest.json').write_text(json.dumps({'version': 1, 'files': files}, indent=2) + '\n', encoding='utf-8')
print(f'Manifest records {len(files)} files.')
