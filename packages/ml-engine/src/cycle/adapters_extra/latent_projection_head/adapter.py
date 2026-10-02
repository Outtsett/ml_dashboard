"""``LatentProjectionHeadAdapter``: a label-free projection read by a supervised head.

Twelve catalog specs are dimensionality reductions, manifold learners,
autoencoders or a metric-learning network: none of them predicts a direction.
This family runs each by its own mechanism and adds the one supervised piece
the Cycle needs, a head fitted on the fold's labels:

    variant                  encoder (fitted WITHOUT labels)              module
    pca                      principal components                        encoders.PrincipalComponents
    fast_ica                 independent components (FastICA)            encoders.IndependentComponents
    nmf                      non-negative parts, NNLS activations        encoders.NonNegativeFactorisation
    isomap_lle               Isomap or locally linear embedding          encoders.ManifoldEmbedding
    umap                     UMAP, transform per bar                     encoders.UniformManifoldProjection
    open_tsne                t-SNE, openTSNE placement per bar           encoders.StochasticNeighbourEmbedding
    autoencoder              (denoising / sparse) autoencoder            networks.NetworkEncoder
    deep_clustering          autoencoder + Student-t cluster centres     networks.NetworkEncoder
    variational              variational autoencoder                     networks.NetworkEncoder
    adversarial_autoencoder  autoencoder-GAN fusion                      networks.NetworkEncoder
    siamese_neighbors        triplet-trained window encoder + analogue   siamese.SiameseNeighbours
                             search (labels define its pairs; no head)

The head (``head.SupervisedHead``): logistic regression or gradient boosting
for P(up), ridge or gradient boosting for the price target, on the code
standardised with the training codes. The variational variant averages the
head over ``posterior_sample_count`` draws from the bar's posterior, seeded by
(seed, row) so a bar gets the same number alone or in a batch (a linear price
head's average is exactly the head at the posterior mean, so it is used as is).

Rows: the encoder reads the finite feature rows of the training span
(``fit_rows``: labelled or not; its label is never passed); early stopping and
the fit report read the validation rows' features; the head reads the
training rows' codes and targets. Prediction at bar t reads feature row t only
(the Siamese window: rows t - L + 1 .. t). Nothing reads the market view, so a
model reloaded by the explainer needs none.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from cycle.bridges import persistence
from cycle.bridges.base import BridgeAdapter
from cycle.bridges.training import score, single_fit

from .encoders import LINEAR_AND_MANIFOLD, evenly_spaced
from .head import SupervisedHead

NETWORK_VARIANTS = ("autoencoder", "deep_clustering", "variational", "adversarial_autoencoder")
SIAMESE_VARIANT = "siamese_neighbors"
VARIANTS = (*LINEAR_AND_MANIFOLD, *NETWORK_VARIANTS, SIAMESE_VARIANT)
LAYOUT_FILE = "latent_projection.json"
POSTERIOR_SEED_OFFSET = 7919


class LatentProjectionHeadAdapter(BridgeAdapter):
    needs_market = False
    model_file = LAYOUT_FILE

    def __init__(self, key: str, entry: dict, parameters: dict, device: str, seed: int,
                 task: str = "classification") -> None:
        super().__init__(key, entry, parameters, device, seed, task)
        if self.variant not in VARIANTS:
            raise ValueError(f"{key}: unknown latent projection variant {self.variant!r}; known: {', '.join(VARIANTS)}")
        self.step_unit = "single_fit" if self.variant in LINEAR_AND_MANIFOLD else "epoch"
        self.encoder = None
        self.head: SupervisedHead | None = None
        self.siamese = None

    # ── construction helpers ──
    def _torch_device(self) -> str:
        from .networks import resolve_device

        return resolve_device(self.device)

    def _new_encoder(self):
        if self.variant in LINEAR_AND_MANIFOLD:
            return LINEAR_AND_MANIFOLD[self.variant](self.parameters, self.seed)
        from .networks import NetworkEncoder

        return NetworkEncoder(self.parameters, self.seed, self.variant, self._torch_device())

    def _new_head(self) -> SupervisedHead:
        return SupervisedHead(self.task, str(self.parameters["head_model"]),
                              float(self.parameters["regularization_strength"]), self.seed)

    def minimum_history(self) -> int:
        return int(self.parameters["sequence_length"]) if self.variant == SIAMESE_VARIANT else 1

    def _library_versions(self) -> dict[str, str]:
        names = ["numpy", "scikit-learn"]
        if self.variant == "umap":
            names += ["umap-learn", "pynndescent"]
        elif self.variant == "open_tsne":
            names.append("openTSNE")
        elif self.variant == "nmf":
            names.append("scipy")
        elif self.variant in NETWORK_VARIANTS or self.variant == SIAMESE_VARIANT:
            names.append("torch")
        return persistence.library_versions(*names)

    # ── fitting ──
    @staticmethod
    def _finite_rows(features: np.ndarray, rows: np.ndarray) -> np.ndarray:
        rows = np.asarray(rows, dtype=np.int64)
        if rows.size == 0:
            return rows
        return rows[np.all(np.isfinite(np.asarray(features[rows], dtype=np.float64)), axis=1)]

    def _fit(self, features, labels, train_index, validation_index, timestamps, reporter) -> None:
        targets = np.asarray(labels, dtype=np.float64)
        if self.variant == SIAMESE_VARIANT:
            from .siamese import SiameseNeighbours

            self.siamese = SiameseNeighbours(self.parameters, self.seed, self.task, self._torch_device())
            self.fit_summary = self.siamese.fit(features, targets, train_index, validation_index, reporter)
            return
        # the encoder's rows: every finite row of the training span (labelled or not), labels never passed
        span = np.arange(int(train_index[0]), int(train_index[-1]) + 1, dtype=np.int64)
        encoder_rows = self._finite_rows(features, span)
        if encoder_rows.size < 10:
            raise ValueError(f"{self.key}: only {encoder_rows.size} finite feature rows in the training span")
        encoder_matrix = np.asarray(features[encoder_rows], dtype=np.float64)
        validation_rows = self._finite_rows(features, validation_index)
        validation_matrix = np.asarray(features[validation_rows], dtype=np.float64)
        head_rows = self._finite_rows(features, train_index)
        head_rows = head_rows[np.isfinite(targets[head_rows])]
        validation_scored = validation_rows[np.isfinite(targets[validation_rows])]
        self.encoder = self._new_encoder()
        self.head = self._new_head()
        summary: dict = {"variant": self.variant, "encoder_row_count": int(encoder_rows.size)}

        def fit_head() -> dict:
            fitted = self.encoder.training_codes()
            if fitted is None:
                rows, codes = head_rows, self._codes(features, head_rows)
            else:
                # a manifold's own coordinates of its (subsampled) fit rows, labelled training rows only
                positions, coordinates = fitted
                sampled = encoder_rows[positions]
                keep = np.isin(sampled, head_rows)
                rows, codes = sampled[keep], coordinates[keep]
            result = self.head.fit(codes, targets[rows])
            result["head_row_count"] = int(rows.size)
            return result

        scored = validation_scored
        if self.encoder.validation_limit is not None:
            scored = validation_scored[evenly_spaced(validation_scored.size, self.encoder.validation_limit)]

        def validation_score():
            prediction = self._predict_rows(features, scored)
            return score(self.task, prediction, targets[scored])

        if self.encoder.epoch_trained:
            summary.update(self.encoder.fit_epochs(encoder_matrix, validation_matrix, reporter, encoder_rows))
            reporter.checkpoint()
            summary.update(fit_head())
            result = validation_score()
            summary["head_validation_loss"] = result.loss
            summary["head_validation_accuracy"] = result.accuracy
        else:
            def fit_all() -> float | None:
                summary.update(self.encoder.fit(encoder_matrix, validation_matrix))
                summary.update(fit_head())
                return self.encoder.reconstruction_error(encoder_matrix)

            epochs = single_fit(reporter, train_index=encoder_rows, fit=fit_all, validate=validation_score,
                                name=self.key)
            summary["head_validation_loss"] = epochs["best_validation_loss"]
        for note in self.encoder.notes:
            reporter.log(f"{self.key}: {note}")
        summary["code_size"] = int(self.encoder.code_size)
        reporter.log(f"{self.key}: {self.variant} code of {self.encoder.code_size} numbers from "
                     f"{encoder_rows.size} training rows (labels unread); {self.head.head_model} head on "
                     f"{summary.get('head_row_count', head_rows.size)} labelled rows")
        self.fit_summary = summary

    # ── prediction ──
    def _codes(self, features, rows: np.ndarray) -> np.ndarray:
        return self.encoder.transform(np.asarray(features[np.asarray(rows, dtype=np.int64)], dtype=np.float64))

    def _predict_rows(self, features, index: np.ndarray) -> np.ndarray:
        index = np.asarray(index, dtype=np.int64)
        if index.size == 0:
            return np.empty(0, dtype=np.float64)
        if self.siamese is not None:
            return self.siamese.predict(features, index)
        matrix = np.asarray(features[index], dtype=np.float64)
        samples = int(self.parameters.get("posterior_sample_count", 0) or 0)
        exact_expectation = self.task == "regression" and self.head.boosting is None
        # a linear price head's average over posterior draws IS the head at the posterior mean: use it exactly
        if self.variant != "variational" or samples <= 0 or exact_expectation:
            return self.head.predict(self.encoder.transform(matrix))
        mean, deviation = self.encoder.posterior(matrix)
        out = np.full(index.size, np.nan, dtype=np.float64)
        for position, row in enumerate(index):
            if not np.all(np.isfinite(mean[position])):
                continue
            draws = np.random.default_rng((self.seed + POSTERIOR_SEED_OFFSET, int(row))).standard_normal(
                (samples, mean.shape[1]))
            out[position] = float(np.mean(self.head.predict(mean[position] + deviation[position] * draws)))
        return out

    def _predict_probability(self, features, index) -> np.ndarray:
        return self._predict_rows(features, index)

    def _predict_value(self, features, index) -> np.ndarray:
        return self._predict_rows(features, index)

    def encoder_state(self) -> dict[str, np.ndarray]:
        """The encoder's fitted arrays (the label-blindness test compares them)."""
        if self.siamese is not None:
            return self.siamese.state_arrays()
        return self.encoder.state_arrays()

    # ── persistence ──
    def _save_state(self, folder: Path) -> str:
        if self.siamese is not None:
            self.siamese.save(folder)
        else:
            self.encoder.save(folder)
            self.head.save(folder)
        persistence.save_json(folder / LAYOUT_FILE, {"variant": self.variant, "task": self.task,
                                                     "siamese": self.siamese is not None})
        return LAYOUT_FILE

    def _load_state(self, folder: Path, metadata: dict) -> None:
        self.step_unit = metadata.get("step_unit", "epoch")
        self.encoder = self.head = self.siamese = None
        if self.variant == SIAMESE_VARIANT:
            from .siamese import SiameseNeighbours

            self.siamese = SiameseNeighbours(self.parameters, self.seed, self.task, "cpu")
            self.siamese.restore(folder)
            return
        self.device = "cpu"
        self.encoder = self._new_encoder()
        self.encoder.restore(folder)
        self.head = SupervisedHead.load(folder, self.task, str(self.parameters["head_model"]),
                                        float(self.parameters["regularization_strength"]), self.seed)


__all__ = ["LatentProjectionHeadAdapter", "VARIANTS"]
