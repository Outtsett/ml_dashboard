"""FinBERT on the GPU, in its own thread.

Headlines arrive from the loop (RSS, Alpha Vantage) and from the GDELT thread;
they are scored in batches (up to ``batchSize``, or whatever arrived within a
second) by ``lake.finbert.FinBert`` — ProsusAI/finbert, label order read from
the checkpoint and asserted, fp16 weights with an fp32 softmax. A live headline
is on the page within about a second of first sight; a backfilled one goes only
to the lake.
"""

from __future__ import annotations

import logging
import queue
import threading
import time
from datetime import datetime, timezone

log = logging.getLogger("live.scoring")


class Scorer(threading.Thread):
    def __init__(self, hub, config: dict) -> None:
        super().__init__(name="finbert", daemon=True)
        self.hub = hub
        self.model_name = config.get("model", "ProsusAI/finbert")
        self.batch_size = int(config.get("batchSize", 128))
        self.inbox: queue.Queue = queue.Queue()
        self.model = None
        self.device = None
        self.scored = 0
        self.batches = 0
        self.last_error: str | None = None
        self.last_batch_seconds: float | None = None

    def submit(self, item: dict) -> None:
        """``item``: {articleId, text, seenTs (epoch s), live (bool), payload (dict)}."""
        self.inbox.put(item)

    def status(self) -> dict:
        return {"model": self.model_name, "device": self.device, "loaded": self.model is not None,
                "queued": self.inbox.qsize(), "scored": self.scored, "batches": self.batches,
                "lastBatchSeconds": self.last_batch_seconds, "lastError": self.last_error}

    def run(self) -> None:
        from lake.finbert import FinBert

        while self.model is None:
            try:
                self.model = FinBert(self.model_name, batch_size=self.batch_size)
                self.device = self.model.device
                log.info("FinBERT %s on %s", self.model_name, self.device)
            except Exception as error:  # noqa: BLE001 - retry: the GPU may be busy, the hub must stay up
                self.last_error = f"{type(error).__name__}: {error}"
                log.error("FinBERT load failed: %s", error)
                time.sleep(30)
        while True:
            batch = [self.inbox.get()]
            deadline = time.monotonic() + 1.0
            while len(batch) < self.batch_size and time.monotonic() < deadline:
                try:
                    batch.append(self.inbox.get(timeout=max(0.0, deadline - time.monotonic())))
                except queue.Empty:
                    break
            try:
                started = time.monotonic()
                results = self.model.score_batch([item["text"] for item in batch])
                self.last_batch_seconds = round(time.monotonic() - started, 3)
            except Exception as error:  # noqa: BLE001
                self.last_error = f"{type(error).__name__}: {error}"
                log.error("FinBERT batch failed: %s", error)
                continue
            self.batches += 1
            self.scored += len(batch)
            now = datetime.now(timezone.utc)
            live = []
            for item, scored in zip(batch, results, strict=True):
                row = {
                    "article_id": item["articleId"], "model": self.model_name,
                    "seen_ts": datetime.fromtimestamp(item["seenTs"], tz=timezone.utc),
                    "p_positive": scored.p_positive, "p_negative": scored.p_negative,
                    "p_neutral": scored.p_neutral, "score": scored.score, "label": scored.label,
                    "confidence": scored.confidence, "n_tokens": scored.n_tokens,
                    "truncated": scored.truncated, "scored_ts": now,
                }
                if self.hub.lander is not None:
                    self.hub.lander.sentiment(row)
                if item.get("live"):
                    live.append({**item["payload"], "score": scored.score, "label": scored.label,
                                 "pPositive": scored.p_positive, "pNegative": scored.p_negative,
                                 "pNeutral": scored.p_neutral, "confidence": scored.confidence})
            if live:
                self.hub.call_soon(self.hub.on_scored, live)
