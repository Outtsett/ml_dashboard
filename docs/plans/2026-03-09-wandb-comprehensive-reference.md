# Weights & Biases (wandb) Comprehensive Reference

> Complete SDK, API, CLI, and integration reference. Current as of wandb SDK 0.25.x (2025-2026).

---

## Table of Contents

1. [Core Tracking](#1-core-tracking)
2. [Config Management](#2-config-management)
3. [Artifacts](#3-artifacts)
4. [Tables](#4-tables)
5. [Alerts](#5-alerts)
6. [Media Logging](#6-media-logging)
7. [System Metrics](#7-system-metrics)
8. [Run Management](#8-run-management)
9. [Sweeps](#9-sweeps)
10. [Reports & Workspaces](#10-reports--workspaces)
11. [Public API Client](#11-public-api-client)
12. [CLI Commands](#12-cli-commands)
13. [Integrations](#13-integrations)
14. [Best Practices](#14-best-practices)

---

## 1. Core Tracking

### wandb.init()

Spawns a background process to log data. Returns a `Run` object.

```python
run = wandb.init(
    entity=None,              # str | None - username or team name
    project=None,             # str | None - project name (default: "uncategorized")
    dir=None,                 # str | None - absolute path for logs (default: ./wandb)
    id=None,                  # str | None - unique run ID for resuming
    name=None,                # str | None - short display name in UI
    notes=None,               # str | None - longer description (like git commit message)
    tags=None,                # Sequence[str] | None - labels for organizing/filtering
    config=None,              # dict | str | None - hyperparameters (dict, Namespace, or YAML path)
    config_exclude_keys=None, # list[str] | None - keys to exclude from config
    config_include_keys=None, # list[str] | None - keys to include in config
    allow_val_change=None,    # bool | None - allow config mutation after init
    group=None,               # str | None - group name for related runs
    job_type=None,            # str | None - run type: "train", "eval", "preprocess"
    mode=None,                # "online" | "offline" | "disabled" | "shared" | None
    force=None,               # bool | None - require login (True) or proceed offline (False)
    reinit=None,              # bool | "default" | "return_previous" | "finish_previous" | "create_new"
    resume=None,              # bool | "allow" | "never" | "must" | "auto" | None
    resume_from=None,         # str | None - "{run_id}?_step={step}"
    fork_from=None,           # str | None - "{run_id}?_step={step}"
    save_code=None,           # bool | None - save main script for reproducibility
    sync_tensorboard=None,    # bool | None - auto-sync TensorBoard logs
    monitor_gym=None,         # bool | None - auto-log OpenAI Gym videos
    settings=None,            # Settings | dict | None - advanced configuration
)
```

**Context manager pattern (preferred):**
```python
with wandb.init(project="my-project", config={"lr": 0.001}) as run:
    for epoch in range(100):
        loss = train_one_epoch()
        run.log({"loss": loss, "epoch": epoch})
# wandb.finish() called automatically on exit
```

**Mode options:**
| Mode | Behavior |
|------|----------|
| `"online"` | Default. Syncs to wandb.ai in real-time |
| `"offline"` | Saves locally in ./wandb, sync later with `wandb sync` |
| `"disabled"` | No-op. All wandb calls become pass-through |
| `"shared"` | Multi-process shared mode |

### wandb.log()

Logs metrics, media, and custom objects to the current run step.

```python
run.log(
    data,          # dict[str, Any] - key-value pairs to log
    step=None,     # int | None - explicit step index (auto-increments by default)
    commit=None,   # bool | None - True (default): increment step. False: accumulate to same step
    sync=None,     # bool | None - sync behavior
)
```

**Key behaviors:**
- Each call with `commit=True` (default) advances the step counter
- Metric names must match pattern: `/^[_a-zA-Z][_a-zA-Z0-9]*$/`
- Cannot write to past steps -- W&B only writes to "current" and "next" step
- Multiple `wandb.log()` calls with `commit=False` accumulate to the same step

```python
# Basic metrics
run.log({"train/loss": 0.5, "train/accuracy": 0.92})

# Multiple calls to same step
run.log({"train/loss": 0.5}, commit=False)
run.log({"val/loss": 0.6})  # commit=True flushes both

# Explicit step
run.log({"loss": 0.5}, step=42)
```

### wandb.finish()

Uploads remaining data, marks run complete.

```python
wandb.finish(
    exit_code=None,  # int | None - 0=success, non-zero=failed
    quiet=None,      # bool | None - DEPRECATED, use wandb.Settings(quiet=...)
)
```

**Run states after finish:**
| State | Condition |
|-------|-----------|
| `Finished` | exit_code=0 and data synced |
| `Failed` | Non-zero exit_code |
| `Crashed` | Heartbeats stopped unexpectedly |
| `Running` | Still active |

### wandb.define_metric()

Customize x-axis and summary behavior for metrics.

```python
run.define_metric(
    name,               # str - metric name (supports glob patterns like "train/*")
    step_metric=None,   # str - which metric to use as x-axis
    summary=None,       # str - aggregation: "min", "max", "mean", "last", "first", "none"
    goal=None,          # str - "minimize" or "maximize" (used with summary="best", now deprecated)
)
```

**Summary options:**
| Value | Behavior |
|-------|----------|
| `"min"` | Store minimum value in summary |
| `"max"` | Store maximum value in summary |
| `"mean"` | Store average across all logged values |
| `"last"` | Store final value (default behavior) |
| `"first"` | Store initial value |
| `"none"` | No summary generated |
| `"best"` | DEPRECATED -- use "min" or "max" |
| `"copy"` | DEPRECATED |

```python
# Custom x-axis for validation metrics
run.define_metric("val/*", step_metric="epoch")

# Track best loss in summary
run.define_metric("val/loss", summary="min")
run.define_metric("val/accuracy", summary="max")

# Log with custom step
run.log({"epoch": 5, "val/loss": 0.3, "val/accuracy": 0.95})
```

### wandb.watch()

Hooks into PyTorch models to log gradients and parameters.

```python
run.watch(
    models,           # nn.Module or list[nn.Module]
    log="gradients",  # "gradients" | "parameters" | "all"
    log_freq=1000,    # int - log every N steps
    log_graph=False,  # bool - log computational graph
)
```

```python
model = MyModel()
run.watch(model, log="all", log_freq=100, log_graph=True)
# Gradients and parameter histograms appear in UI automatically
```

---

## 2. Config Management

### wandb.config

Stores hyperparameters and input settings. Dictionary-like object on the Run.

**Setting config at init:**
```python
config = {
    "hidden_layer_sizes": [32, 64],
    "activation": "ReLU",
    "dropout": 0.5,
    "learning_rate": 1e-3,
    "batch_size": 32,
    "epochs": 100,
}
run = wandb.init(project="my-project", config=config)
```

**From argparse:**
```python
parser = argparse.ArgumentParser()
parser.add_argument("-b", "--batch_size", type=int, default=32)
parser.add_argument("-lr", "--learning_rate", type=float, default=0.001)
args = parser.parse_args()

run = wandb.init(config=args)
lr = run.config["learning_rate"]
```

**Update after init:**
```python
run.config["dropout"] = 0.2
run.config.epochs = 4
run.config.update({"lr": 0.1, "channels": 16})
```

**From YAML file (config-defaults.yaml):**
```yaml
# config-defaults.yaml
batch_size:
  desc: Size of each mini-batch
  value: 32
learning_rate:
  desc: Learning rate for optimizer
  value: 0.001
epochs:
  desc: Number of training epochs
  value: 100
```

Auto-loaded by wandb. Override with:
```python
run = wandb.init(config={"epochs": 200, "batch_size": 64})
# or CLI: python train.py --configs other-config.yaml
```

**From absl FLAGS:**
```python
run.config.update(flags.FLAGS)
```

**Update after run completes (via API):**
```python
api = wandb.Api()
api_run = api.run(f"{entity}/{project}/{run_id}")
api_run.config["new_param"] = 42
api_run.update()
```

**Naming rules:**
- Avoid dots in config keys -- use dashes or underscores
- For nested config access, use `["key"]` syntax, not `.key`

**Config vs Log:**
- `wandb.config` = inputs / independent variables (hyperparameters, dataset name, model type)
- `wandb.log()` = outputs / dependent variables (loss, accuracy, metrics)

---

## 3. Artifacts

### wandb.Artifact

Versioned bundles of files + metadata. Used for datasets, models, and pipeline outputs.

**Constructor:**
```python
artifact = wandb.Artifact(
    name="my-dataset",     # str - artifact name
    type="dataset",        # str - "dataset", "model", or custom. Affects UI grouping
    description=None,      # str | None - human-readable description
    metadata=None,         # dict | None - arbitrary key-value metadata
    incremental=False,     # bool - allow incremental updates
)
```

**Common types:** `"dataset"`, `"model"`, `"preprocessed_data"`, `"raw_data"`, `"balanced_data"`

### Adding Content

```python
# Single file
artifact.add_file(local_path="./model.pt", name="model")

# Directory
artifact.add_dir(local_path="./data/", name="training_data")

# External reference (S3, GCS, etc.) -- no data copied
artifact.add_reference(uri="s3://my-bucket/data/", name="external_data")
```

### Logging Artifacts

```python
# As run output
run.log_artifact(artifact, aliases=["latest", "best"])

# Within context manager
with wandb.init(project="my-project", job_type="data-prep") as run:
    artifact = wandb.Artifact("processed-data", type="dataset")
    artifact.add_dir("./processed/")
    run.log_artifact(artifact)
```

### Using/Downloading Artifacts

```python
# Mark as input to a run (creates lineage edge)
artifact = run.use_artifact("my-dataset:latest")

# Download contents
data_dir = artifact.download()                    # default: ./artifacts/
data_dir = artifact.download(root="./my_data/")   # custom directory

# Get specific file
entry = artifact.get_path("model.pt")
entry.download()          # download just this file
entry.ref()               # get URI if stored as reference
```

### Versioning

W&B auto-versions artifacts. Logging the same name creates a new version:
- `my-dataset:v0`, `my-dataset:v1`, `my-dataset:v2`, etc.
- Aliases like `latest`, `best`, `production` point to specific versions

```python
# Update metadata and aliases on existing artifact
artifact.metadata["accuracy"] = 0.95
artifact.aliases.append("production")
artifact.save()
```

### Artifact Lineage

Every `run.log_artifact()` and `run.use_artifact()` call creates edges in a DAG:
```
dataset:v0 --> training_run --> model:v0
                                  |
model:v0 --> eval_run ----------> eval_table:v0
```

View the graph in UI: Artifacts tab --> Graph view

### Pipeline Pattern

```python
# Step 1: Data preparation
with wandb.init(project="pipeline", job_type="data-prep") as run:
    raw = run.use_artifact("raw-data:latest")
    raw_dir = raw.download()
    # ... process data ...
    processed = wandb.Artifact("processed-data", type="dataset")
    processed.add_dir("./processed/")
    run.log_artifact(processed)

# Step 2: Training
with wandb.init(project="pipeline", job_type="train") as run:
    data = run.use_artifact("processed-data:latest")
    data_dir = data.download()
    # ... train model ...
    model_art = wandb.Artifact("trained-model", type="model")
    model_art.add_file("./model.pt")
    run.log_artifact(model_art, aliases=["latest", "best"])

# Step 3: Evaluation
with wandb.init(project="pipeline", job_type="eval") as run:
    model = run.use_artifact("trained-model:best")
    data = run.use_artifact("processed-data:latest")
    # ... evaluate ...
    results = wandb.Artifact("eval-results", type="results")
    results.add_file("./metrics.json")
    run.log_artifact(results)
```

---

## 4. Tables

### wandb.Table

Two-dimensional grid of typed columns. Supports primitives, nested structures, and rich media.

**Constructor:**
```python
table = wandb.Table(
    columns=None,          # list[str] | None - column names
    data=None,             # list[list] | None - 2D list of values
    dataframe=None,        # pd.DataFrame | None - create from DataFrame
    dtype=None,            # list | None - column types
    optional=True,         # bool - allow None values
    allow_mixed_types=False, # bool - allow mixed types in columns
)
```

**Row limit:** 200,000 rows (override with `wandb.Table.MAX_ARTIFACT_ROWS`)

### Creating Tables

```python
# From lists
table = wandb.Table(
    columns=["epoch", "loss", "accuracy"],
    data=[[1, 0.5, 0.8], [2, 0.3, 0.9], [3, 0.1, 0.95]]
)

# From DataFrame
import pandas as pd
df = pd.DataFrame({"a": [1, 2], "b": [3, 4]})
table = wandb.Table(dataframe=df)

# Incremental construction
table = wandb.Table(columns=["text", "predicted", "actual"])
table.add_data("I love this", 1, 1)
table.add_data("Terrible product", 0, 0)
```

### Table Methods

```python
# Add a column
table.add_column(name="confidence", data=[0.95, 0.88])

# Iterate rows
for idx, row in table.iterrows():
    print(f"Row {idx}: {row}")

# Get column as list or numpy array
col_data = table.get_column("loss")
col_numpy = table.get_column("loss", convert_to="numpy")
```

### Logging Tables

```python
# To run workspace
run.log({"predictions": table})

# To artifact (for versioning and comparison)
artifact = wandb.Artifact("eval-results", type="dataset")
artifact.add(table, "predictions")
run.log_artifact(artifact)
```

### Joining Tables

```python
# Join two tables on a shared key
joined = wandb.JoinedTable(table_1, table_2, join_key="id")
run.log({"joined_results": joined})
```

### Tables with Media

```python
table = wandb.Table(columns=["image", "label", "prediction"])
for img, label, pred in zip(images, labels, predictions):
    table.add_data(
        wandb.Image(img),
        label,
        pred
    )
run.log({"sample_predictions": table})
```

---

## 5. Alerts

### wandb.alert()

Send Slack or email notifications from your training script.

**Setup:**
1. Go to https://wandb.ai/settings --> Alerts section
2. Toggle "Scriptable run alerts" on
3. Connect Slack channel (Slackbot recommended for privacy)
4. Confirm email address

**Function:**
```python
run.alert(
    title="Alert Title",              # str - alert headline
    text="Alert body message",        # str - detailed message
    level=wandb.AlertLevel.WARN,      # AlertLevel - severity level
    wait_duration=300,                # int - minimum seconds between repeated alerts
)
```

**Alert levels:** `wandb.AlertLevel.INFO`, `wandb.AlertLevel.WARN`, `wandb.AlertLevel.ERROR`

**Examples:**
```python
# Training anomaly
if loss != loss:  # NaN check
    run.alert(
        title="Training Diverged",
        text=f"Loss is NaN at step {step}",
        level=wandb.AlertLevel.ERROR,
    )

# Milestone notification
if val_accuracy > 0.95:
    run.alert(
        title="High Accuracy Achieved",
        text=f"Val accuracy: {val_accuracy:.4f} at epoch {epoch}",
        level=wandb.AlertLevel.INFO,
        wait_duration=600,  # Don't spam -- wait 10 min between alerts
    )

# Pipeline completion
run.alert(
    title="Training Complete",
    text=f"Model trained for {epochs} epochs. Final loss: {final_loss:.4f}",
    level=wandb.AlertLevel.INFO,
)

# Tag colleagues in Slack
run.alert(
    title="Review Needed",
    text="Model checkpoint ready for review <@U1234ABCD>",
    level=wandb.AlertLevel.WARN,
)
```

---

## 6. Media Logging

### wandb.Image

```python
wandb.Image(
    data_or_path,     # np.array | PIL.Image | str (file path) | torch.Tensor
    mode=None,        # str | None - PIL image mode
    caption=None,     # str | None - image caption
    grouping=None,    # int | None - group images together
    classes=None,     # Classes | None - class label set
    boxes=None,       # dict | None - bounding box overlays
    masks=None,       # dict | None - segmentation mask overlays
    file_type=None,   # str | None - output format
)
```

```python
# Basic image
run.log({"example": wandb.Image(numpy_array, caption="Sample output")})

# From PIL
from PIL import Image
img = Image.fromarray(array)
run.log({"pil_image": wandb.Image(img)})

# From file path
run.log({"photo": wandb.Image("path/to/image.jpg")})

# Batch of images
images = [wandb.Image(img, caption=f"Sample {i}") for i, img in enumerate(batch)]
run.log({"examples": images})

# With segmentation masks
mask_img = wandb.Image(
    image_array,
    masks={
        "predictions": {
            "mask_data": prediction_mask,  # 2D numpy array of int class IDs
            "class_labels": {0: "background", 1: "car", 2: "person"},
        }
    }
)
run.log({"segmentation": mask_img})

# With bounding boxes
box_img = wandb.Image(
    image_array,
    boxes={
        "predictions": {
            "box_data": [
                {
                    "position": {"minX": 0.1, "maxX": 0.5, "minY": 0.2, "maxY": 0.8},
                    "class_id": 1,
                    "box_caption": "car (0.95)",
                    "scores": {"confidence": 0.95},
                }
            ],
            "class_labels": {0: "background", 1: "car", 2: "person"},
        }
    }
)
run.log({"detections": box_img})
```

### wandb.Video

```python
wandb.Video(
    data_or_path,    # str | np.array | BytesIO
    fps=4,           # int - frames per second
    format="gif",    # str - "gif", "mp4", "webm", "ogg"
)
```

```python
run.log({"video": wandb.Video("output.mp4")})
# NumPy: shape (time, channels, height, width)
run.log({"generated": wandb.Video(np_array, fps=30, format="mp4")})
```

### wandb.Audio

```python
wandb.Audio(
    data_or_path,       # np.array | str
    caption=None,       # str | None
    sample_rate=None,   # int | None
)
```

```python
run.log({"audio": wandb.Audio(np_array, caption="Prediction", sample_rate=44100)})
# Max 100 audio clips per step
```

### wandb.Histogram

```python
wandb.Histogram(
    data_or_histogram,  # list | np.array | tuple from np.histogram()
    num_bins=64,        # int - number of bins (max 512)
)
```

```python
# From raw data
run.log({"weight_distribution": wandb.Histogram(model_weights)})

# From np.histogram (for custom binning)
hist = np.histogram(gradients, bins=100, density=True, range=(-1.0, 1.0))
run.log({"gradient_dist": wandb.Histogram(hist)})
```

### wandb.Html

```python
wandb.Html(
    data,           # str | file object - HTML content
    inject=True,    # bool - inject default W&B styles
)
```

```python
run.log({"report": wandb.Html("<h1>Results</h1><p>Loss: 0.05</p>")})
run.log({"dashboard": wandb.Html(open("report.html"), inject=False)})
```

### wandb.Object3D (Point Clouds)

```python
# From numpy: nx3 (xyz), nx4 (xyz+category), nx6 (xyz+RGB)
run.log({"point_cloud": wandb.Object3D(points_array)})

# With bounding boxes
run.log({"lidar": wandb.Object3D.from_point_cloud(
    points=point_list,
    boxes=[{
        "corners": [[x1,y1,z1], ...],  # 8 corners
        "color": [0, 0, 255],
        "label": "car",
        "score": 0.6,
    }],
    vectors=[{"start": [0,0,0], "end": [1,0,0], "color": [255,0,0]}],
    point_cloud_type="lidar/beta",
)})

# From file
run.log({"scene": wandb.Object3D.from_file("scene.pts.json")})
```

### wandb.Molecule

```python
# From file (pdb, pqr, mmcif, cif, sdf, gro, mol2, mmtf)
run.log({"protein": wandb.Molecule("structure.pdb")})

# From RDKit
run.log({"compound": wandb.Molecule.from_rdkit(mol_object)})
run.log({"compound": wandb.Molecule.from_rdkit("molecule.mol")})

# From SMILES string
run.log({"drug": wandb.Molecule.from_smiles("CC(=O)Nc1ccc(O)cc1")})
```

### wandb.Plotly

```python
import plotly.graph_objects as go

fig = go.Figure(data=[go.Scatter(x=[1,2,3], y=[4,5,6])])
run.log({"plotly_chart": wandb.Plotly(fig)})

# Also works: just pass plotly figures directly
run.log({"chart": fig})  # auto-detected
```

### Built-in Plot Presets

```python
# Line plot
table = wandb.Table(data=[[x, y] for x, y in zip(xs, ys)], columns=["x", "y"])
run.log({"line": wandb.plot.line(table, "x", "y", title="Loss Curve")})

# Multi-line
run.log({"lines": wandb.plot.line_series(
    xs=[0, 1, 2, 3],
    ys=[[1, 2, 3, 4], [4, 3, 2, 1]],
    keys=["train", "val"],
    title="Loss Comparison",
    xname="epoch",
)})

# Scatter
table = wandb.Table(data=data, columns=["x", "y"])
run.log({"scatter": wandb.plot.scatter(table, "x", "y")})

# Bar chart
table = wandb.Table(data=[["A", 10], ["B", 20]], columns=["label", "value"])
run.log({"bar": wandb.plot.bar(table, "label", "value", title="Metrics")})

# Histogram
table = wandb.Table(data=[[s] for s in scores], columns=["score"])
run.log({"hist": wandb.plot.histogram(table, "score", title="Score Distribution")})

# PR Curve
run.log({"pr": wandb.plot.pr_curve(
    y_true,          # ground truth labels
    y_probas,        # predicted probabilities
    labels=["cat", "dog", "bird"],  # optional class names
)})

# ROC Curve
run.log({"roc": wandb.plot.roc_curve(
    y_true,
    y_probas,
    labels=["cat", "dog", "bird"],
)})

# Confusion Matrix
run.log({"conf_mat": wandb.plot.confusion_matrix(
    y_true=ground_truth,
    preds=predictions,        # supply preds OR probs, not both
    # probs=prob_array,       # shape: (n_examples, n_classes)
    class_names=["cat", "dog", "bird"],
)})
```

---

## 7. System Metrics

W&B automatically logs system metrics every 15 seconds. No configuration needed.

### CPU Metrics
| Metric Key | Description |
|-----------|-------------|
| `cpu` | Process CPU usage % (normalized by available CPUs) |
| `proc.cpu.threads` | Number of threads used by process |

### Memory Metrics
| Metric Key | Description |
|-----------|-------------|
| `proc.memory.rssMB` | Process memory held in main RAM (MB) |
| `proc.memory.percent` | Process memory as % of total |
| `memory_percent` | Total system memory usage % |
| `proc.memory.availableMB` | Total accessible system memory (MB) |

### Disk Metrics
| Metric Key | Description |
|-----------|-------------|
| `disk.{path}.usagePercent` | Disk usage % for path |
| `disk.{path}.usageGB` | Disk usage in GB |
| `disk.in` | Total system disk reads (MB) |
| `disk.out` | Total system disk writes (MB) |

Configure monitored paths: `wandb.Settings(x_stats_disk_paths=["/", "/data"])`

### Network Metrics
| Metric Key | Description |
|-----------|-------------|
| `network.sent` | Total bytes transmitted |
| `network.recv` | Total bytes received |

### NVIDIA GPU Metrics
All prefixed with `gpu.{gpu_index}.`:

| Metric Key | Description |
|-----------|-------------|
| `gpu.{i}.gpu` | GPU utilization % |
| `gpu.{i}.memory` | Memory utilization % |
| `gpu.{i}.memoryAllocated` | Memory allocation % |
| `gpu.{i}.memoryAllocatedBytes` | Memory allocation in bytes |
| `gpu.{i}.temp` | Temperature (C) |
| `gpu.{i}.powerWatts` | Power usage (W) |
| `gpu.{i}.powerPercent` | Power usage % of limit |
| `gpu.{i}.smClock` | SM clock speed (MHz) |
| `gpu.{i}.memoryClock` | Memory clock speed (MHz) |
| `gpu.{i}.graphicsClock` | Graphics clock speed (MHz) |
| `gpu.{i}.correctedMemoryErrors` | Corrected memory errors |
| `gpu.{i}.uncorrectedMemoryErrors` | Uncorrected memory errors |
| `gpu.{i}.encoderUtilization` | Encoder utilization % |

### AMD GPU Metrics
Prefixed with `gpu.{gpu_index}.`: utilization %, memory allocation %, temperature, power (W and %).

### Apple ARM Mac GPU
Prefixed with `gpu.0.`: utilization %, memory allocation %, temperature, power.

### Google Cloud TPU
Prefixed with `tpu.{tpu_index}.`: memory usage (bytes and %), duty cycle %.

### AWS Trainium
Prefixed with `trn.`: NeuronCore utilization, host/device memory usage with breakdowns.

### Graphcore IPU
Prefixed with `ipu.{device_id}.{metric_key}`: board/die temperature, clock speed, power, utilization, data link speed.

---

## 8. Run Management

### Tags

Flexible labels for filtering and organizing runs. A run can have multiple tags.

```python
# Set at init
run = wandb.init(tags=["baseline", "lr-sweep", "v2"])

# Add/remove during run
run.tags = run.tags + ("production",)

# Update via API after completion
api = wandb.Api()
api_run = api.run("entity/project/run_id")
api_run.tags.append("reviewed")
api_run.update()
```

**Use tags for:** experiments, versions, status labels, feature flags. Tags are searchable/filterable in UI.

### Groups

Organize related runs (e.g., cross-validation folds, distributed training processes).

```python
# All runs in the same group appear together in UI
for fold in range(5):
    with wandb.init(group="cross-val-experiment-1", job_type="train") as run:
        run.log({"fold": fold, "accuracy": train_fold(fold)})
```

**Groups vs Tags:**
| Feature | Groups | Tags |
|---------|--------|------|
| Cardinality per run | 1 group | Multiple tags |
| UI behavior | Collapses runs into expandable group | Filter/search |
| Best for | Distributed training, CV folds | Labels, status, experiment type |
| Grouping in UI | Native group-by | Not supported for direct group-by |

### Job Type

Indicates the function of a run within a pipeline.

```python
# Common job types
wandb.init(job_type="data-prep")
wandb.init(job_type="train")
wandb.init(job_type="eval")
wandb.init(job_type="inference")
```

Filterable in UI via Group button --> Job Type dropdown.

### Notes

Longer-form description (like a git commit message).

```python
run = wandb.init(notes="Testing new attention mechanism with rotary embeddings")

# Update later
run.notes = "Updated: added gradient clipping at 1.0"
```

### Resuming Runs

```python
# "allow" - resume if ID exists, create new if not
wandb.init(id="unique-run-id", resume="allow")

# "must" - error if run doesn't exist
wandb.init(id="unique-run-id", resume="must")

# "auto" - resume from most recent failed run on same machine
wandb.init(resume="auto")

# True - simplified resume (same as "allow")
wandb.init(id="unique-run-id", resume=True)

# "never" - always create new run, error if ID exists
wandb.init(id="unique-run-id", resume="never")
```

### Forking Runs

Create a new run that continues from a specific point in a previous run.

```python
# Fork from step 500 of a previous run
wandb.init(fork_from="abc123def?_step=500")

# Resume from a specific step (different from fork -- modifies same run)
wandb.init(resume_from="abc123def?_step=500")
```

**fork_from vs resume_from:**
- `fork_from`: Creates a NEW run with history copied up to that step
- `resume_from`: Continues the SAME run from that step

---

## 9. Sweeps

### Overview

W&B Sweeps = hyperparameter search system. Combines a search strategy with your training code.

### Sweep Configuration

Define as Python dict or YAML file:

```python
sweep_config = {
    # REQUIRED: Search strategy
    "method": "bayes",          # "grid" | "random" | "bayes"

    # REQUIRED: What to optimize
    "metric": {
        "name": "val/loss",     # metric name from wandb.log()
        "goal": "minimize",     # "minimize" | "maximize"
        "target": 0.01,         # optional: stop when reached
    },

    # REQUIRED: Parameter space
    "parameters": {
        "learning_rate": {
            "distribution": "log_uniform_values",
            "min": 1e-5,
            "max": 1e-1,
        },
        "batch_size": {
            "values": [16, 32, 64, 128],
        },
        "epochs": {
            "value": 50,  # constant
        },
        "optimizer": {
            "values": ["adam", "sgd", "adamw"],
        },
        "dropout": {
            "distribution": "uniform",
            "min": 0.0,
            "max": 0.5,
        },
    },

    # OPTIONAL
    "name": "my-sweep",             # display name
    "program": "train.py",          # script to run (required for CLI)
    "description": "LR + dropout sweep",
    "run_cap": 100,                 # max total runs
    "early_terminate": {            # stop bad runs early
        "type": "hyperband",
        "min_iter": 5,
        "eta": 3,
        "s": 2,
    },
}
```

**YAML equivalent (sweep.yaml):**
```yaml
program: train.py
method: bayes
name: my-sweep
run_cap: 100
metric:
  name: val/loss
  goal: minimize
  target: 0.01
parameters:
  learning_rate:
    distribution: log_uniform_values
    min: 1e-5
    max: 1e-1
  batch_size:
    values: [16, 32, 64, 128]
  epochs:
    value: 50
  optimizer:
    values: ["adam", "sgd", "adamw"]
  dropout:
    distribution: uniform
    min: 0.0
    max: 0.5
early_terminate:
  type: hyperband
  min_iter: 5
  eta: 3
  s: 2
```

### All Distribution Types

| Distribution | Required Params | Description |
|-------------|----------------|-------------|
| `constant` | `value` | Fixed value |
| `categorical` | `values` | Discrete choices |
| `int_uniform` | `min`, `max` (int) | Uniform integers |
| `uniform` | `min`, `max` (float) | Continuous uniform |
| `q_uniform` | `min`, `max`, `q` | Quantized uniform: round(X/q)*q |
| `log_uniform` | `min`, `max` | Log-uniform: exp(uniform(min, max)) |
| `log_uniform_values` | `min`, `max` | Log-uniform in value space (min/max are actual values) |
| `q_log_uniform` | `min`, `max`, `q` | Quantized log-uniform |
| `q_log_uniform_values` | `min`, `max`, `q` | Quantized log-uniform in value space |
| `inv_log_uniform` | `min`, `max` | Inverse log-uniform |
| `inv_log_uniform_values` | `min`, `max` | Inverse log-uniform in value space |
| `normal` | `mu`(0), `sigma`(1) | Gaussian distribution |
| `q_normal` | `mu`, `sigma`, `q` | Quantized normal |
| `log_normal` | `mu`(0), `sigma`(1) | Log-normal |
| `q_log_normal` | `mu`, `sigma`, `q` | Quantized log-normal |

**Key distinction:** `log_uniform` expects min/max in log-space. `log_uniform_values` expects min/max in value-space (more intuitive).

### Parameter Specification Options

| Key | Purpose |
|-----|---------|
| `values` | Explicit list of choices |
| `value` | Single constant |
| `distribution` | Distribution name |
| `min` / `max` | Range bounds |
| `mu` / `sigma` | Mean / std dev for normal distributions |
| `q` | Quantization step |
| `probabilities` | Selection probability per value (for categorical) |
| `parameters` | Nested parameter hierarchy |

### Nested Parameters

```python
"parameters": {
    "optimizer": {
        "parameters": {
            "type": {"values": ["adam", "sgd"]},
            "learning_rate": {
                "distribution": "log_uniform_values",
                "min": 1e-5,
                "max": 1e-1,
            },
        }
    }
}
```

### Early Termination (Hyperband)

```python
"early_terminate": {
    "type": "hyperband",  # currently only hyperband supported
    "min_iter": 3,        # minimum iterations before stopping
    "max_iter": 27,       # maximum iterations (used with s)
    "s": 2,               # number of brackets (required with max_iter)
    "eta": 3,             # bracket multiplier (default: 3)
    "strict": False,      # aggressive pruning (default: False)
}
```

### Search Methods Compared

| Method | When to Use | Pros | Cons |
|--------|-------------|------|------|
| `grid` | Small, discrete spaces | Exhaustive, reproducible | Combinatorial explosion |
| `random` | Large spaces, initial exploration | Fast, parallelizable, surprisingly effective | No learning between trials |
| `bayes` | Expensive evaluations, continuous params | Learns from past trials, converges faster | Sequential, overhead for simple spaces |

### Running Sweeps

**Programmatic (Python):**
```python
# 1. Define config
sweep_config = { ... }

# 2. Create sweep -- returns sweep_id
sweep_id = wandb.sweep(sweep_config, project="my-project")

# 3. Define training function
def train():
    with wandb.init() as run:
        lr = run.config.learning_rate
        bs = run.config.batch_size
        # ... training loop ...
        run.log({"val/loss": val_loss})

# 4. Launch agent
wandb.agent(sweep_id, function=train, count=50)
```

**CLI:**
```bash
# Create sweep from YAML
wandb sweep sweep.yaml
# Output: Created sweep with ID: abc123

# Start agent
wandb agent entity/project/abc123

# With count limit
wandb agent --count 50 entity/project/abc123
```

### wandb.agent() Parameters

```python
wandb.agent(
    sweep_id,         # str - sweep ID from wandb.sweep()
    function=None,    # callable - training function (alternative to "program" in config)
    entity=None,      # str - entity name
    project=None,     # str - project name
    count=None,       # int - max number of runs to try
)
```

### Command Macros (for CLI sweeps)

| Macro | Expands To |
|-------|-----------|
| `${env}` | `/usr/bin/env` (Unix); omitted on Windows |
| `${interpreter}` | `python` |
| `${program}` | Training script path |
| `${args}` | `--param1=value1 --param2=value2` |
| `${args_no_boolean_flags}` | Booleans as flags or omitted |
| `${args_no_hyphens}` | `param1=value1 param2=value2` |
| `${args_json}` | JSON-encoded parameters string |
| `${args_json_file}` | Path to JSON params file |
| `${envvar:VARNAME}` | Environment variable reference |

---

## 10. Reports & Workspaces

### Reports

Documents for sharing ML experiment findings with team members.

**Creating Reports (UI):**
1. Go to project --> Reports tab --> Create Report
2. Add panels: line charts, scatter plots, tables, parallel coordinates
3. Add narrative text with markdown
4. Embed run comparisons, artifact viewers

**Creating Reports (Programmatic):**
```python
# pip install wandb-workspaces
import wandb_workspaces.reports.v2 as wr

report = wr.Report(
    project="my-project",
    title="Training Results Q1 2026",
    description="Summary of model improvements",
)
# Add panels, run sets, text blocks...
report.save()
print(report.url)
```

**Sharing:**
- Share button --> email invite (requires W&B login)
- Magic link (no login required)
- Embed in Notion/docs via URL

### Workspaces

Customizable dashboards for active monitoring.

```python
import wandb_workspaces.workspaces as ws

workspace = ws.Workspace(project="my-project")
# Configure panels, filters, grouping...
workspace.save()
```

The `wandb-workspaces` library is in Public Preview.

---

## 11. Public API Client

### wandb.Api()

Post-hoc analysis, data export, and programmatic management.

```python
api = wandb.Api(
    overrides=None,    # dict | None - override settings
    timeout=None,      # int | None - request timeout
    api_key=None,      # str | None - API key (or use WANDB_API_KEY env var)
)
```

### Querying Runs

```python
api = wandb.Api()

# Get all runs in a project
runs = api.runs("entity/project")

# Filter with MongoDB query syntax
runs = api.runs("entity/project", filters={
    "config.learning_rate": {"$lt": 0.01},
    "state": "finished",
    "summary_metrics.val_accuracy": {"$gt": 0.9},
})

# Complex filters
runs = api.runs("entity/project", filters={
    "$and": [
        {"config.model": "transformer"},
        {"tags": {"$in": ["production"]}},
        {"summary_metrics.loss": {"$lt": 0.1}},
    ]
})

# Ordering
runs = api.runs("entity/project", order="-summary_metrics.accuracy")  # descending
runs = api.runs("entity/project", order="+created_at")                # ascending

# Iterate results
for run in runs:
    print(f"{run.name}: {run.config}, {run.summary}")
```

**Filter operators:**
`$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$exists`, `$regex`, `$and`, `$or`, `$nor`

**Filterable fields:**
- `state` - "finished", "failed", "crashed", "running"
- `tags` - run tags
- `config.{key}` - any config value
- `summary_metrics.{key}` - any summary metric
- `username` - who started the run
- `created_at` - creation timestamp

**Order fields:**
`created_at`, `heartbeat_at`, `config.*.value`, `summary_metrics.*`

### Single Run Access

```python
run = api.run("entity/project/run_id")

# Properties
run.id                  # str - unique ID
run.name                # str - display name
run.state               # str - "finished", "failed", "crashed", "running"
run.config              # dict - hyperparameters
run.summary             # dict - final/summary metrics
run.summary_metrics     # dict - same as summary
run.url                 # str - W&B URL
run.path                # list - [entity, project, run_id]
run.tags                # list - tags
run.metadata            # dict - system metadata
run.lastHistoryStep     # int - last step logged
run.system_metrics      # dict - system metrics

# History (sampled -- fast)
history = run.history(samples=500, keys=["loss", "accuracy"], pandas=True)

# History (full -- iterable, no sampling)
for row in run.scan_history(keys=["loss", "accuracy"]):
    print(row["_step"], row["loss"])

# With step range
for row in run.scan_history(min_step=100, max_step=500):
    print(row)

# Files
files = run.files()
run.file("model.pt").download()

# Upload
run.upload_file("./new_file.txt")

# Artifacts
for artifact in run.logged_artifacts():
    print(artifact.name, artifact.type)

for artifact in run.used_artifacts():
    print(artifact.name)

# Update run metadata
run.name = "renamed-run"
run.tags.append("reviewed")
run.notes = "Updated analysis"
run.update()

# Delete
run.delete(delete_artifacts=False)
```

### Artifact Operations via API

```python
# Get artifact by name
artifact = api.artifact("entity/project/artifact-name:latest")
artifact = api.artifact("entity/project/artifact-name:v3")

# Check existence
api.artifact_exists("entity/project/name", type="dataset")

# Download
artifact.download(root="./my_dir")

# Browse artifact types
for art_type in api.artifact_types("my-project"):
    print(art_type.name)

# Browse artifacts of a type
for art in api.artifacts("dataset", "entity/project/name"):
    print(art.name, art.version)

# Artifact collections
collections = api.artifact_collections("my-project", "dataset")
```

### Sweep Access

```python
sweep = api.sweep("entity/project/sweep_id")
# Access sweep config, best run, etc.
```

### Reports

```python
reports = api.reports("entity/project")
for report in reports:
    print(report.name, report.url)
```

### Complete Api Method List

| Method | Description |
|--------|-------------|
| `api.run(path)` | Get single run |
| `api.runs(path, filters, order)` | Query multiple runs |
| `api.create_run()` | Create a new run |
| `api.sweep(path)` | Get sweep |
| `api.artifact(name, type)` | Get artifact |
| `api.artifacts(type, name)` | List artifact versions |
| `api.artifact_exists(name, type)` | Check if artifact exists |
| `api.artifact_type(type, project)` | Get artifact type |
| `api.artifact_types(project)` | List artifact types |
| `api.artifact_collection(type, name)` | Get artifact collection |
| `api.artifact_collections(project, type)` | List collections |
| `api.project(name, entity)` | Get project |
| `api.projects(entity)` | List projects |
| `api.create_project(name, entity)` | Create project |
| `api.reports(path, name)` | List reports |
| `api.team(team)` | Get team |
| `api.create_team(team)` | Create team |
| `api.user(username_or_email)` | Get user |
| `api.users(username_or_email)` | Search users |
| `api.create_user(email)` | Create user |
| `api.job(name)` | Get job |
| `api.list_jobs(entity, project)` | List jobs |
| `api.run_queue(entity, name)` | Get run queue |
| `api.create_run_queue(...)` | Create run queue |
| `api.registries(org, filter)` | List registries |
| `api.registry(name, org)` | Get registry |
| `api.create_registry(...)` | Create registry |
| `api.automation(name, entity)` | Get automation |
| `api.automations(entity)` | List automations |
| `api.create_automation(obj)` | Create automation |
| `api.integrations(entity)` | List integrations |
| `api.slack_integrations(entity)` | List Slack integrations |
| `api.webhook_integrations(entity)` | List webhook integrations |
| `api.create_custom_chart(...)` | Create custom Vega chart |
| `api.sync_tensorboard(root_dir)` | Sync TensorBoard logs |
| `api.from_path(path)` | Get object from path string |
| `api.flush()` | Flush pending operations |

---

## 12. CLI Commands

### Complete Command Reference

| Command | Description |
|---------|-------------|
| `wandb login` | Authenticate with W&B (stores API key) |
| `wandb login --relogin` | Force re-authentication |
| `wandb init` | Configure directory for W&B |
| `wandb online` | Enable cloud sync |
| `wandb offline` | Disable cloud sync (log locally only) |
| `wandb enabled` | Enable W&B |
| `wandb disabled` | Disable W&B entirely |
| `wandb sync` | Upload offline run data to cloud |
| `wandb sync --sync-all` | Sync all pending runs |
| `wandb sync ./wandb/run-XXX` | Sync specific run directory |
| `wandb sweep sweep.yaml` | Create sweep from YAML config |
| `wandb agent entity/project/sweep_id` | Start sweep agent |
| `wandb agent --count 50 entity/project/sweep_id` | Agent with run limit |
| `wandb controller` | Run local sweep controller |
| `wandb artifact put` | Upload artifact |
| `wandb artifact get` | Download artifact |
| `wandb artifact cache` | Manage artifact cache |
| `wandb launch` | Launch or queue a W&B Job |
| `wandb launch-agent` | Run a launch agent |
| `wandb launch-sweep` | Run a launch sweep (experimental) |
| `wandb scheduler` | Run a launch sweep scheduler (experimental) |
| `wandb job` | Manage W&B jobs |
| `wandb projects` | List projects |
| `wandb pull` | Pull files from W&B |
| `wandb restore` | Restore code, config, docker state for a run |
| `wandb docker` | Run code in docker container with W&B |
| `wandb docker-run` | Wraps `docker run` with WANDB_API_KEY injected |
| `wandb server` | Commands for local W&B server |
| `wandb status` | Show configuration settings |
| `wandb verify` | Verify local W&B instance |
| `wandb beta` | Beta versions of CLI commands |
| `wandb beta leet` | Terminal UI for monitoring runs (shows system metrics) |

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `WANDB_API_KEY` | API key for authentication |
| `WANDB_PROJECT` | Default project name |
| `WANDB_ENTITY` | Default entity |
| `WANDB_DIR` | Default directory for run data |
| `WANDB_MODE` | "online", "offline", "disabled" |
| `WANDB_NAME` | Default run name |
| `WANDB_TAGS` | Comma-separated default tags |
| `WANDB_NOTES` | Default run notes |
| `WANDB_RUN_GROUP` | Default group name |
| `WANDB_JOB_TYPE` | Default job type |
| `WANDB_DISABLED` | Set to "true" to disable |
| `WANDB_SILENT` | Set to "true" to suppress output |
| `WANDB_CONFIG_DIR` | Config directory (default: ~/.config/wandb) |
| `WANDB_BASE_URL` | Server URL (for self-hosted) |

---

## 13. Integrations

### PyTorch (Native)

```python
import wandb
import torch

with wandb.init(project="pytorch-example", config={"lr": 0.001, "epochs": 10}) as run:
    model = MyModel()

    # Watch gradients and parameters
    run.watch(model, log="all", log_freq=100, log_graph=True)

    optimizer = torch.optim.Adam(model.parameters(), lr=run.config["lr"])

    for epoch in range(run.config["epochs"]):
        for batch in dataloader:
            loss = train_step(model, batch, optimizer)
            run.log({"train/loss": loss.item()})

        val_loss, val_acc = evaluate(model, val_loader)
        run.log({"val/loss": val_loss, "val/accuracy": val_acc, "epoch": epoch})

    # Save model as artifact
    model_artifact = wandb.Artifact("model", type="model")
    torch.save(model.state_dict(), "model.pt")
    model_artifact.add_file("model.pt")
    run.log_artifact(model_artifact)
```

### PyTorch Lightning

```python
from lightning.pytorch.loggers import WandbLogger

wandb_logger = WandbLogger(
    project="lightning-project",
    name="experiment-1",
    log_model="all",      # log model checkpoints as artifacts
)

# Watch gradients
wandb_logger.watch(model, log="all", log_freq=500)

trainer = pl.Trainer(
    logger=wandb_logger,
    max_epochs=100,
)

# In LightningModule:
class MyModel(pl.LightningModule):
    def training_step(self, batch, batch_idx):
        loss = ...
        self.log("train/loss", loss)  # auto-logged to W&B
        return loss

    def validation_step(self, batch, batch_idx):
        self.log("val/loss", val_loss)
        self.log("val/accuracy", accuracy)
```

### Optuna

```python
import optuna
from optuna.integration import WeightsAndBiasesCallback

# Create callback
wandb_callback = WeightsAndBiasesCallback(
    metric_name="val_loss",
    wandb_kwargs={"project": "optuna-sweep"},
)

# Define objective
@wandb_callback.track_in_wandb()
def objective(trial):
    lr = trial.suggest_float("lr", 1e-5, 1e-1, log=True)
    dropout = trial.suggest_float("dropout", 0.0, 0.5)

    model = train(lr=lr, dropout=dropout)
    val_loss = evaluate(model)

    wandb.log({"val_loss": val_loss})  # logged to same run as trial params
    return val_loss

# Run study (MUST use n_jobs=1 for correct ordering)
study = optuna.create_study(direction="minimize")
study.optimize(objective, n_trials=100, n_jobs=1, callbacks=[wandb_callback])

# IMPORTANT: call wandb.finish() between studies in same process
wandb.finish()
```

### LightGBM

```python
import lightgbm as lgb
from wandb.integration.lightgbm import wandb_callback, log_summary

wandb.init(project="lightgbm-example")

# Train with W&B callback
gbm = lgb.train(
    params,
    train_data,
    valid_sets=[val_data],
    callbacks=[wandb_callback()],  # auto-logs training metrics
)

# Log feature importance + model checkpoint
log_summary(gbm, save_model_checkpoint=True)

wandb.finish()
```

### Hugging Face Transformers

```python
from transformers import TrainingArguments, Trainer

training_args = TrainingArguments(
    output_dir="./output",
    report_to="wandb",           # enable W&B logging
    run_name="hf-experiment",
    logging_steps=10,
    # W&B env vars: WANDB_PROJECT, WANDB_ENTITY, etc.
)

trainer = Trainer(
    model=model,
    args=training_args,
    train_dataset=train_ds,
    eval_dataset=eval_ds,
)
trainer.train()
```

### Keras

```python
from wandb.integration.keras import WandbMetricsLogger, WandbModelCheckpoint

wandb.init(project="keras-example", config={"epochs": 50})

model.fit(
    x_train, y_train,
    validation_data=(x_val, y_val),
    callbacks=[
        WandbMetricsLogger(),                                    # log metrics
        WandbModelCheckpoint("models/", save_best_only=True),    # log checkpoints
    ],
    epochs=wandb.config["epochs"],
)

wandb.finish()
```

### TensorBoard Sync

```python
# Auto-sync existing TensorBoard logs
wandb.init(sync_tensorboard=True)

# Or sync from CLI
wandb sync --sync-tensorboard ./runs/
```

### Scikit-Learn

```python
import wandb
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, classification_report

wandb.init(project="sklearn-example", config={
    "n_estimators": 100,
    "max_depth": 10,
})

model = RandomForestClassifier(**wandb.config)
model.fit(X_train, y_train)

preds = model.predict(X_test)
accuracy = accuracy_score(y_test, preds)

wandb.log({"accuracy": accuracy})
wandb.log({"confusion_matrix": wandb.plot.confusion_matrix(
    y_true=y_test, preds=preds, class_names=class_names
)})

wandb.finish()
```

---

## 14. Best Practices

### Project Organization

```
entity/
  project-a/              # One project per research question or model family
    runs:
      group: "v1-baseline"
        job_type: "train"   --> run-001
        job_type: "eval"    --> run-002
      group: "v2-attention"
        job_type: "train"   --> run-003
        job_type: "eval"    --> run-004
    artifacts:
      raw-data:v0
      processed-data:v0
      model-v1:v0
      model-v2:v0
```

**Rules of thumb:**
- One **project** per model family or research question
- Use **groups** for related runs (cross-validation, distributed training, A/B variants)
- Use **job_type** to distinguish pipeline stages: "data-prep", "train", "eval", "inference"
- Use **tags** for cross-cutting concerns: "production", "baseline", "experiment-42", "reviewed"
- Use **notes** to explain WHY, not WHAT

### Naming Conventions

| Element | Convention | Example |
|---------|-----------|---------|
| Project | lowercase-hyphenated | `forex-regime-model` |
| Run name | Auto-generated or descriptive | `lstm-lr001-drop05` |
| Group | experiment-version | `attention-v2` |
| Tags | lowercase, categorical | `baseline`, `sweep`, `production` |
| Artifacts | lowercase-hyphenated | `processed-data`, `trained-model` |
| Config keys | snake_case (NO dots) | `learning_rate`, `hidden_size` |

### Config Management

```python
# DO: Separate config from code
config = {
    "model": {
        "hidden_size": 256,
        "num_layers": 4,
        "dropout": 0.1,
    },
    "training": {
        "learning_rate": 1e-3,
        "batch_size": 32,
        "epochs": 100,
        "optimizer": "adamw",
    },
    "data": {
        "dataset": "forex-1h",
        "train_split": 0.8,
        "features": ["close", "volume", "rsi"],
    },
}
run = wandb.init(config=config)

# DO: Access config from run object (enables sweeps)
lr = run.config["training"]["learning_rate"]
# DON'T: Hardcode values in training loop
```

### Metric Logging

```python
# DO: Use hierarchical metric names
run.log({
    "train/loss": train_loss,
    "train/accuracy": train_acc,
    "val/loss": val_loss,
    "val/accuracy": val_acc,
    "epoch": epoch,
})

# DO: Define custom axes and summary
run.define_metric("train/*", step_metric="epoch")
run.define_metric("val/*", step_metric="epoch")
run.define_metric("val/loss", summary="min")
run.define_metric("val/accuracy", summary="max")

# DON'T: Log at inconsistent frequencies without commit=False
```

### Artifact Pipeline

```python
# DO: Use artifacts for reproducibility
# Every pipeline step declares inputs and outputs
with wandb.init(job_type="train") as run:
    data = run.use_artifact("processed-data:latest")   # input
    data_dir = data.download()
    # ... train ...
    model_art = wandb.Artifact("model", type="model",
                                metadata={"val_loss": 0.05, "epochs": 100})
    model_art.add_file("model.pt")
    run.log_artifact(model_art, aliases=["latest", "v1-final"])  # output

# DON'T: Save models only to local disk without versioning
```

### Sweep Strategy

```
Small discrete space (< 20 combos) --> grid
Large space, initial exploration     --> random (50-100 trials)
Expensive evaluations, refinement   --> bayes (with early_terminate)
```

```python
# Production sweep pattern
sweep_config = {
    "method": "bayes",
    "metric": {"name": "val/loss", "goal": "minimize"},
    "run_cap": 100,
    "early_terminate": {"type": "hyperband", "min_iter": 5, "eta": 3},
    "parameters": {
        "learning_rate": {"distribution": "log_uniform_values", "min": 1e-5, "max": 1e-2},
        "dropout": {"distribution": "uniform", "min": 0.0, "max": 0.5},
        "hidden_size": {"values": [64, 128, 256, 512]},
        "num_layers": {"values": [1, 2, 3, 4]},
    },
}
```

### Offline/Remote Training

```python
# On compute node without internet
import os
os.environ["WANDB_MODE"] = "offline"

with wandb.init(project="remote-training") as run:
    # ... train as normal ...
    pass

# Later, on machine with internet
# wandb sync ./wandb/run-20260309_143022-abc123
# wandb sync --sync-all
```
