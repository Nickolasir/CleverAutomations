#!/usr/bin/env python3
"""
Tiny HTTP server that sends Wake-on-LAN magic packets.
Runs on the host machine (not in Docker) so UDP broadcasts
reach the local network.

Usage:
    python3 scripts/wol-server.py

Endpoints:
    POST /wol  {"mac": "fc:03:9f:3d:f8:e0"}
    GET  /health
"""

import json
import socket
from http.server import HTTPServer, BaseHTTPRequestHandler

PORT = 9199


def send_wol(mac: str) -> None:
    mac_bytes = bytes.fromhex(mac.replace(":", "").replace("-", ""))
    magic = b"\xff" * 6 + mac_bytes * 16
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    for port in [9, 7, 0]:
        sock.sendto(magic, ("255.255.255.255", port))
        sock.sendto(magic, ("10.0.0.255", port))
    sock.close()


class WolHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path == "/wol":
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length)) if length else {}
            mac = body.get("mac", "")
            if not mac:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b'{"error":"mac required"}')
                return
            send_wol(mac)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"ok": True, "mac": mac}).encode())
            print(f"[WoL] Sent magic packet to {mac}")
        else:
            self.send_response(404)
            self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"status":"ok"}')
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        print(f"[WoL Server] {args[0]}")


if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", PORT), WolHandler)
    print(f"[WoL Server] Listening on port {PORT}")
    server.serve_forever()
