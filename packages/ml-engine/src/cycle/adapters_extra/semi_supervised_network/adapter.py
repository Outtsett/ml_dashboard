"""``SemiSupervisedNetworkAdapter``: the shared fit, prediction and persistence of the family.

The fit (training span only):

1. standardise the causal feature row with the mean and spread of the
   training span's rows (``MarketView.fit_rows``), clipped at +/- 6;
2. mask the labels (``bridges.pool.block_mask``): the span is cut into blocks
   of ``label_block_bars``, a seeded ``labeled_fraction`` of them keeps its
   labels, and a kept row within the label horizon of a hidden block is hidden
   too. The LABELLED set is the kept training rows with a known target; the
   HIDDEN pool is the rest of the span (plus the span rows the horizon or gap
   rule left unlabelled). A variant draws its unlabelled rows from the hidden
   pool, or from every span row for the consistency methods that regularise
   labelled rows as well (Pi-model, Mean Teacher, VAT, the ladder);
3. train epoch by epoch (``bridges.training.run_epochs``): the labelled rows in
   a seeded order, cut into batches of about ``batch_size``; each batch draws
   ``unlabeled_ratio`` times as many unlabelled rows from its own seeded stream;
   the step minimises supervised + ``unlabeled_weight`` * ramp * unsupervised;
   AdamW with the learning rate on a cosine from 1 to 0.1 of its value;
4. keep the epoch with the best validation score (log loss of P(up), Huber of
   the price) and stop after ``patience`` epochs without a better one.

The prediction at bar t reads row t of the feature matrix only: the kept
predictor (the Mean Teacher's averaged network, the ladder's clean path) in
evaluation mode, copied to the CPU in float64, so a row scored alone equals
the same row in a batch. A row with a missing feature gets NaN.
"""

from __future__ import annotations

import copy
import time
from pathlib import Path

import numpy as np

from cycle.bridges import persistence, pool, training
from cycle.bridges.base import BridgeAdapter

from . import generative, methods

FEATURE_CLIP = 6.0
MINIMUM_LABELLED_ROWS = 20
MINIMUM_BATCH_ROWS = 2

VARIANTS: dict[str, type[methods.Method]] = {
    "supervised": methods.Method,                   # the plain network (the reference in the family's tests)
    "pseudo_label": methods.PseudoLabel,
    "consistency": methods.Consistency,
    "fixmatch": methods.FixMatch,
    "mixmatch": methods.MixMatch,
    "virtual_adversarial": methods.VirtualAdversarial,
    "entropy_minimization": methods.EntropyMinimization,
    "ladder": generative.Ladder,
    "generative_discriminative": generative.GenerativeDiscriminative,
    "k_plus_one_gan": generative.KPlusOneGan,
}


def scoring_copy(module):
    """A float64 CPU copy of ``module`` in evaluation mode with gradients off."""
    import torch

    scorer = copy.deepcopy(module).to(device="cpu", dtype=torch.float64).eval()
    for parameter in scorer.parameters():
        parameter.requires_grad_(False)
    return scorer


