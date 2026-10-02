"""``ImplicitGeneratorClassifierAdapter``: the Model Cycle adapter of the GAN family.

The variant (``direction.fixed.variant`` of the registry entry) picks one of
three routes to a class posterior (see the package docstring):

==================================  ============  =====================================
variant                             route         mechanism module
==================================  ============  =====================================
generative_adversarial_network      synthetic     generators.PerClassGan
conditional_gan                     synthetic     generators.ConditionalGan
wasserstein_gan                     synthetic     generators.WassersteinGan
big_gan                             synthetic     generators.BigGan
style_gan                           synthetic     generators.StyleGan
self_supervised_gan                 synthetic     generators.SelfSupervisedGan
adversarial_autoencoder             native        autoencoder.AdversarialAutoencoder
cycle_consistent_gan                displacement  translation.CycleTranslation
==================================  ============  =====================================

Fit (training rows only; validation rows for early stopping and calibration):

- synthetic: ``epochs`` generator epochs, then exactly ``samples_per_class``
  rows are drawn per class, then ``classifier_epochs`` epochs of the posterior
  classifier on those synthetic rows, early-stopped on the real validation
  rows. The real-versus-fake accuracy of the generator is logged and kept in
  the fit summary.
- native: ``epochs`` epochs of the adversarial autoencoder, the epoch with the
  best validation loss of q(class | x) kept.
- displacement: ``epochs`` epochs of CycleGAN; after each, the validation
  logistic on the displacement score and the discriminator gap (direction) or
  the displacement regression (price) is refitted, the
  best epoch kept.

Prediction reads only the bar's own causal feature row, through float64 numpy
copies of the networks (``layers.numpy_forward``), so it is deterministic, a
row alone equals the batch, and the saved model predicts without torch.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from cycle.bridges import persistence
from cycle.bridges.base import BridgeAdapter
from cycle.bridges.training import ValidationScore, run_epochs, score

from . import layers
from .problem import build_problem

ROUTES = {
    "generative_adversarial_network": "synthetic",
    "conditional_gan": "synthetic",
    "wasserstein_gan": "synthetic",
    "big_gan": "synthetic",
    "style_gan": "synthetic",
    "self_supervised_gan": "synthetic",
    "adversarial_autoencoder": "native",
    "cycle_consistent_gan": "displacement",
}
CLASSIFIER_LEARNING_RATE = 1e-3
DISPLACEMENT_RIDGE_PENALTY = 1.0
NETWORKS_FILE = "networks.pt"


def _format_losses(losses: dict) -> str:
    return ", ".join(f"{name} {value:.4f}" for name, value in losses.items() if np.isfinite(value))


class ImplicitGeneratorClassifierAdapter(BridgeAdapter):
    step_unit = "epoch"
    needs_market = False              # reads only the causal feature rows and the targets fit is handed
    model_file = "posterior.npz"

    def __init__(self, key, entry, parameters, device, seed, task="classification") -> None:
        super().__init__(key, entry, parameters, device, seed, task)
        if self.variant not in ROUTES:
            raise ValueError(f"{key}: unknown variant {self.variant!r}; this family builds {', '.join(ROUTES)}")
        self.route = ROUTES[self.variant]
        self.predictor: dict | None = None
        self.network_state: dict | None = None
        self.synthetic_counts: dict[int, int] = {}
        self.health: dict = {}

    def minimum_history(self) -> int:
        return 1

    # ── fitting ──
    def _torch_device(self) -> str:
        import torch

        if self.device == "auto":
            return "cuda" if torch.cuda.is_available() else "cpu"
        if self.device.startswith("cuda") and not torch.cuda.is_available():
            return "cpu"
        return self.device

    def _fit(self, features, labels, train_index, validation_index, timestamps, reporter) -> None:
        import torch

        from cycle.models import _training_summary

        parameters = self.parameters
        problem = build_problem(features, labels, train_index, validation_index, self.task,
                                int(parameters.get("bin_count", 5)), self.key)
        device = self._torch_device()
        reporter.log(f"{self.key}: {self.variant} on {problem.x.shape[0]} training rows "
                     f"({problem.unlabelled_x.shape[0]} unlabelled in the span), {problem.class_count} classes "
                     f"(train counts {problem.counts.tolist()}), device {device}")
        with torch.random.fork_rng(devices=[]):
            torch.manual_seed(self.seed)
            if self.route == "synthetic":
                summary = self._fit_synthetic(problem, device, reporter)
            elif self.route == "native":
                summary = self._fit_autoencoder(problem, device, reporter)
            else:
                summary = self._fit_translation(problem, labels, device, reporter)
        self.best_iteration = summary.get("best_epoch")
        self.fit_summary = {
            **_training_summary(np.asarray(train_index, dtype=np.int64), np.asarray(validation_index, dtype=np.int64),
                                timestamps),
            **{key: value for key, value in summary.items() if key != "fit_seconds"},
            "variant": self.variant,
            "route": self.route,
            "class_count": int(problem.class_count),
            "train_class_counts": [int(count) for count in problem.counts],
        }

    def _validation_score(self, probabilities: np.ndarray, problem) -> ValidationScore:
        """The adapter's validation score from a (v, K) posterior."""
        if problem.validation_x.shape[0] == 0:
            return ValidationScore(None, None, None, None)
        return score(self.task, probabilities @ problem.class_values, problem.validation_target)

    def _log_every(self, epochs: int) -> int:
        return max(1, int(epochs) // 5)

    # synthetic samples -> train-on-synthetic posterior
    def _fit_synthetic(self, problem, device, reporter) -> dict:
        from .generators import TRAINERS
        from .posterior import SyntheticPosterior

        parameters = self.parameters
        trainer = TRAINERS[self.variant](problem, parameters, device, self.seed)
        generator_epochs = int(parameters["epochs"])
        classifier_epochs = int(parameters["classifier_epochs"])
        every = self._log_every(generator_epochs)
        holder: dict = {}

        def train_epoch(epoch, report_batch):
            if epoch <= generator_epochs:
                loss = trainer.train_epoch()
                if epoch == 1 or epoch == generator_epochs or epoch % every == 0:
                    reporter.log(f"{self.key}: generator epoch {epoch}/{generator_epochs}: {_format_losses(trainer.last_losses)}")
                return loss
            if "posterior" not in holder:
                samples, classes = self._synthesise(trainer, problem, reporter)
                holder["posterior"] = SyntheticPosterior(
                    samples, classes, problem.class_count, problem.log_prior,
                    {"hidden_size": parameters["hidden_size"], "learning_rate": CLASSIFIER_LEARNING_RATE,
                     "batch_size": parameters["batch_size"]}, device, self.seed + 1)
            return holder["posterior"].train_epoch()

        def validate(epoch):
            if epoch <= generator_epochs:
                return ValidationScore(None, None, None, None)
            return self._validation_score(holder["posterior"].probabilities(problem.validation_x), problem)

        summary = run_epochs(reporter, epoch_count=generator_epochs + classifier_epochs, train_index=problem.rows,
                             train_epoch=train_epoch, validate=validate,
                             snapshot=lambda: holder["posterior"].snapshot(),
                             restore=lambda state: holder["posterior"].restore(state),
                             patience=int(parameters["patience"]), name=self.key)
        if "posterior" not in holder:          # stopped by patience before the classifier started (cannot happen: GAN epochs never count)
            raise RuntimeError(f"{self.key}: the fit ended before the posterior classifier was trained")
        self.predictor = {"route": "posterior", "layers": holder["posterior"].export(),
                          "log_prior": problem.log_prior.copy(), "class_values": problem.class_values.copy()}
        self.network_state = {"generator": trainer.state(), "posterior": holder["posterior"].snapshot()}
        summary.update(self.health)
        summary["synthetic_rows_per_class"] = {str(k): int(v) for k, v in self.synthetic_counts.items()}
        return summary

    def _synthesise(self, trainer, problem, reporter) -> tuple[np.ndarray, np.ndarray]:
        """Exactly ``samples_per_class`` generated rows per class present in training, and the health number."""
        from .posterior import real_versus_fake_accuracy

        per_class = int(self.parameters["samples_per_class"])
        blocks, classes = [], []
        self.synthetic_counts = {}
        for k in np.flatnonzero(problem.present):
            rows = trainer.sample(int(k), per_class)
            if rows.shape != (per_class, problem.feature_count):
                raise RuntimeError(f"{self.key}: the generator returned {rows.shape} rows for class {k}, "
                                   f"not {(per_class, problem.feature_count)}")
            blocks.append(rows)
            classes.append(np.full(per_class, int(k), dtype=np.int64))
            self.synthetic_counts[int(k)] = per_class
        samples, labels = np.concatenate(blocks), np.concatenate(classes)
        finite = np.all(np.isfinite(samples), axis=1)
        if not finite.all():
            reporter.log(f"{self.key}: {int((~finite).sum())} generated rows are not finite (the generator diverged); "
                         "they are left out of the posterior's training set", "warning")
            samples, labels = samples[finite], labels[finite]
        self.health = self._health(samples, labels, problem, real_versus_fake_accuracy, reporter)
        return samples, labels

    def _health(self, samples, labels, problem, measure, reporter) -> dict:
        """Real-versus-fake accuracy with the generated rows matched to the real class mix."""
        random = np.random.default_rng(self.seed + 2)
        fit_fake, held_fake = [], []
        validation_share = problem.validation_x.shape[0] / max(1, problem.x.shape[0])
        for k in np.flatnonzero(problem.present):
            pool = random.permutation(np.flatnonzero(labels == k))
            half = pool.size // 2
            fit_fake.append(samples[pool[:half][: int(problem.counts[k])]])
            held_fake.append(samples[pool[half:][: max(1, int(round(problem.counts[k] * validation_share)))]])
        accuracy = measure(problem.x, np.concatenate(fit_fake), problem.validation_x, np.concatenate(held_fake))
        if accuracy is not None:
            reporter.log(f"{self.key}: real-vs-fake accuracy {accuracy:.3f} on validation rows (0.5 = the generated "
                         "rows cannot be told from real bars; near 1 = the posterior was trained on unrealistic rows)")
        return {"real_versus_fake_accuracy": accuracy}

    # the adversarial autoencoder's own head
    def _fit_autoencoder(self, problem, device, reporter) -> dict:
        from .autoencoder import AdversarialAutoencoder
        from .posterior import real_versus_fake_accuracy

        parameters = self.parameters
        model = AdversarialAutoencoder(problem, parameters, device, self.seed)
        epochs = int(parameters["epochs"])
        every = self._log_every(epochs)

        def train_epoch(epoch, report_batch):
            loss = model.train_epoch()
            if epoch == 1 or epoch == epochs or epoch % every == 0:
                reporter.log(f"{self.key}: epoch {epoch}/{epochs}: {_format_losses(model.last_losses)}")
            return loss

        summary = run_epochs(reporter, epoch_count=epochs, train_index=problem.rows, train_epoch=train_epoch,
                             validate=lambda epoch: self._validation_score(model.class_probabilities(problem.validation_x), problem),
                             snapshot=model.snapshot, restore=model.restore, patience=int(parameters["patience"]),
                             name=self.key)
        self.predictor = {"route": "posterior", "layers": model.export(),
                          "log_prior": np.zeros(problem.class_count), "class_values": problem.class_values.copy()}
        self.network_state = {"autoencoder": model.state()}
        per_class = int(parameters["samples_per_class"])
        present = np.flatnonzero(problem.present)
        samples = np.concatenate([model.sample(int(k), per_class) for k in present])
        labels = np.concatenate([np.full(per_class, int(k)) for k in present])
        summary.update(self._health(samples, labels, problem, real_versus_fake_accuracy, reporter))
        return summary

    # CycleGAN's translation displacement
    def _fit_translation(self, problem, targets, device, reporter) -> dict:
        from .posterior import real_versus_fake_accuracy
        from .translation import (
            CycleTranslation,
            ValidationLogistic,
            direction_scores,
            displacement_design,
            displacements,
        )

        parameters = self.parameters
        train_targets = np.asarray(targets, dtype=np.float64)[problem.rows]
        domain_b = train_targets >= 0.5 if self.task == "classification" else train_targets > 0.0
        model = CycleTranslation(problem.x, domain_b, parameters, device, self.seed)
        epochs = int(parameters["epochs"])
        every = self._log_every(epochs)
        low, high = (np.quantile(train_targets, [0.01, 0.99]) if self.task == "regression" else (0.0, 1.0))
        current: dict = {}

        def fit_head(blocks) -> dict:
            if self.task == "classification":
                validation = direction_scores(blocks, problem.validation_x)
                return {"logistic": ValidationLogistic.fit(validation, problem.validation_target)}
            design = displacement_design(blocks, problem.x)
            clipped = np.clip(train_targets, low, high)
            penalty = DISPLACEMENT_RIDGE_PENALTY * np.eye(design.shape[1])
            penalty[-1, -1] = 0.0                                                 # the intercept is not shrunk
            return {"coefficients": np.linalg.solve(design.T @ design + penalty, design.T @ clipped)}

        def predict_validation(blocks, head) -> np.ndarray:
            if self.task == "classification":
                up = head["logistic"].apply(direction_scores(blocks, problem.validation_x))
                return np.column_stack([1.0 - up, up])
            value = displacement_design(blocks, problem.validation_x) @ head["coefficients"]
            return value[:, None]

        def train_epoch(epoch, report_batch):
            loss = model.train_epoch()
            if epoch == 1 or epoch == epochs or epoch % every == 0:
                reporter.log(f"{self.key}: epoch {epoch}/{epochs}: {_format_losses(model.last_losses)}")
            return loss

        def validate(epoch):
            blocks = model.export()
            head = fit_head(blocks)
            current.update(blocks=blocks, head=head)
            if problem.validation_x.shape[0] == 0:
                return ValidationScore(None, None, None, None)
            prediction = predict_validation(blocks, head)
            if self.task == "classification":
                return score(self.task, prediction[:, 1], problem.validation_target)
            return score(self.task, prediction[:, 0], problem.validation_target)

        summary = run_epochs(reporter, epoch_count=epochs, train_index=problem.rows, train_epoch=train_epoch,
                             validate=validate,
                             snapshot=lambda: (model.snapshot(), current["blocks"], current["head"]),
                             restore=lambda state: (model.restore(state[0]), current.update(blocks=state[1], head=state[2])),
                             patience=int(parameters["patience"]), name=self.key)
        blocks, head = current["blocks"], current["head"]
        self.predictor = {"route": "displacement", "blocks": blocks, **head}
        self.network_state = {"cycle": model.state()}
        # health: G(down rows) against real up rows
        validation_targets = problem.validation_target
        validation_up = validation_targets >= 0.5 if self.task == "classification" else validation_targets > 0.0
        forward_train, _ = displacements(blocks, problem.x[~domain_b])
        forward_validation, _ = displacements(blocks, problem.validation_x[~validation_up])
        accuracy = real_versus_fake_accuracy(problem.x[domain_b], problem.x[~domain_b] + forward_train,
                                             problem.validation_x[validation_up],
                                             problem.validation_x[~validation_up] + forward_validation)
        if accuracy is not None:
            reporter.log(f"{self.key}: real-vs-translated accuracy {accuracy:.3f} (up bars against down bars "
                         "translated to up; 0.5 = indistinguishable)")
        summary["real_versus_fake_accuracy"] = accuracy
        return summary

    # ── prediction ──
    def _values(self, features, index) -> np.ndarray:
        x = np.asarray(features[index], dtype=np.float64)
        out = np.full(index.shape[0], np.nan, dtype=np.float64)
        finite = np.all(np.isfinite(x), axis=1)
        if not finite.any():
            return out
        x = x[finite]
        predictor = self.predictor
        if predictor["route"] == "posterior":
            probabilities = layers.softmax(layers.numpy_forward(predictor["layers"], x) + predictor["log_prior"][None, :])
            out[finite] = probabilities @ predictor["class_values"]
        else:
            from .translation import direction_scores, displacement_design

            if self.task == "classification":
                out[finite] = predictor["logistic"].apply(direction_scores(predictor["blocks"], x))
            else:
                out[finite] = displacement_design(predictor["blocks"], x) @ predictor["coefficients"]
        return out

    def _predict_probability(self, features, index) -> np.ndarray:
        return self._values(features, index)

    def _predict_value(self, features, index) -> np.ndarray:
        return self._values(features, index)

    # ── save / load ──
    def _save_state(self, folder: Path) -> str:
        predictor = self.predictor
        arrays: dict[str, np.ndarray] = {}
        if predictor["route"] == "posterior":
            arrays.update(layers.layers_to_arrays("posterior", predictor["layers"]))
            arrays["log_prior"] = predictor["log_prior"]
            arrays["class_values"] = predictor["class_values"]
        else:
            for direction in ("forward", "backward"):
                flat = [layer for block in predictor["blocks"][direction] for layer in block]
                arrays.update(layers.layers_to_arrays(direction, flat))
            for critic in ("critic_a", "critic_b"):
                arrays.update(layers.layers_to_arrays(critic, predictor["blocks"][critic]))
            if "logistic" in predictor:
                arrays["logistic"] = predictor["logistic"].to_array()
            else:
                arrays["coefficients"] = predictor["coefficients"]
        persistence.save_arrays(folder / self.model_file, **arrays)
        if self.network_state is not None:
            persistence.save_torch(folder / NETWORKS_FILE, self.network_state)
        return self.model_file

    def _load_state(self, folder: Path, metadata: dict) -> None:
        self.route = ROUTES[self.variant]
        self.network_state = None
        self.synthetic_counts = {}
        self.health = {}
        arrays = persistence.load_arrays(folder / metadata.get("model_file", self.model_file))
        if "posterior_count" in arrays:
            self.predictor = {"route": "posterior", "layers": layers.layers_from_arrays("posterior", arrays),
                              "log_prior": np.asarray(arrays["log_prior"], dtype=np.float64),
                              "class_values": np.asarray(arrays["class_values"], dtype=np.float64)}
            return
        blocks = {}
        for direction in ("forward", "backward"):
            flat = layers.layers_from_arrays(direction, arrays)
            blocks[direction] = [(flat[2 * position], flat[2 * position + 1]) for position in range(len(flat) // 2)]
        for critic in ("critic_a", "critic_b"):
            blocks[critic] = layers.layers_from_arrays(critic, arrays)
        self.predictor = {"route": "displacement", "blocks": blocks}
        if "logistic" in arrays:
            from .translation import ValidationLogistic

            self.predictor["logistic"] = ValidationLogistic.from_array(arrays["logistic"])
        else:
            self.predictor["coefficients"] = np.asarray(arrays["coefficients"], dtype=np.float64)

    def _library_versions(self) -> dict[str, str]:
        return persistence.library_versions("numpy", "torch", "scikit-learn")


__all__ = ["ImplicitGeneratorClassifierAdapter", "ROUTES"]
