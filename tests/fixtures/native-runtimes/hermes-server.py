"""S0 only: installed Hermes + a local wire-level provider, in a disposable home.

Run with Hermes' own Python. No AIAgent replacement, private config or model calls.
Portless supplies PORT for the HTTP entrypoint; the private provider uses an OS port.
"""
import asyncio
import contextlib
import faulthandler
import json
import os
from pathlib import Path
import signal
import sys
import threading
import subprocess
import tarfile
import shutil
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def copy_committed_source(original_source, revision, destination, home):
    """Copy only regular committed files, excluding private env files and symlinks."""
    destination = Path(destination)
    destination.mkdir(parents=True)
    archive = subprocess.Popen(
        ["git", "--no-replace-objects", "-C", str(original_source), "archive", revision],
        stdout=subprocess.PIPE,
        env={"PATH": os.environ["PATH"], "HOME": str(home),
             "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull})
    try:
        with tarfile.open(fileobj=archive.stdout, mode="r|") as files:
            for member in files:
                path = Path(member.name)
                if (path.is_absolute() or ".." in path.parts
                        or any(p.startswith(".env") or p == ".op.env" for p in path.parts)):
                    continue
                if not member.isfile():
                    continue
                target = destination / path
                target.parent.mkdir(parents=True, exist_ok=True)
                with files.extractfile(member) as incoming, target.open("wb") as outgoing:
                    shutil.copyfileobj(incoming, outgoing)
                target.chmod(member.mode & 0o777)
        if archive.wait(timeout=30) != 0:
            raise RuntimeError("Hermes source archive failed")
    finally:
        if archive.poll() is None:
            archive.kill()
        archive.wait()


async def main():
    faulthandler.register(signal.SIGUSR1)
    original_source = Path(sys.argv[1]).resolve()
    sys.argv[0] = str(Path(sys.argv[0]).resolve())
    with contextlib.nullcontext(os.environ["NATIVE_FIXTURE_HOME"]) as directory:
        home = Path(directory)
        home.mkdir(parents=True, exist_ok=True)
        os.environ["HOME"] = directory
        os.environ["HERMES_HOME"] = directory
        managed = home.parent / "managed-empty"
        managed.mkdir(exist_ok=True)
        # System-managed scope is independent of HOME. Pin it before importing
        # Hermes and preserve it across the dependency reexec.
        os.environ["HERMES_MANAGED_DIR"] = str(managed)
        os.environ["HERMES_DISABLE_UPDATE_CHECK"] = "1"
        os.chdir(directory)
        source = home.parent / "source"
        if not source.exists():
            copy_committed_source(original_source, os.environ["NATIVE_FIXTURE_SOURCE_REVISION"], source, home)
        # An archive has no installed checkout metadata. Provision dependencies
        # from its versioned lockfile rather than borrowing the private install.
        runtime = source / ".venv" / "bin" / "python"
        if Path(sys.prefix).resolve() != (source / ".venv").resolve():
            if not runtime.exists():
                subprocess.run(["uv", "sync", "--project", str(source), "--frozen", "--no-dev",
                                "--extra", "messaging", "--no-install-project", "--python", sys.executable],
                               check=True, timeout=100)
            os.execv(str(runtime), [str(runtime), *sys.argv])
        sys.path.insert(0, str(source))
        import hermes_bootstrap  # noqa: F401; installed dependency loader, temporary root only
        from aiohttp import web

        requests = []
        generation = uuid.uuid4().hex
        report_lock = threading.Lock()

        def snapshot():
            report_path = os.environ.get("NATIVE_FIXTURE_REPORT")
            if report_path:
                temporary = Path(report_path + ".tmp")
                temporary.write_text(json.dumps({"generation": generation, "requests": requests}))
                temporary.replace(report_path)

        snapshot()

        async def completion(request):
            body = await request.json()
            with report_lock:
                body["fixture_generation"] = generation
                body["fixture_managed_canary_loaded"] = bool(os.environ.get("NATIVE_MANAGED_CANARY"))
                body["fixture_kind"] = "streamed_turn" if body.get("stream") else "auxiliary"
                body["fixture_sequence"] = len(requests) + 1
                requests.append(body)
                snapshot()
            last = next((m.get("content", "") for m in reversed(body["messages"])
                         if m.get("role") == "user"), "")
            text = (json.dumps({"decision": "no_reply", "text": ""}) if last == "SILENT"
                    else f"native fixture reply {generation}:{body['fixture_sequence']}")
            message = {"role": "assistant", "content": text}
            if body.get("stream"):
                chunks = [
                    {"id": "fixture", "object": "chat.completion.chunk", "model": "native-fixture",
                     "choices": [{"index": 0, "delta": message, "finish_reason": None}]},
                    {"id": "fixture", "object": "chat.completion.chunk", "model": "native-fixture",
                     "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]},
                ]
                data = "".join("data: " + json.dumps(c) + "\n\n" for c in chunks) + "data: [DONE]\n\n"
                return web.Response(text=data, content_type="text/event-stream")
            return web.json_response({"id": "fixture", "object": "chat.completion", "model": "native-fixture",
                                      "choices": [{"index": 0, "message": message, "finish_reason": "stop"}],
                                      "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2}})

        class ProviderHandler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def do_GET(self):
                body = json.dumps({"object": "list", "data": [{"id": "native-fixture", "context_length": 131072}]}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_POST(self):
                # The native constructor performs synchronous metadata I/O; the provider
                # must run outside the gateway loop to avoid a fixture-induced deadlock.
                class Request:
                    async def json(inner_self):
                        return json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                response = asyncio.run(completion(Request()))
                body = response.body
                self.send_response(response.status)
                self.send_header("Content-Type", response.content_type)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        provider = ThreadingHTTPServer(("127.0.0.1", 0), ProviderHandler)
        threading.Thread(target=provider.serve_forever, daemon=True).start()
        provider_port = provider.server_port
        (home / "config.yaml").write_text(json.dumps({
            "model": {"default": "native-fixture", "provider": "custom",
                      "base_url": f"http://127.0.0.1:{provider_port}/v1", "api_key": "fixture-only"},
            "platform_toolsets": {"api_server": ["file"]},
            "memory": {"memory_enabled": False, "user_profile_enabled": False},
            "agent": {"max_turns": 2},
        }))
        (home / "SOUL.md").write_text("NATIVE_PROFILE_SENTINEL: capability fixture persona.\n")
        from gateway.config import PlatformConfig
        from gateway.platforms.api_server import APIServerAdapter
        adapter = APIServerAdapter(PlatformConfig(enabled=True, extra={
            "host": "127.0.0.1", "port": int(os.environ["PORT"]),
            "key": os.environ["NATIVE_FIXTURE_KEY"],
        }))
        if not await adapter.connect():
            raise RuntimeError("isolated Hermes API failed to start")
        stop = asyncio.Event()
        for sig in (signal.SIGINT, signal.SIGTERM):
            asyncio.get_running_loop().add_signal_handler(sig, stop.set)
        print(json.dumps({"type": "native-fixture.ready", "origin": os.environ["PORTLESS_URL"],
                          "caFile": os.environ.get("NODE_EXTRA_CA_CERTS")}), flush=True)
        try:
            await stop.wait()
        finally:
            await adapter.disconnect()
            await asyncio.to_thread(provider.shutdown)
            provider.server_close()


if __name__ == "__main__":
    if sys.argv[1:2] == ["--copy-only"]:
        copy_committed_source(Path(sys.argv[2]), sys.argv[3], Path(sys.argv[4]), Path(sys.argv[5]))
    else:
        asyncio.run(main())