class SemiSupervisedNetworkAdapter(BridgeAdapter):
    model_file = "network.pt"

    def __init__(self, key: str, entry: dict, parameters: dict, device: str, seed: int,
                 task: str = "classification") -> None:
        super().__init__(key, entry, parameters, device, seed, task)
        if self.variant not in VARIANTS:
            raise ValueError(f"{key}: direction.fixed.variant {self.variant!r} is not a semi-supervised variant "
                             f"({', '.join(VARIANTS)})")
        if task == "regression" and not VARIANTS[self.variant].has_price:
            raise ValueError(f"{key}: the {self.variant} variant has no price model (its registry price is null)")
        fixed = ((entry or {}).get("direction") or {}).get("fixed", {}) or {}
        self.settings = {name: value for name, value in fixed.items() if name != "variant"}
        self._reset_state()

    def _reset_state(self) -> None:
        self.method: methods.Method | None = None
        self.scorer = None
        self.network_state: dict | None = None
        self.mean: np.ndarray | None = None
        self.scale: np.ndarray | None = None

    @property
    def method_parameters(self) -> dict:
        return {**self.parameters, **self.settings}

    def minimum_history(self) -> int:
        return 1

    def _library_versions(self) -> dict[str, str]:
        return persistence.library_versions("numpy", "torch")

    def new_method(self, feature_count: int, device: str) -> methods.Method:
        return VARIANTS[self.variant](self.task, feature_count, self.method_parameters, device, self.seed)

    # ── data ──
    def standardise(self, features, rows: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """(standardised float64 rows, finite mask) of ``features[rows]``; a non-finite row is zeroed."""
        values = np.asarray(features[rows], dtype=np.float64).reshape(len(rows), np.shape(features)[1])
        finite = np.all(np.isfinite(values), axis=1)
        standardised = np.clip((values - self.mean) / self.scale, -FEATURE_CLIP, FEATURE_CLIP)
        standardised[~finite] = 0.0
        return standardised, finite

    def split(self, features, target: np.ndarray, train_index: np.ndarray) -> dict[str, np.ndarray]:
        """The labelled rows, the hidden pool and every span row (each with finite features)."""
        view = self.require_market()
        span = pool.unlabelled_pool(features, train_index)
        mask = pool.block_mask(train_index, block_bars=int(self.parameters["label_block_bars"]),
                               labeled_fraction=float(self.parameters["labeled_fraction"]),
                               embargo_bars=int(view.horizon), seed=self.seed, features=features)
        finite = np.all(np.isfinite(np.asarray(features[mask.labelled], dtype=np.float64)), axis=1)
        labelled = mask.labelled[finite & np.isfinite(target[mask.labelled])]
        natively_unlabelled = span[~np.isfinite(target[span])]
        hidden = np.union1d(mask.unlabelled, natively_unlabelled).astype(np.int64)
        hidden = hidden[np.isin(hidden, span)]
        blocks = np.asarray(mask.hidden_blocks, dtype=np.int64).reshape(-1, 2)
        return {"labelled": labelled, "hidden": hidden, "all": span, "hidden_blocks": blocks,
                "hidden_block_count": np.array(blocks.shape[0])}

    # ── the fit ──
    def _fit(self, features, labels, train_index, validation_index, timestamps, reporter) -> None:
        import torch

        features = np.asarray(features)
        target = np.asarray(labels, dtype=np.float64)
        span_rows = pool.unlabelled_pool(features, train_index)
        if span_rows.size < MINIMUM_LABELLED_ROWS:
            raise ValueError(f"{self.key}: {span_rows.size} training-span rows with finite features")
        values = np.asarray(features[span_rows], dtype=np.float64)
        self.mean = values.mean(axis=0)
        scale = values.std(axis=0)
        self.scale = np.where(scale > 1e-6, scale, 1.0)
        parts = self.split(features, target, train_index)
        labelled = parts["labelled"]
        if labelled.size < MINIMUM_LABELLED_ROWS:
            raise ValueError(f"{self.key}: {labelled.size} labelled training rows after masking; at least "
                             f"{MINIMUM_LABELLED_ROWS} are needed (raise labeled_fraction or the training span)")
        method_class = VARIANTS[self.variant]
        source = parts["all"] if method_class.unlabelled_source == "all" or parts["hidden"].size == 0 else parts["hidden"]
        usable_validation = validation_index[np.isfinite(target[validation_index])] if validation_index.size else validation_index
        x_validation, finite_validation = self.standardise(features, usable_validation)
        usable_validation, x_validation = usable_validation[finite_validation], x_validation[finite_validation]
        reporter.log(f"{self.key}: {self.variant} on {labelled.size} labelled rows ({parts['hidden_block_count']} of the "
                     f"span's label blocks hidden, labeled fraction {float(self.parameters['labeled_fraction']):.2f}), "
                     f"{source.size} unlabelled-pool rows ({method_class.unlabelled_source}), "
                     f"{usable_validation.size} validation rows for early stopping")
        device = methods.resolve_device(self.device)
        forked = [torch.cuda.current_device()] if device.startswith("cuda") else []
        with torch.random.fork_rng(devices=forked):
            torch.manual_seed(self.seed)
            method = self.new_method(values.shape[1], device)
            method.build()
            method.to(device)
            method.make_optimizers()
            summary = self._train(method, features, target, labelled, source, usable_validation, x_validation,
                                  device, reporter)
        method.to("cpu")
        method.eval_mode()
        self.method = method
        self.network_state = method.cpu_state()
        self.scorer = scoring_copy(method.predictor())
        self.fit_summary = {
            "trained_epochs": summary.get("trained_epochs"), "best_epoch": summary.get("best_epoch"),
            "best_validation_loss": summary.get("best_validation_loss"), "fit_seconds": summary.get("fit_seconds"),
            "labelled_row_count": int(labelled.size), "hidden_row_count": int(parts["hidden"].size),
            "unlabelled_pool_row_count": int(source.size), "unlabelled_source": method_class.unlabelled_source,
            "hidden_block_count": int(parts["hidden_block_count"]),
            **method.diagnostics(),
        }
        if method.diagnostics().get("confident_share") is not None:
            reporter.log(f"{self.key}: {100.0 * method.diagnostics()['confident_share']:.1f}% of the unlabelled rows "
                         "drawn passed the confidence threshold")
        self.best_iteration = summary.get("best_epoch")

    def _train(self, method: methods.Method, features, target, labelled, source, validation_rows, x_validation,
               device, reporter) -> dict:
        import torch

        x_labelled = torch.as_tensor(self.standardise(features, labelled)[0], dtype=torch.float32, device=device)
        y_labelled = torch.as_tensor(target[labelled], dtype=torch.float32, device=device)
        x_source = torch.as_tensor(self.standardise(features, source)[0], dtype=torch.float32, device=device)
        validation_x = torch.as_tensor(x_validation, dtype=torch.float32, device=device)
        validation_target = target[validation_rows]
        order_stream = np.random.default_rng((self.seed, 11))
        unlabelled_stream = np.random.default_rng((self.seed, 12))
        epoch_count = int(self.parameters["epochs"])
        batch_size = max(MINIMUM_BATCH_ROWS, int(self.parameters["batch_size"]))
        batch_count = max(1, int(round(labelled.size / batch_size)))
        ratio = int(self.parameters.get("unlabeled_ratio", 1))
        maximum_weight = float(self.parameters.get("unlabeled_weight", 0.0))
        ramp_epochs = float(self.parameters.get("ramp_epochs", 0))
        ramp_start = float(self.parameters.get("ramp_start_epoch", 0))

        def train_epoch(epoch, report_batch):
            rate = method.set_learning_rate_share(methods.cosine_share(epoch, epoch_count))
            order = order_stream.permutation(labelled.size)
            losses = []
            for batch, chosen in enumerate(np.array_split(order, batch_count), start=1):
                started = time.perf_counter()
                weight = maximum_weight * methods.ramp(method.ramp_shape, (epoch - 1) + (batch - 1) / batch_count,
                                                       ramp_start, ramp_epochs)
                unlabelled_x = None
                if source.size and method.uses_unlabelled:
                    draw = int(ratio * chosen.size)
                    picked = unlabelled_stream.choice(source.size, size=draw, replace=draw > source.size)
                    unlabelled_x = x_source[torch.as_tensor(picked, device=device)]
                chosen_tensor = torch.as_tensor(chosen, device=device)
                loss = method.train_step(x_labelled[chosen_tensor], y_labelled[chosen_tensor], unlabelled_x, weight)
                losses.append(loss)
                rows = labelled[chosen]
                report_batch(batch, batch_count, int(rows.min()), int(rows.max()), loss, learning_rate=rate,
                             samples_per_second=chosen.size / max(time.perf_counter() - started, 1e-9))
            return float(np.mean(losses)) if losses else None

        def validate(epoch):
            method.eval_mode()
            with torch.no_grad():
                output = method.squash(method.output(method.predictor(), validation_x))
            method.train_mode()
            return training.score(self.task, output.detach().to("cpu").numpy().astype(np.float64), validation_target)

        return training.run_epochs(
            reporter, epoch_count=epoch_count, train_index=labelled, train_epoch=train_epoch,
            validate=validate if validation_rows.size else None, snapshot=method.snapshot, restore=method.restore,
            patience=int(self.parameters.get("patience", 0)) or None, step_unit=self.step_unit, name=self.key)

    # ── prediction ──
    def outputs(self, features, index) -> np.ndarray:
        """The predictor's output per row (the logit of P(up), or the price value), float64; NaN when a feature is missing."""
        import torch

        rows = np.asarray(index, dtype=np.int64)
        x, finite = self.standardise(features, rows)
        out = np.full(rows.size, np.nan)
        if finite.any():
            with torch.no_grad():
                values = self.method.output(self.scorer, torch.as_tensor(x[finite], dtype=torch.float64))
            out[finite] = values.numpy().astype(np.float64)
        return out

    def _predict_probability(self, features, index) -> np.ndarray:
        logit = self.outputs(features, index)
        return 1.0 / (1.0 + np.exp(-np.clip(logit, -500.0, 500.0)))

    def _predict_value(self, features, index) -> np.ndarray:
        return self.outputs(features, index)

    # ── save / load ──
    def _save_state(self, folder: Path) -> str:
        persistence.save_arrays(folder / "standardisation.npz", mean=self.mean, scale=self.scale)
        persistence.save_json(folder / "network.json", {
            "variant": self.variant, "settings": self.settings, "feature_count": int(self.mean.shape[0]),
            "predictor": self.method.predictor_name,
        })
        persistence.save_torch(folder / self.model_file, {"modules": self.network_state})
        return self.model_file

    def _load_state(self, folder: Path, metadata: dict) -> None:
        import torch

        document = persistence.load_json(folder / "network.json")
        self.settings = dict(document.get("settings") or {})
        self._reset_state()
        arrays = persistence.load_arrays(folder / "standardisation.npz")
        self.mean, self.scale = arrays["mean"], arrays["scale"]
        method = self.new_method(int(document["feature_count"]), "cpu")
        with torch.random.fork_rng(devices=[]):
            torch.manual_seed(self.seed)
            method.build()
        self.network_state = persistence.load_torch(folder / self.model_file)["modules"]
        method.restore(self.network_state)
        method.eval_mode()
        self.method = method
        self.scorer = scoring_copy(method.predictor())


__all__ = ["SemiSupervisedNetworkAdapter", "VARIANTS", "scoring_copy"]
