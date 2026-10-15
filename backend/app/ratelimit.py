import time
from collections import deque

from fastapi import HTTPException

MAX_KEYS = 10000


class RateLimiter:
    """In-memory sliding window. Resets on restart, fine for a single instance."""

    def __init__(self, limit: int, window_seconds: int):
        self.limit = limit
        self.window = window_seconds
        self._hits: dict[str, deque] = {}

    def _prune(self, key: str) -> deque:
        """Drop expired hits for key. A key with no hits left is removed, not stored empty."""
        q = self._hits.get(key)
        if q is None:
            return deque()
        cutoff = time.monotonic() - self.window
        while q and q[0] < cutoff:
            q.popleft()
        if not q:
            del self._hits[key]
            return deque()
        return q

    def _sweep(self) -> None:
        """Remove every key whose hits have all expired, so keys that never return don't pile up."""
        cutoff = time.monotonic() - self.window
        for key in [k for k, q in self._hits.items() if not q or q[-1] < cutoff]:
            del self._hits[key]

    def check(self, key: str) -> None:
        if len(self._prune(key)) >= self.limit:
            raise HTTPException(status_code=429, detail="Too many attempts. Try again later.")

    def hit(self, key: str) -> None:
        if len(self._hits) > MAX_KEYS:
            self._sweep()
        q = self._prune(key)
        q.append(time.monotonic())
        self._hits[key] = q
