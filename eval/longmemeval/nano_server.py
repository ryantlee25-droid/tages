#!/usr/bin/env python3
"""Local embedding server for the voyage-4-nano bake-off backend (nano-store.ts).

Loads voyageai/voyage-4-nano (Apache-2.0, open weights) once and serves POST
/embed so the TS eval harness can embed against a self-hosted model with no API
rate limits (the reason the Voyage API bake-off failed 50/50 on the free key).

Uses RAW transformers (AutoModel + manual mean-pool + L2 normalize) rather than
sentence-transformers, which has an acknowledged Dense-layer incompatibility with
this model (HF discussion #5). Prepends the model's own asymmetric retrieval
prompts (from its config_sentence_transformers.json).

Pinned working stack (see requirements-nano.txt): Python 3.12, transformers
4.56.2 (4.51 lacks masking_utils, 4.53 lacks TransformersKwargs, 4.57 has an
auto-register config_class bug), torch 2.x.

Run with the repo venv:  .venv/bin/python nano_server.py
Env: NANO_PORT (default 8399), NANO_MAXTOK (default 4096).

Request:  POST /embed  {"texts": ["..."], "input_type": "document"|"query"}
Response: {"vectors": [[...floats...]]}
Health:   GET /health -> 200 "ok" once the model is loaded.
"""
import json
import os
import sys
import warnings
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

warnings.filterwarnings("ignore")

PORT = int(os.environ.get("NANO_PORT", "8399"))
MAXTOK = int(os.environ.get("NANO_MAXTOK", "4096"))
MODEL_ID = "voyageai/voyage-4-nano"
# Prompts from the model's config_sentence_transformers.json (asymmetric retrieval).
PROMPTS = {
    "query": "Represent the query for retrieving supporting documents: ",
    "document": "Represent the document for retrieval: ",
}

print(f"[nano] loading {MODEL_ID} (raw transformers, mean-pool) ...", flush=True)
import torch  # noqa: E402
from transformers import AutoModel, AutoTokenizer  # noqa: E402

tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
model = AutoModel.from_pretrained(MODEL_ID, trust_remote_code=True, dtype=torch.float32).eval()
print("[nano] READY", flush=True)


def encode(texts, input_type):
    prompt = PROMPTS.get(input_type, PROMPTS["document"])
    prompted = [prompt + t for t in texts]
    x = tokenizer(prompted, return_tensors="pt", padding=True, truncation=True, max_length=MAXTOK)
    with torch.no_grad():
        out = model(**x)
    h = out.last_hidden_state
    mask = x["attention_mask"].unsqueeze(-1).float()
    pooled = (h * mask).sum(1) / mask.sum(1).clamp(min=1e-9)
    pooled = torch.nn.functional.normalize(pooled, p=2, dim=1)
    return pooled.tolist()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # quiet

    def do_GET(self):
        self._send(200, b"ok") if self.path == "/health" else self._send(404, b"not found")

    def do_POST(self):
        if self.path != "/embed":
            self._send(404, b"not found")
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length) or b"{}")
            texts = payload.get("texts", [])
            input_type = payload.get("input_type", "document")
            vectors = encode(texts, input_type) if texts else []
            self._send(200, json.dumps({"vectors": vectors}).encode("utf-8"))
        except Exception as e:  # never crash the server on one bad request
            self._send(500, json.dumps({"error": str(e)}).encode("utf-8"))

    def _send(self, code, body):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"[nano] serving on http://127.0.0.1:{PORT}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        sys.exit(0)
