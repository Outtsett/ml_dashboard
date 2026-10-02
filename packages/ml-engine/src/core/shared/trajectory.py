"""
Weight trajectory recorder for loss landscape visualization.

Records model weight snapshots during training, computes PCA projection
for live 3D trajectory visualization in the dashboard.

Usage in training loop:
    recorder = TrajectoryRecorder(model, record_every=5)
    for epoch in range(epochs):
        train(...)
        recorder.record(model, epoch, val_loss)
        # Use emit_model_state for structured data (emit_metric only accepts floats)
        trajectory = recorder.get_live_trajectory()
        if trajectory:
            emit_model_state(epoch, epochs, {"loss_trajectory": trajectory})
"""

import numpy as np
import torch


class TrajectoryRecorder:
    """Records model weight snapshots and projects them via PCA for visualization.

    Flattens all model parameters into a single vector at each recording step,
    then uses PCA to project the high-dimensional trajectory onto 2 principal
    components. The result is formatted for the dashboard SSE protocol.

    Parameters
    ----------
    model : torch.nn.Module
        Initial model reference. Used only to determine parameter count
        at construction time.
    record_every : int
        Record a snapshot every N epochs. Default 5.
    """

    def __init__(self, model: torch.nn.Module, record_every: int = 5):
        self.record_every = max(1, record_every)
        self._snapshots: list[np.ndarray] = []
        self._losses: list[float] = []
        self._epochs: list[int] = []
        self._param_count = sum(p.numel() for p in model.parameters())
        self._pca = None  # Lazily fitted PCA instance

    @property
    def snapshot_count(self) -> int:
        """Number of recorded snapshots."""
        return len(self._snapshots)

    def record(self, model: torch.nn.Module, epoch: int, loss: float) -> None:
        """Record a weight snapshot if this epoch aligns with record_every.

        Parameters
        ----------
        model : torch.nn.Module
            Current model state. All parameters are flattened to a single
            float32 numpy vector.
        epoch : int
            Current epoch number (0-indexed).
        loss : float
            Validation loss at this epoch.
        """
        if epoch % self.record_every != 0:
            return

        flat = self._flatten_params(model)
        if flat is None:
            return

        self._snapshots.append(flat)
        self._losses.append(float(loss))
        self._epochs.append(int(epoch))

    def get_live_trajectory(self) -> dict:
        """Compute PCA projection of the recorded trajectory.

        Returns
        -------
        dict
            Empty dict if fewer than 2 snapshots. Otherwise::

                {
                    "points": [
                        {"pc1": float, "pc2": float, "loss": float, "epoch": int},
                        ...
                    ],
                    "explained_variance": [float, float]
                }

            Explained variance is the fraction of total variance captured
            by each principal component.
        """
        if len(self._snapshots) < 2:
            return {}

        from sklearn.decomposition import PCA

        snapshot_matrix = np.stack(self._snapshots, axis=0)  # (N, D)

        pca = PCA(n_components=2)
        projected = pca.fit_transform(snapshot_matrix)  # (N, 2)
        self._pca = pca

        points = []
        for i in range(len(self._snapshots)):
            points.append(
                {
                    "pc1": round(float(projected[i, 0]), 6),
                    "pc2": round(float(projected[i, 1]), 6),
                    "loss": round(float(self._losses[i]), 6),
                    "epoch": self._epochs[i],
                }
            )

        explained = pca.explained_variance_ratio_
        return {
            "points": points,
            "explained_variance": [round(float(explained[0]), 6), round(float(explained[1]), 6)],
        }

    def get_pca_directions(self) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Return PCA directions and center for loss surface computation.

        Fits PCA if not already fitted. The two principal components define
        the plane in weight space along which the loss surface is computed.

        Returns
        -------
        tuple[np.ndarray, np.ndarray, np.ndarray]
            (pc1, pc2, center) where:
            - pc1: (D,) first principal component direction
            - pc2: (D,) second principal component direction
            - center: (D,) mean of all snapshots (PCA center)

        Raises
        ------
        ValueError
            If fewer than 2 snapshots have been recorded.
        """
        if len(self._snapshots) < 2:
            raise ValueError(
                f"Need at least 2 snapshots for PCA directions, have {len(self._snapshots)}"
            )

        from sklearn.decomposition import PCA

        if self._pca is None:
            snapshot_matrix = np.stack(self._snapshots, axis=0)
            pca = PCA(n_components=2)
            pca.fit(snapshot_matrix)
            self._pca = pca

        pc1 = self._pca.components_[0].astype(np.float32)  # (D,)
        pc2 = self._pca.components_[1].astype(np.float32)  # (D,)
        center = self._pca.mean_.astype(np.float32)  # (D,)

        return pc1, pc2, center

    def _flatten_params(self, model: torch.nn.Module) -> np.ndarray | None:
        """Flatten all model parameters into a single float32 numpy vector.

        Parameters
        ----------
        model : torch.nn.Module
            Model whose parameters to flatten.

        Returns
        -------
        np.ndarray | None
            Flattened parameter vector of shape (D,), or None if NaN detected.
        """
        parts = []
        for p in model.parameters():
            parts.append(p.detach().cpu().reshape(-1))
        flat = torch.cat(parts).numpy().astype(np.float32)

        if np.any(np.isnan(flat)):
            return None

        return flat
