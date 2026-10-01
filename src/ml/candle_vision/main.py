"""Train an image model to recognise TA-Lib's 61 candlestick patterns on MNQ 1-minute charts.

Runner ``candle_vision+talib_pattern_recognition`` (launched by the dashboard, streamed live):

  bars      derived_mnq_next_candles_1m, 2021-01-03 .. 2025-06-30 (the 2025 second half is the
            locked holdout), labels recomputed with TA-Lib 0.8.1 inside each contract
  samples   every 20-bar window ending on a bar, drawn as a 3 x 128 x 120 image on the GPU
            (render.py); 88 outputs = (pattern, direction) pairs, multi-label
  split     trading days in time order: 80 % train, 10 % validation, 10 % test
  rare      classes with too few real windows are topped up with synthetic windows built from the
            dashboard's pattern drawings on real contexts, each one confirmed by TA-Lib (synth.py)
  model     --architecture cnn (residual CNN) or vit (vision transformer), model.py
  record    data/models/<id>/ (model.pt, diagnostics.json, gallery/<class>/*.png) and the lake:
            derived_candle_pattern_vision_<table>, recipe = the model id
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import re
import sys
import time
import traceback
from pathlib import Path

import numpy as np
import pandas as pd
import torch

SRC_ML = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SRC_ML))

from candle_vision import bars as bar_source  # noqa: E402
from candle_vision import data, evaluate, synth  # noqa: E402
from candle_vision.labels import class_list  # noqa: E402
from candle_vision.model import build, count_parameters  # noqa: E402
from candle_vision.render import HEIGHT, WINDOW_BARS, normalise, rasterize, to_png  # noqa: E402
from shared.protocol import (  # noqa: E402
    dumps_safe,
    emit,
    emit_config,
    emit_done,
    emit_error,
    emit_log,
    emit_metric,
    emit_metric_declarations,
    emit_progress,
)

MODELS_DIR = SRC_ML.parents[1] / "data" / "models"
DATASET = "candle_pattern_vision"


def parse_args(argv=None):
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--symbol", default="MNQ")
    p.add_argument("--timeframe", default="1m")
    p.add_argument("--model-id", required=True)
    p.add_argument("--json", action="store_true")
    p.add_argument("--architecture", default="cnn", choices=["cnn", "vit"])
    p.add_argument("--epochs", type=int, default=12)
    p.add_argument("--batch-size", type=int, default=512)
    p.add_argument("--learning-rate", type=float, default=1e-3)
    p.add_argument("--samples-per-epoch", type=int, default=300_000)
    p.add_argument("--train-minimum", type=int, default=3000, help="real + synthetic windows per class in train")
    p.add_argument("--evaluation-minimum", type=int, default=300, help="... in validation and in test")
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--no-land", action="store_true")
    args, _unknown = p.parse_known_args(argv)
    return args


def log(message: str) -> None:
    emit_log(message)


def declarations(names: list[str]) -> dict:
    return {
        "train_loss": {"renderer": "time_series", "mission": "Binary cross-entropy on the training draws, per epoch", "context": {}, "group": "training"},
        "val_loss": {"renderer": "time_series", "mission": "Binary cross-entropy on every validation window, per epoch", "context": {}, "group": "training"},
        "validation_macro_average_precision": {"renderer": "percent", "mission": "Average precision per class, averaged over the classes present in validation (100% = every firing ranked above every non-firing)", "context": {"decimals": 1}, "group": "training"},
        "test_real_macro_f1": {"renderer": "percent", "mission": "F1 per class on REAL test bars (validation-chosen thresholds), averaged over classes with at least 10 real test firings", "context": {"decimals": 1}, "group": "evaluation"},
        "test_real_macro_average_precision": {"renderer": "percent", "mission": "Average precision per class on real test bars", "context": {"decimals": 1}, "group": "evaluation"},
        "test_synthetic_macro_f1": {"renderer": "percent", "mission": "F1 per class on synthetic test windows (TA-Lib-confirmed), the only test for the rarest patterns", "context": {"decimals": 1}, "group": "evaluation"},
        "test_classes": {"renderer": "table", "mission": "Every class on the test split: real and synthetic windows, precision, recall, F1, AUROC, AP", "context": {}, "group": "evaluation"},
        "pattern_confusion": {"renderer": "confusion_matrix", "mission": "Real test bars: rows = pattern TA-Lib fired, columns = pattern the model called (percent of the row's bars)", "context": {"labels": names}, "group": "evaluation"},
        "samples": {"renderer": "table", "mission": "Windows per class, split and source", "context": {}, "group": "data"},
    }


def png_base64(image: torch.Tensor) -> str:
    buffer = io.BytesIO()
    to_png(image, buffer, zoom=2)
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def predict(model, windows: torch.Tensor, batch: int = 2048) -> np.ndarray:
    model.eval()
    out = []
    with torch.no_grad(), torch.autocast("cuda", dtype=torch.bfloat16):
        for start in range(0, len(windows), batch):
            images = rasterize(windows[start:start + batch]).contiguous(memory_format=torch.channels_last)
            out.append(torch.sigmoid(model(images).float()).cpu())
    return torch.cat(out).numpy()


def main(argv=None) -> int:
    args = parse_args(argv)
    started = time.time()
    torch.manual_seed(args.seed); np.random.seed(args.seed)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    classes = class_list()
    names = [c[0] for c in classes]
    emit_config({"model": {"architecture": args.architecture, "outputs": len(classes), "image": [3, HEIGHT, WINDOW_BARS * 6]},
                 "data": {"source": "derived_mnq_next_candles_1m", "end_exclusive": bar_source.HOLDOUT_START, "window_bars": WINDOW_BARS},
                 "run": vars(args)}, scope="run", label=args.model_id)
    try:
        out_dir = MODELS_DIR / args.model_id
        out_dir.mkdir(parents=True, exist_ok=True)
        emit_progress(0, 1, phase="loading bars")
        frame = bar_source.load()
        values, agreement = data.recompute_labels(frame)
        unseen = data.unseen_directions(values)
        if unseen:
            raise RuntimeError(f"TA-Lib fired directions the class list does not name: {unseen}")
        disagreeing = int(agreement["disagreeing_bars"].sum())
        log(f"{len(frame):,} bars {frame['timestamp'].min()} .. {frame['timestamp'].max()}; TA-Lib 0.8.1 vs the lake's 0.7.1: {disagreeing} disagreeing bar-patterns")
        split, spans = data.split_by_day(frame)
        real = data.real_samples(frame, values, split)
        del frame
        real_counts = np.stack([real.labels[real.split == s].sum(0) for s in range(3)])
        quotas = {}
        for s in range(3):
            floor = args.train_minimum if s == 0 else args.evaluation_minimum
            for k in range(len(classes)):
                quotas[(s, k)] = max(0, floor - int(real_counts[s, k]))
        emit_progress(0, 1, phase="synthesising rare patterns")
        synthetic, synth_report = synth.generate(real, quotas, seed=args.seed, log=log)
        samples = data.concatenate([real, synthetic])
        log(f"windows: {len(real.windows):,} real + {len(synthetic.windows):,} synthetic")

        windows = torch.from_numpy(normalise(samples.windows)).to(device)
        labels = torch.from_numpy(samples.labels).to(device)
        split_t = torch.from_numpy(samples.split.astype(np.int64)).to(device)
        train_index = torch.nonzero(split_t == 0).squeeze(1)
        validation_index = torch.nonzero(split_t == 1).squeeze(1)
        test_index = torch.nonzero(split_t == 2).squeeze(1)

        train_labels = labels[train_index].float()
        frequency = train_labels.sum(0).clamp_min(1)
        none_count = (train_labels.sum(1) == 0).sum().clamp_min(1)
        weight_per_class = frequency.pow(-0.5)
        draw_weight = (train_labels * weight_per_class).amax(1)
        draw_weight = torch.where(train_labels.sum(1) == 0, none_count.float().pow(-0.5), draw_weight)

        model = build(args.architecture, len(classes)).to(device).to(memory_format=torch.channels_last)
        parameters = count_parameters(model)
        log(f"{args.architecture}: {parameters:,} parameters")
        steps_per_epoch = max(1, args.samples_per_epoch // args.batch_size)
        optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate, weight_decay=0.05)
        scheduler = torch.optim.lr_scheduler.OneCycleLR(optimizer, max_lr=args.learning_rate, total_steps=args.epochs * steps_per_epoch, pct_start=0.1)
        loss_fn = torch.nn.BCEWithLogitsLoss()
        emit_metric_declarations(declarations(sorted({n.split(':')[0] for n in names})))

        validation_labels = samples.labels[samples.split == 1]
        best = (-1.0, None, 0)
        epochs = []
        for epoch in range(args.epochs):
            model.train()
            draws = train_index[torch.multinomial(draw_weight, steps_per_epoch * args.batch_size, replacement=True)]
            total = 0.0
            for step in range(steps_per_epoch):
                batch = draws[step * args.batch_size:(step + 1) * args.batch_size]
                with torch.autocast("cuda", dtype=torch.bfloat16):
                    images = rasterize(windows[batch]).contiguous(memory_format=torch.channels_last)
                    loss = loss_fn(model(images).float(), labels[batch].float())
                optimizer.zero_grad(set_to_none=True)
                loss.backward()
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                optimizer.step(); scheduler.step()
                total += float(loss)
                if step % 50 == 0:
                    emit_progress(epoch * steps_per_epoch + step, args.epochs * steps_per_epoch, phase="training")
            train_loss = total / steps_per_epoch
            scores = predict(model, windows[validation_index])
            clipped = np.clip(scores, 1e-6, 1 - 1e-6)
            val_loss = float(-(validation_labels * np.log(clipped) + (1 - validation_labels) * np.log(1 - clipped)).mean())
            macro_ap = evaluate.macro_average_precision(scores, validation_labels)
            emit({"type": "epoch_metric", "iteration": epoch + 1, "total": args.epochs, "train_loss": train_loss, "val_loss": val_loss,
                  "validation_macro_average_precision": macro_ap})
            emit_metric("validation_macro_average_precision", macro_ap, epoch + 1, args.epochs)
            epochs.append({"epoch": epoch + 1, "train_loss": train_loss, "validation_loss": val_loss,
                           "validation_macro_average_precision": macro_ap, "learning_rate": scheduler.get_last_lr()[0],
                           "elapsed_seconds": time.time() - started})
            log(f"epoch {epoch + 1}/{args.epochs}: train loss {train_loss:.5f}, validation loss {val_loss:.5f}, validation macro AP {macro_ap:.4f}")
            if macro_ap > best[0]:
                best = (macro_ap, {k: v.detach().clone() for k, v in model.state_dict().items()}, epoch + 1)
        model.load_state_dict(best[1])
        torch.save({"state_dict": best[1], "architecture": args.architecture, "classes": names, "height": HEIGHT,
                    "window_bars": WINDOW_BARS}, out_dir / "model.pt")

        emit_progress(0, 1, phase="testing")
        validation_scores = predict(model, windows[validation_index])
        thresholds = evaluate.best_thresholds(validation_scores, validation_labels)
        test_scores = predict(model, windows[test_index])
        test_mask = samples.split == 2
        test_labels = samples.labels[test_mask]
        test_synthetic = samples.synthetic[test_mask]
        tables = []
        for source, rows in (("real", ~test_synthetic), ("synthetic", test_synthetic), ("all", np.ones_like(test_synthetic))):
            tables.append(evaluate.class_table(test_scores[rows], test_labels[rows], thresholds, names, "test", source))
        validation_synthetic = samples.synthetic[samples.split == 1]
        tables.append(evaluate.class_table(validation_scores[~validation_synthetic], validation_labels[~validation_synthetic], thresholds, names, "validation", "real"))
        class_metrics = pd.concat(tables, ignore_index=True)
        real_rows = class_metrics[(class_metrics["source"] == "real") & (class_metrics["split"] == "test")]
        measurable = real_rows[real_rows["positives"] >= 10]
        synthetic_rows = class_metrics[(class_metrics["source"] == "synthetic") & (class_metrics["positives"] > 0)]
        headline = {
            "test_real_macro_f1": float(measurable["f1"].mean()),
            "test_real_macro_average_precision": float(measurable["average_precision"].mean()),
            "test_synthetic_macro_f1": float(synthetic_rows["f1"].mean()),
            "classes_measurable_on_real_test": int(len(measurable)),
            "best_epoch": best[2],
        }
        log(f"test: real macro F1 {headline['test_real_macro_f1']:.4f} over {len(measurable)} classes, "
            f"real macro AP {headline['test_real_macro_average_precision']:.4f}, synthetic macro F1 {headline['test_synthetic_macro_f1']:.4f}")
        confusion = evaluate.pattern_confusion(test_scores[~test_synthetic], test_labels[~test_synthetic], thresholds, classes)

        # samples per class / split / source
        sample_rows = []
        for s, split_name in enumerate(data.SPLITS):
            for source, flag in (("real", False), ("synthetic", True)):
                mask = (samples.split == s) & (samples.synthetic == flag)
                counts = samples.labels[mask].sum(0)
                for k, name in enumerate(names):
                    sample_rows.append({"class_name": name, "split": split_name, "source": source, "windows": int(counts[k])})
        sample_table = pd.DataFrame(sample_rows)

        # exemplars and a picture gallery: the model's own input images
        emit_progress(0, 1, phase="drawing exemplars")
        test_positions = torch.nonzero(split_t == 2).squeeze(1).cpu().numpy()
        predicted = test_scores >= thresholds[None]
        exemplar_rows = []
        rng = np.random.default_rng(args.seed)
        for k, name in enumerate(names):
            y = test_labels[:, k].astype(bool)
            groups = {
                "real hit": np.flatnonzero(y & predicted[:, k] & ~test_synthetic),
                "real miss": np.flatnonzero(y & ~predicted[:, k] & ~test_synthetic),
                "real false alarm": np.flatnonzero(~y & predicted[:, k] & ~test_synthetic),
                "synthetic hit": np.flatnonzero(y & predicted[:, k] & test_synthetic),
            }
            folder = out_dir / "gallery" / name.replace(":", "_")
            folder.mkdir(parents=True, exist_ok=True)
            for kind, rows in groups.items():
                take = rng.choice(rows, min(len(rows), 4 if kind == "real hit" else 2), replace=False) if len(rows) else []
                for n, r in enumerate(take):
                    position = int(test_positions[r])
                    image = rasterize(windows[position:position + 1])[0]
                    to_png(image, str(folder / f"{kind.replace(' ', '_')}_{n}.png"), zoom=3)
                    exemplar_rows.append({
                        "class_name": name, "kind": kind, "score": float(test_scores[r, k]), "threshold": float(thresholds[k]),
                        "bar_timestamp": samples.end_timestamp[position] if not samples.synthetic[position] else pd.NaT,
                        "talib_classes": ", ".join(names[j] for j in np.flatnonzero(test_labels[r])),
                        "model_classes": ", ".join(names[j] for j in np.flatnonzero(predicted[r])),
                        "window_unit_ohlc_json": json.dumps(np.round(windows[position].cpu().numpy(), 5).tolist()),
                        "model_input_png_base64": png_base64(image),
                    })
        exemplars = pd.DataFrame(exemplar_rows)

        run = pd.DataFrame([{
            "model_id": args.model_id, "recipe_name": re.sub(r"[^A-Za-z0-9_.\-]", "_", args.model_id), "architecture": args.architecture, "parameters": parameters,
            "epochs": args.epochs, "best_epoch": best[2], "batch_size": args.batch_size, "learning_rate": args.learning_rate,
            "samples_per_epoch": args.samples_per_epoch, "train_minimum": args.train_minimum, "evaluation_minimum": args.evaluation_minimum,
            "real_windows": len(real.windows), "synthetic_windows": len(synthetic.windows), "classes": len(names),
            "talib_disagreeing_bar_patterns": disagreeing, "duration_seconds": time.time() - started, **headline,
        }])
        splits = pd.DataFrame(spans)
        synth_table = pd.DataFrame(synth_report)
        if len(synth_table):
            synth_table["split"] = synth_table.pop("split_index").map(dict(enumerate(data.SPLITS)))
        lake_tables = {"runs": run, "class_metrics": class_metrics, "epochs": pd.DataFrame(epochs), "samples": sample_table,
                       "pattern_confusion": confusion, "exemplars": exemplars, "splits": splits,
                       "label_agreement": agreement, "synthetic_generation": synth_table}

        pattern_names = sorted({n.split(":")[0] for n in names})
        matrix = np.zeros((len(pattern_names), len(pattern_names)))
        position_of = {p: i for i, p in enumerate(pattern_names)}
        for row in confusion.itertuples():
            matrix[position_of[row.true_pattern], position_of[row.called_pattern]] = round(row.model_share_percent, 2)
        test_table = class_metrics[class_metrics["split"] == "test"].pivot_table(
            index="class_name", columns="source", values=["positives", "f1", "average_precision"], aggfunc="first")
        test_table.columns = [f"{a}_{b}" for a, b in test_table.columns]
        diagnostics = {
            "model_type": "candle_vision+talib_pattern_recognition", "symbol": args.symbol, "timeframe": args.timeframe,
            "quality_score": headline["test_real_macro_f1"],
            "metrics": {
                **{k: {**declarations(pattern_names)[k], "value": headline[k]} for k in ("test_real_macro_f1", "test_real_macro_average_precision", "test_synthetic_macro_f1")},
                "test_classes": {**declarations(pattern_names)["test_classes"], "value": test_table.reset_index().round(4).to_dict("records")},
                "pattern_confusion": {**declarations(pattern_names)["pattern_confusion"], "value": matrix.tolist()},
                "samples": {**declarations(pattern_names)["samples"], "value": sample_table.pivot_table(index="class_name", columns=["split", "source"], values="windows").pipe(lambda t: t.set_axis([f"{a}_{b}" for a, b in t.columns], axis=1)).reset_index().to_dict("records")},
            },
            "training": {"duration_sec": time.time() - started, "trained_at": pd.Timestamp.now(tz="UTC").isoformat(), "epochs": args.epochs, "best_epoch": best[2]},
            "convergence": {"epochs": [e["epoch"] for e in epochs], "train_loss": [e["train_loss"] for e in epochs], "val_loss": [e["validation_loss"] for e in epochs]},
        }
        (out_dir / "diagnostics.json").write_text(dumps_safe(diagnostics, indent=2), encoding="utf-8")

        # the tables are kept beside the model whatever happens to the landing
        table_dir = out_dir / "lake_tables"
        table_dir.mkdir(exist_ok=True)
        paths = {}
        for name, table in lake_tables.items():
            paths[name] = str(table_dir / f"{name}.parquet")
            table.to_parquet(paths[name], index=False)
        if not args.no_land:
            from ta_strategy.store import land
            recipe = re.sub(r"[^A-Za-z0-9_.\-]", "_", args.model_id)  # '+' in an S3 key reads back as a space
            for attempt in range(5):
                try:
                    result = land(paths, recipe, f"src/ml/candle_vision/main.py --architecture {args.architecture}", dataset=DATASET)
                    break
                except Exception as exc:  # noqa: BLE001 — the object server drops connections under load
                    if attempt == 4:
                        raise
                    log(f"landing attempt {attempt + 1} failed ({exc}); retrying")
                    time.sleep(10 * 2 ** attempt)
            log("landed " + ", ".join(f"{k} {v['rows']:,}" for k, v in result.items()))
        emit_done(str(out_dir), {"quality_score": headline["test_real_macro_f1"], **headline})
        return 0
    except Exception as exc:  # noqa: BLE001 — reported through the protocol, then re-raised
        emit_error(str(exc), traceback.format_exc())
        raise


if __name__ == "__main__":
    raise SystemExit(main())
