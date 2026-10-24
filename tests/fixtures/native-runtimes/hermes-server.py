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

        mode = os.environ.get("NATIVE_FIXTURE_MODE", "default")
        persona = os.environ.get("NATIVE_FIXTURE_PERSONA", "capability fixture persona")
        provider_gate = threading.Event()
        approval_target = home / "approval-target"
        approval_target.mkdir(exist_ok=True)
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
            if mode == "approval" and body.get("stream"):
                if "BLOCK_NATIVE" in str(last):
                    await asyncio.to_thread(provider_gate.wait, 30)
                if "SILENT_NATIVE" in str(last):
                    text = "[SILENT]"
                if "APPROVAL_NATIVE" in str(last):
                    if any(m.get("role") == "tool" for m in body["messages"]):
                        text = "Native approval completed"
                    else:
                        command = f'rm -rf -- "{approval_target}"'
                        message = {"role": "assistant", "content": "Solicitando aprobación nativa.", "tool_calls": [{"index": 0, "id": "native-approval-tool", "type": "function", "function": {"name": "terminal", "arguments": json.dumps({"command": command})}}]}
                if "APPROVAL_NATIVE" not in str(last) or any(m.get("role") == "tool" for m in body["messages"]):
                    message = {"role": "assistant", "content": text}
            else:
                message = {"role": "assistant", "content": text}
            if body.get("stream"):
                chunks = [
                    {"id": "fixture", "object": "chat.completion.chunk", "model": "native-fixture",
                     "choices": [{"index": 0, "delta": message, "finish_reason": None}]},
                    {"id": "fixture", "object": "chat.completion.chunk", "model": "native-fixture",
                     "choices": [{"index": 0, "delta": {}, "finish_reason": "tool_calls" if message.get("tool_calls") else "stop"}]},
                ]
                data = "".join("data: " + json.dumps(c) + "\n\n" for c in chunks) + "data: [DONE]\n\n"
                return web.Response(text=data, content_type="text/event-stream")
            return web.json_response({"id": "fixture", "object": "chat.completion", "model": "native-fixture",
                                      "choices": [{"index": 0, "message": message, "finish_reason": "stop"}],
                                      "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2}})

        from gateway.platforms.api_server_runs import api_worker_live_count
        gateway_loop = asyncio.get_running_loop()

        class ProviderHandler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def _fixture_response(self, value):
                body = json.dumps(value).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):
                if self.path == "/fixture/evidence":
                    if self.headers.get("Authorization") != "Bearer " + os.environ["NATIVE_FIXTURE_KEY"]:
                        self.send_error(401)
                        return
                    from hermes_cli.plugins import get_plugin_manager
                    manager = get_plugin_manager()
                    summary = [{"name": p.get("name"), "enabled": p.get("enabled"), "error": p.get("error")} for p in manager.list_plugins() if p.get("name") == "agent-chat-runtime"]
                    self._fixture_response({"workerCount": api_worker_live_count(), "approvalTargetExists": approval_target.exists(), "plugins": summary, "handlers": len(manager.get_platform_handler_factories("api_server"))})
                    return
                body = json.dumps({"object": "list", "data": [{"id": "native-fixture", "context_length": 131072}]}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_POST(self):
                if self.path.startswith("/fixture/"):
                    if self.headers.get("Authorization") != "Bearer " + os.environ["NATIVE_FIXTURE_KEY"]:
                        self.send_error(401)
                        return
                    body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))) or b"{}")
                    if self.path == "/fixture/release":
                        provider_gate.set()
                    elif self.path == "/fixture/cancel-handler":
                        def cancel_task():
                            task = adapter._active_run_tasks.get(body["runId"])
                            if task is not None:
                                task.cancel()
                        gateway_loop.call_soon_threadsafe(cancel_task)
                    else:
                        self.send_error(404)
                        return
                    self._fixture_response({"requested": True})
                    return
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
        plugin_source = os.environ.get("NATIVE_FIXTURE_PLUGIN")
        if plugin_source:
            destination = home / "plugins" / "agent-chat-runtime"
            if not destination.exists():
                shutil.copytree(plugin_source, destination)
        (home / "config.yaml").write_text(json.dumps({
            "model": {"default": "native-fixture", "provider": "custom",
                      "base_url": f"http://127.0.0.1:{provider_port}/v1", "api_key": "fixture-only"},
            "platform_toolsets": {"api_server": ["file", "terminal"] if mode == "approval" else ["file"]},
            "terminal": {"backend": "local", "cwd": str(home), "home_mode": "profile"},
            "approvals": {"mode": "manual"},
            "plugins": {"enabled": ["agent-chat-runtime"] if plugin_source else []},
            "database": {"synchronous": "FULL"},
            "memory": {"memory_enabled": False, "user_profile_enabled": False},
            "agent": {"max_turns": 2},
        }))
        (home / "SOUL.md").write_text(f"NATIVE_PROFILE_SENTINEL: {persona}.\n")
        if mode == "approval":
            os.environ["HERMES_EXEC_ASK"] = "1"
        if plugin_source:
            from hermes_cli.plugins import discover_plugins
            discover_plugins()
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
                          "caFile": os.environ.get("NODE_EXTRA_CA_CERTS"), "fixtureOrigin": f"http://127.0.0.1:{provider_port}"}), flush=True)
        try:
            await stop.wait()
        finally:
            provider_gate.set()
            await adapter.disconnect()
            await asyncio.to_thread(provider.shutdown)
            provider.server_close()


if __name__ == "__main__":
    if sys.argv[1:2] == ["--copy-only"]:
        copy_committed_source(Path(sys.argv[2]), sys.argv[3], Path(sys.argv[4]), Path(sys.argv[5]))
    else:
        asyncio.run(main())
