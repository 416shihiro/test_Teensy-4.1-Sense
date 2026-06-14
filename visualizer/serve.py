#!/usr/bin/env python3
"""Serve visualizer static files and proxy hub SSE on the same origin."""

from __future__ import annotations

import argparse
import http.client
import os
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class VizHandler(SimpleHTTPRequestHandler):
    hub_host: str = "127.0.0.1"
    hub_port: int = 8765

    def do_GET(self) -> None:
        if self.path == "/stream" or self.path.startswith("/stream?"):
            self._proxy_sse()
            return
        super().do_GET()

    def _proxy_sse(self) -> None:
        conn = http.client.HTTPConnection(self.hub_host, self.hub_port, timeout=5)
        try:
            conn.request("GET", "/stream")
            upstream = conn.getresponse()
            if upstream.status != 200:
                self.send_error(upstream.status, upstream.reason)
                return

            self.send_response(200)
            for header, value in upstream.getheaders():
                key = header.lower()
                if key in {"transfer-encoding", "connection", "content-length"}:
                    continue
                self.send_header(header, value)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()

            while True:
                chunk = upstream.read(1)
                if not chunk:
                    break
                self.wfile.write(chunk)
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass
        except OSError as exc:
            self.send_error(502, f"hub unreachable: {exc}")
        finally:
            conn.close()

    def log_message(self, format: str, *args) -> None:
        if self.path == "/stream":
            return
        super().log_message(format, *args)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=4173)
    parser.add_argument("--hub-host", default="127.0.0.1")
    parser.add_argument("--hub-port", type=int, default=8765)
    args = parser.parse_args()

    root = Path(__file__).resolve().parent
    os.chdir(root)

    handler = partial(VizHandler, directory=str(root))
    handler.hub_host = args.hub_host
    handler.hub_port = args.hub_port

    server = ThreadingHTTPServer(("0.0.0.0", args.port), handler)
    print(
        f"visualizer: http://localhost:{args.port}/?bridge=1",
        flush=True,
    )
    print(
        f"visualizer: SSE proxy http://localhost:{args.port}/stream -> "
        f"{args.hub_host}:{args.hub_port}/stream",
        flush=True,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("visualizer: stopped", flush=True)
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
