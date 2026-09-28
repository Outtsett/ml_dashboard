"""FinBERT on the GPU, in its own thread.

Headlines arrive from the loop (RSS, Alpha Vantage) and from the GDELT thread;
they are scored in batches (up to ``batchSize``, or whatever arrived within a
second) by ``lake.finbert.FinBert`` — ProsusAI/finbert, label order read from
the checkpoint and asserted, fp16 weights with an fp32 softmax. A live headline
is on the page within about a second of first sight; a backfilled one goes only
to the lake.

A batch that fails (a CUDA out-of-memory on a burst, one headline the tokenizer
rejects) is scored again one headline at a time, so one bad item cannot take
127 good ones with it. A headline that fails while others in the same pass
scored is retried after 30 s x attempt, up to ``MAX_ATTEMPTS``; after that it is
counted and named in ``status()`` as dropped. When EVERY headline in a pass
fails, the fault is the device, not the text: all of them are requeued with a
backoff that grows to 10 minutes, and no attempt is spent. Their article rows
are already in the spool, and nothing else would ever submit them again (the
pipeline deduplicates at submit time).
"""

from __future__ import annotations

import logging
import queue
import threading
import time
from collections import deque
from datetime import datetime, timezone

log = logging.getLogger("live.scoring")

MAX_ATTEMPTS = 3
RETRY_SECONDS = 30.0
DEVICE_BACKOFF_MAX_SECONDS = 600.0


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
        self.retry: list[tuple[float, dict]] = []             # (due, item), this thread only
        self.dropped = 0
        self.dropped_ids: deque[str] = deque(maxlen=1000)
        self.device_faults = 0                                 # passes in a row where nothing scored

    def submit(self, item: dict) -> None:
        """``item``: {articleId, text, seenTs (epoch s), live (bool), payload (dict)}."""
        self.inbox.put(item)

    def status(self) -> dict:
        return {"model": self.model_name, "device": self.device, "loaded": self.model is not None,
                "queued": self.inbox.qsize(), "scored": self.scored, "batches": self.batches,
                "lastBatchSeconds": self.last_batch_seconds, "lastError": self.last_error,
                "retrying": len(self.retry), "dropped": self.dropped, "droppedIds": list(self.dropped_ids)}

    def _try(self, batch: list[dict]) -> list[tuple[dict, object]] | None:
        try:
            return list(zip(batch, self.model.score_batch([item["text"] for item in batch]), strict=True))
        except Exception as error:  # noqa: BLE001 - one batch must not stop the scorer
            self.last_error = f"{type(error).__name__}: {error}"
            log.error("FinBERT batch of %d failed: %s", len(batch), error)
            return None

    def _score(self, batch: list[dict]) -> list[tuple[dict, object]]:
        """(item, score) for every item that scored; a failing batch is split,
        and only an item that fails while others succeed spends an attempt."""
        whole = self._try(batch)
        if whole is not None:
            self.device_faults = 0
            return whole
        scored: list[tuple[dict, object]] = []
        failed: list[dict] = []
        for item in batch:
            one = self._try([item]) if len(batch) > 1 else None
            if one:
                scored.extend(one)
            else:
                failed.append(item)
        if not scored and len(batch) > 1:
            self.device_faults += 1
            wait = min(DEVICE_BACKOFF_MAX_SECONDS, RETRY_SECONDS * 2 ** (self.device_faults - 1))
            due = time.monotonic() + wait
            self.retry.extend((due, item) for item in failed)
            log.error("FinBERT scored nothing in a pass of %d; device fault %d, retrying all in %.0f s",
                      len(batch), self.device_faults, wait)
            return []
        self.device_faults = 0 if scored else self.device_faults
        for item in failed:
            attempts = int(item.get("attempts", 0)) + 1
            if attempts < MAX_ATTEMPTS:
                self.retry.append((time.monotonic() + RETRY_SECONDS * attempts, {**item, "attempts": attempts}))
            else:
                self.dropped += 1
                self.dropped_ids.append(item["articleId"])
                log.error("FinBERT gave up on %s after %d attempts", item["articleId"], attempts)
        return scored

    def _requeue_due(self) -> None:
        now = time.monotonic()
        due = [item for when, item in self.retry if when <= now]
        self.retry = [(when, item) for when, item in self.retry if when > now]
        for item in due:
            self.inbox.put(item)

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
            self._requeue_due()
            try:
                batch = [self.inbox.get(timeout=5.0)]
            except queue.Empty:
                continue
            deadline = time.monotonic() + 1.0
            while len(batch) < self.batch_size and time.monotonic() < deadline:
                try:
                    batch.append(self.inbox.get(timeout=max(0.0, deadline - time.monotonic())))
                except queue.Empty:
                    break
            started = time.monotonic()
            results = self._score(batch)
            self.last_batch_seconds = round(time.monotonic() - started, 3)
            if not results:
                continue
            self.batches += 1
            self.scored += len(results)
            now = datetime.now(timezone.utc)
            live = []
            for item, scored in results:
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
