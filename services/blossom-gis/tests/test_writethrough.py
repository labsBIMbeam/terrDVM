"""BUD-02 write-through client, tested against a real in-process HTTP server so
the wire format — method, path, auth header, body — is observed, not assumed."""

from __future__ import annotations

import hashlib
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from blossom_gis.nostr import authorize, parse_auth_header
from blossom_gis.writethrough import WriteThroughError, upload

NOW = 1754130000
SECRET = 0xB7E151628AED2A6ABF7158809CF4F3C762E7160F38B4DA56A784D9045190CFEF
PAYLOAD = b"corpus tile bytes"
PAYLOAD_SHA = hashlib.sha256(PAYLOAD).hexdigest()


class _Recorder(BaseHTTPRequestHandler):
    def do_PUT(self) -> None:  # noqa: N802 - http.server naming
        length = int(self.headers.get("Content-Length", "0"))
        self.server.request = {  # type: ignore[attr-defined]
            "path": self.path,
            "headers": dict(self.headers),
            "body": self.rfile.read(length),
        }
        status, body = self.server.reply  # type: ignore[attr-defined]
        payload = json.dumps(body).encode() if isinstance(body, dict) else body
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args) -> None:  # silence test output
        return


@pytest.fixture
def server():
    httpd = HTTPServer(("127.0.0.1", 0), _Recorder)
    httpd.reply = (200, {"sha256": PAYLOAD_SHA, "size": len(PAYLOAD)})
    httpd.request = None
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield httpd
    finally:
        httpd.shutdown()
        thread.join(timeout=5)


def _base_url(httpd) -> str:
    return f"http://127.0.0.1:{httpd.server_address[1]}"


def test_uploads_with_a_valid_bound_authorization(server) -> None:
    descriptor = upload(_base_url(server), PAYLOAD, "image/png", SECRET, now=NOW)
    assert descriptor["sha256"] == PAYLOAD_SHA

    seen = server.request
    assert seen["path"] == "/upload"
    assert seen["body"] == PAYLOAD
    assert seen["headers"]["Content-Type"] == "image/png"

    event = parse_auth_header(seen["headers"]["Authorization"])
    result = authorize(event, verb="upload", now=NOW, blob_sha256=PAYLOAD_SHA)
    assert result.ok, result.reason


def test_a_descriptor_with_the_wrong_hash_is_refused(server) -> None:
    server.reply = (200, {"sha256": "ff" * 32, "size": len(PAYLOAD)})
    with pytest.raises(WriteThroughError, match="sha"):
        upload(_base_url(server), PAYLOAD, "image/png", SECRET, now=NOW)


def test_a_rejection_status_raises_with_the_server_reason(server) -> None:
    server.reply = (401, {"message": "pubkey not allowed"})
    with pytest.raises(WriteThroughError, match="401"):
        upload(_base_url(server), PAYLOAD, "image/png", SECRET, now=NOW)


def test_an_unparseable_body_is_refused(server) -> None:
    server.reply = (200, b"not json")
    with pytest.raises(WriteThroughError, match="JSON"):
        upload(_base_url(server), PAYLOAD, "image/png", SECRET, now=NOW)


def test_an_unreachable_server_raises(server) -> None:
    server.shutdown()
    with pytest.raises(WriteThroughError):
        upload("http://127.0.0.1:1", PAYLOAD, "image/png", SECRET, now=NOW, timeout_s=2)
