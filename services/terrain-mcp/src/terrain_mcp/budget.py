"""One wall-clock budget for a whole request.

The texture backend fetches its mosaic sequentially and swallows per-tile
failures to keep going, so a black-holing upstream turns one tool call into
`max_tiles x timeout` of silence — measured at 321 outbound connect attempts for
a single default call on a 1.036 km2 bbox, and roughly two hours end to end.
A per-tile timeout cannot bound that; only a total can.

So the budget is per *request*, not per tile, and every stage draws from the
same clock: DEM, features and texture together. Each individual network call is
additionally capped at whatever is left, so the last tile of an exhausted budget
cannot outlive it either.

Exhaustion is a named failure, never a short answer. A manifest built from the
tiles that happened to arrive before the clock ran out is a hole in the terrain
that looks exactly like a complete result.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass, field

#: Total seconds one `generate_terrain` call may spend upstream. Chosen to stay
#: inside a typical MCP client read timeout: the point of the budget is that the
#: server, not the client's socket, decides when a call is over.
DEFAULT_BUDGET_S = 120.0


class TerrainBudgetError(RuntimeError):
    """The request ran out of wall-clock time. Raised instead of answering short."""


@dataclass
class Budget:
    """Wall-clock left for a request, shared by every stage.

    `clock` is injected so a test can exhaust the budget with a fake slow
    upstream and no real network. It must be monotonic — a wall clock that
    steps backwards would hand the request more time than it was granted.
    """

    total_s: float
    clock: Callable[[], float] = time.monotonic
    started_at: float = field(init=False)

    def __post_init__(self) -> None:
        if not self.total_s > 0:
            raise ValueError("budget must be a positive number of seconds")
        self.started_at = self.clock()

    def elapsed_s(self) -> float:
        """Seconds spent since the budget was opened."""
        return self.clock() - self.started_at

    def remaining_s(self) -> float:
        """Seconds left, which may be zero or negative once exhausted."""
        return self.total_s - self.elapsed_s()

    def check(self, stage: str) -> None:
        """Raise `TerrainBudgetError` if nothing is left. Called between tiles."""
        remaining = self.remaining_s()
        if remaining <= 0:
            raise TerrainBudgetError(
                f"the {self.total_s:.0f}s budget for this request ran out during {stage} "
                f"after {self.elapsed_s():.1f}s — request a smaller bbox, a coarser lod, "
                "or texture=false"
            )

    def slice_s(self, cap_s: float, stage: str) -> float:
        """The timeout for the next call: the smaller of its own cap and what is left."""
        self.check(stage)
        return min(cap_s, self.remaining_s())
