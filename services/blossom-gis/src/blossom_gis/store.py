"""Content-addressed blob storage on the local filesystem.

The hash is the only thing that ever reaches the filesystem, and it is validated
as 64 lowercase hex characters before a path is built, so a request can never
traverse out of the blob root.
"""

from __future__ import annotations

import hashlib
import os
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path

SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


def is_valid_sha256(value: str) -> bool:
    return bool(SHA256_RE.match(value))


@dataclass(frozen=True)
class StoredBlob:
    sha256: str
    size: int
    path: Path
    created: bool


class BlobStore:
    """Sharded content-addressed store: <root>/ab/cd/<sha256>."""

    def __init__(self, root: Path) -> None:
        self._root = Path(root)
        self._root.mkdir(parents=True, exist_ok=True)

    @property
    def root(self) -> Path:
        return self._root

    def path_for(self, sha256: str) -> Path:
        if not is_valid_sha256(sha256):
            raise ValueError("blob hash must be 64 lowercase hex characters")
        return self._root / sha256[:2] / sha256[2:4] / sha256

    def exists(self, sha256: str) -> bool:
        try:
            return self.path_for(sha256).is_file()
        except ValueError:
            return False

    def size_of(self, sha256: str) -> int | None:
        try:
            path = self.path_for(sha256)
        except ValueError:
            return None
        return path.stat().st_size if path.is_file() else None

    def put(self, data: bytes) -> StoredBlob:
        """Store bytes under their own SHA-256. Idempotent."""
        digest = hashlib.sha256(data).hexdigest()
        path = self.path_for(digest)
        if path.is_file():
            return StoredBlob(sha256=digest, size=len(data), path=path, created=False)

        path.parent.mkdir(parents=True, exist_ok=True)
        # Write to a temp file in the same directory, then atomically rename, so
        # a crash can never leave a truncated blob at a valid hash path.
        handle, tmp_name = tempfile.mkstemp(dir=path.parent, suffix=".part")
        try:
            with os.fdopen(handle, "wb") as tmp:
                tmp.write(data)
                tmp.flush()
                os.fsync(tmp.fileno())
            os.replace(tmp_name, path)
        except BaseException:
            Path(tmp_name).unlink(missing_ok=True)
            raise
        return StoredBlob(sha256=digest, size=len(data), path=path, created=True)

    def read(self, sha256: str) -> bytes | None:
        try:
            path = self.path_for(sha256)
        except ValueError:
            return None
        if not path.is_file():
            return None
        return path.read_bytes()

    def delete(self, sha256: str) -> bool:
        try:
            path = self.path_for(sha256)
        except ValueError:
            return False
        if not path.is_file():
            return False
        path.unlink()
        return True
