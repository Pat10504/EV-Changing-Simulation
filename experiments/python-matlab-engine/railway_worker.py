"""Connect this Windows session to the Railway circuit queue."""
import json
import re
import time
from http.client import HTTPConnection, HTTPException
from pathlib import Path
from urllib.parse import urlsplit

import socketio

NAMESPACE = "/matlab-worker"
JOB = re.compile(r"/jobs/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}")


def forward(message):
    if not isinstance(message, dict):
        return {"status": 400, "body": {"message": "Unsupported circuit request"}}
    method, path = message.get("method"), message.get("path")
    if not isinstance(path, str) or not (
        (method == "GET" and (path == "/status" or JOB.fullmatch(path)))
        or (method == "POST" and path == "/jobs" and isinstance(message.get("body"), dict))
    ):
        return {"status": 400, "body": {"message": "Unsupported circuit request"}}
    # Fixed loopback destination; no proxy, redirects, or forwarded credentials.
    connection = HTTPConnection("127.0.0.1", 5050, timeout=5)
    try:
        body = json.dumps(message["body"]) if method == "POST" else None
        connection.request(method, "/api/circuit" + path, body, {"Content-Type": "application/json"})
        response = connection.getresponse()
        return {"status": response.status, "body": json.loads(response.read())}
    except (OSError, ValueError, EOFError, HTTPException):
        return {"status": 503, "body": {"message": "AWS ติดต่อ Flask ไม่ได้ ตรวจ web_app.py ที่พอร์ต 5050"}}
    finally:
        connection.close()


def main():
    config = json.loads(Path(__file__).with_name("worker-config.json").read_text(encoding="utf-8-sig"))
    url, token = config["url"], config["token"]
    parsed = urlsplit(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ("", "/") or len(token) < 32:
        raise ValueError("Check HTTPS origin and worker token in worker-config.json")
    while True:
        client = socketio.Client(reconnection=False)
        client.on("circuit:request", forward, namespace=NAMESPACE)
        try:
            client.connect(url, auth={"token": token}, namespaces=[NAMESPACE], transports=["websocket"])
            print("Connected to Railway. Waiting for MATLAB jobs.", flush=True)
            client.wait()
        except (socketio.exceptions.ConnectionError, OSError):
            print("Railway connection unavailable. Check URL, token and network.", flush=True)
        finally:
            client.disconnect()
        time.sleep(5)


if __name__ == "__main__":
    main()
