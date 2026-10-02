"""A self-organising map (Kohonen) as a state model, trained with MiniSom.

A ``grid_rows`` x ``grid_columns`` grid of prototype vectors is initialised
on the training rows' two leading principal components and trained by
competitive learning: for each training row drawn in a seeded random order,
the best-matching unit (the nearest prototype) and its grid neighbours (a
Gaussian neighbourhood of initial width ``neighborhood_width``) move toward
the row, the step and the width shrinking over ``iteration_count`` updates
from ``learning_rate``. A bar's state is its best-matching unit.

The readout uses the map's topology: each cell's up-rate (or mean move) pools
the evidence of its grid neighbours with a Gaussian kernel of width
``topology_smoothing`` cells (0: every cell on its own), so a cell few
training rows landed in borrows from the cells around it — neighbouring cells
hold similar bars, which is what the map was trained to make true.
"""

from __future__ import annotations

import numpy as np

from .common import nearest, one_hot, single_thread
from .state_model import FitContext, StateModel, occupancy


class SelfOrganizingMapStates(StateModel):
    variant = "som"

    def fit(self, space: np.ndarray, context: FitContext) -> None:
        from minisom import MiniSom

        rows, columns = int(self.parameters["grid_rows"]), int(self.parameters["grid_columns"])
        points = np.asarray(space, dtype=np.float64)
        with single_thread():
            som = MiniSom(rows, columns, points.shape[1], sigma=float(self.parameters["neighborhood_width"]),
                          learning_rate=float(self.parameters["learning_rate"]), neighborhood_function="gaussian",
                          random_seed=self.seed)
            if points.shape[1] >= 2:
                som.pca_weights_init(points)
            else:
                som.random_weights_init(points)
            som.train(points, int(self.parameters["iteration_count"]), random_order=True)
        self.prototypes = np.asarray(som.get_weights(), dtype=np.float64).reshape(rows * columns, points.shape[1])
        self.grid_shape = np.asarray([rows, columns], dtype=np.int64)
        self.quantization_error = float(som.quantization_error(points))
        self._codes = nearest(points, self.prototypes)[0]

    @property
    def state_count(self) -> int:
        return int(self.prototypes.shape[0])

    def responsibilities(self, space: np.ndarray) -> np.ndarray:
        return one_hot(nearest(space, self.prototypes)[0], self.state_count)

    def smoothing(self) -> np.ndarray | None:
        width = float(self.parameters.get("topology_smoothing", 0.0))
        if width <= 0:
            return None
        rows, columns = (int(value) for value in self.grid_shape)
        cells = np.stack(np.meshgrid(np.arange(rows), np.arange(columns), indexing="ij"), axis=-1).reshape(-1, 2)
        distance = ((cells[:, None, :] - cells[None, :, :]) ** 2).sum(axis=2)
        return np.exp(-distance / (2.0 * width ** 2))

    def arrays(self) -> dict[str, np.ndarray]:
        return {"prototypes": self.prototypes, "grid_shape": self.grid_shape}

    def restore(self, arrays: dict[str, np.ndarray]) -> None:
        self.prototypes = np.asarray(arrays["prototypes"], dtype=np.float64)
        self.grid_shape = np.asarray(arrays["grid_shape"], dtype=np.int64)

    def describe(self) -> str:
        used = int(np.unique(self._codes).size)
        rows, columns = (int(value) for value in self.grid_shape)
        return (f"self-organising map {rows} x {columns}: {used} of {self.state_count} cells hold training rows, "
                f"quantization error {self.quantization_error:.3f}; rows per cell {occupancy(self._codes, self.state_count)}")


__all__ = ["SelfOrganizingMapStates"]
