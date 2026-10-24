"""Read-only native recovery. No prompt, toolset, model or approval-policy changes.

Pinned to the inspected Hermes implementation. Unknown code fails closed instead
of asserting that an arbitrary terminal status proves executor quiescence.
"""
import hashlib
import hmac
import importlib
from pathlib import Path

EXPECTED = {
    "gateway.response_filters": "d0bf3ee88a8d21db7b793553173c491d66dd0c099606717f87e34f95d0ff309e",
    "gateway.platforms.api_server": "6a7e6fb0a0d5ea25ddc47d36a64e2c0bc50ded331d49e1c4521d801ca7189043",
    "gateway.platforms.api_server_runs": "8a7fcfd56183c32a14b41c7c43ce36b21b37bf49f2ed035dafe48899c0e8cbe7",
    "gateway.platforms.api_server_run_idempotency": "56f7762addc5e610569fd613729f1f0b3d5e99e4b76f56d9cfa509dfeb51636c",
    "hermes_state_wal": "386a4c70ee2adeac7adbd29afa1f284d16ef5b22bc84da193dfaa5a698151ca2",
}


def supported_source():
    try:
        return all(hashlib.sha256(Path(importlib.import_module(name).__file__).read_bytes()).hexdigest() == expected
                   for name, expected in EXPECTED.items())
    except Exception:
        return False


def register(ctx):
    def routes(app, adapter):
        from aiohttp import web
        from gateway.platforms import api_server as api
        from hermes_cli.profiles import get_active_profile_name
        from gateway.response_filters import is_intentional_silence_response
        supported = supported_source()

        def authorized(request):
            return adapter._check_run_auth(request, permission="status")

        def durable():
            store = adapter._run_idempotency_store
            with store._lock:
                level = store._conn.execute("PRAGMA synchronous").fetchone()[0]
            return store.durable and level >= 2

        async def capabilities(request):
            refused = authorized(request)
            if refused is not None:
                return refused
            return web.json_response({"protocol": 1, "profileRef": get_active_profile_name(),
                                      "supportedSource": supported, "durable": supported and durable(),
                                      "readOnlyKeyLookup": supported, "normalCompletionQuiescent": supported,
                                      "cancelQuiescence": False})

        async def lookup(request):
            refused = authorized(request)
            if refused is not None:
                return refused
            if not supported or not durable():
                return web.json_response({"state": "unknown"}, status=503)
            key = request.match_info["key"]
            if not key or len(key) > 255:
                return web.json_response({"state": "unknown"}, status=400)
            scope = adapter._run_idempotency_scope(request)
            # The native lookup() also prunes expired rows; this pinned SELECT is
            # strictly read-only, scoped by native auth, and never reserves a key.
            fingerprint = request.headers.get("X-Agent-Chat-Fingerprint", "")
            if len(fingerprint) != 64 or any(ch not in "0123456789abcdef" for ch in fingerprint):
                return web.json_response({"state": "unknown"}, status=400)
            store = adapter._run_idempotency_store
            with store._lock:
                record = store._conn.execute("SELECT fingerprint,run_id FROM run_idempotency WHERE scope=? AND idempotency_key=?", (scope, key)).fetchone()
            if record is None:
                return web.json_response({"state": "unknown"})
            if not hmac.compare_digest(str(record[0]), fingerprint):
                return web.json_response({"state": "unknown"}, status=409)
            run_id = str(record[1])
            stored = adapter._run_idempotency_store.status_for_run(scope, run_id)
            if stored is None:
                return web.json_response({"state": "unknown"})
            status = stored["status"]
            base = {"runRef": run_id, "profileRef": get_active_profile_name(), "sessionId": status.get("session_id")}
            phase = status.get("status")
            if phase == "waiting_for_approval":
                return web.json_response({**base, "state": "awaiting_approval"})
            if phase in ("queued", "running", "stopping"):
                return web.json_response({**base, "state": "active"})
            task = adapter._active_run_tasks.get(run_id)
            # The pinned normal-completion path awaits the executor before persisting
            # completed. Cancellation/interruption/failure do NOT make that guarantee.
            if (phase != "completed" or status.get("completed") is not True or status.get("partial")
                    or status.get("interrupted") or (task is not None and not task.done())):
                return web.json_response({**base, "state": "unknown"})
            output = status.get("output")
            if not isinstance(output, str) or not output.strip():
                return web.json_response({**base, "state": "unknown"})
            silent = is_intentional_silence_response(output)
            return web.json_response({**base, "state": "completed", "decision": "no_reply" if silent else "reply",
                                      "text": "" if silent else output})

        for method, path, handler in [("GET", "/agent-chat/v1/profiles/{profile}/capabilities", capabilities),
                                      ("GET", "/agent-chat/v1/profiles/{profile}/runs/by-key/{key}", lookup)]:
            app.router.add_route(method, path, handler)

    ctx.register_platform_handler("api_server", routes)
