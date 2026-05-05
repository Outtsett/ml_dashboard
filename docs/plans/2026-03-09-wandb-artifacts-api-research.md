# W&B Artifacts & Public API -- Deep Research

## Table of Contents
1. [Artifacts: Creating & Populating](#1-artifacts-creating--populating)
2. [Artifacts: Logging & Using](#2-artifacts-logging--using)
3. [Artifact Versioning & Aliases](#3-artifact-versioning--aliases)
4. [Artifact Lineage & Dependency Graphs](#4-artifact-lineage--dependency-graphs)
5. [Model Registry](#5-model-registry)
6. [Dataset Versioning](#6-dataset-versioning)
7. [Model Checkpointing Best Practices](#7-model-checkpointing-best-practices)
8. [Public API: Querying Runs](#8-public-api-querying-runs)
9. [Public API: Run Data Access](#9-public-api-run-data-access)
10. [Public API: Downloading Artifacts](#10-public-api-downloading-artifacts)
11. [Public API: Updating Runs & Tags](#11-public-api-updating-runs--tags)
12. [Public API: Project Management](#12-public-api-project-management)
13. [Public API: Exporting Data](#13-public-api-exporting-data)
14. [Public API: Programmatic Reports](#14-public-api-programmatic-reports)

---

## 1. Artifacts: Creating & Populating

### Constructor

```python
import wandb

artifact = wandb.Artifact(
    name="my-dataset",           # Required: human-readable name
    type="dataset",              # Required: pipeline stage type
    description="Raw training data from 2026-03",  # Optional: markdown-rendered
    metadata={                   # Optional: up to 100 key-value pairs
        "source": "production_db",
        "rows": 150000,
        "features": ["open", "high", "low", "close", "volume"],
        "split": "train",
    },
    incremental=False,           # Optional: incremental artifact mode
    storage_region=None,         # Optional: storage region override
)
```

**Common artifact types:** `"dataset"`, `"model"`, `"raw_data"`, `"preprocessed_data"`, `"predictions"`, `"evaluation"`

### add_file() -- Single File

```python
# Basic -- stores as "model.pt" at artifact root
artifact.add_file(local_path="checkpoints/model.pt")

# Rename within artifact
artifact.add_file(local_path="checkpoints/model.pt", name="models/best_model.pt")

# Full signature
artifact.add_file(
    local_path="checkpoints/model.pt",
    name="models/best.pt",        # path inside artifact
    is_tmp=False,                  # True = delete local after upload
    skip_cache=False,              # True = bypass local cache
    policy="mutable",             # "mutable" (copies for safety) or "immutable" (trusts user)
    overwrite=False,               # True = overwrite existing entry
)
```

### add_dir() -- Directory Tree

```python
# Add all files in directory at artifact root
artifact.add_dir(local_path="data/processed")

# Preserve directory name as prefix
artifact.add_dir(local_path="data/processed", name="processed")

# Full signature
artifact.add_dir(
    local_path="data/processed",
    name="processed",              # prefix inside artifact
    skip_cache=False,
    policy="mutable",
    merge=False,                   # True = overwrite changed files; False = error on divergence
)
```

### add_reference() -- External URIs (No Upload)

```python
# S3 reference
artifact.add_reference(uri="s3://my-bucket/datasets/train.parquet")

# GCS reference
artifact.add_reference(uri="gs://my-bucket/models/best.pt")

# HTTP reference (tracks ETag/Content-Length)
artifact.add_reference(uri="https://data.example.com/dataset.csv")

# S3 prefix -- expands up to max_objects files
artifact.add_reference(
    uri="s3://my-bucket/images/",
    name="images/",
    checksum=True,                 # strongly recommended for validation
    max_objects=10000,
)
```

### add() -- W&B Objects (Tables, Images, etc.)

```python
# Add a W&B Table
table = wandb.Table(columns=["epoch", "loss", "accuracy"], data=[[1, 0.5, 0.85]])
artifact.add(obj=table, name="metrics/summary_table")

# Add other WBValue types: wandb.Image, wandb.Audio, wandb.Video, wandb.Html
```

### new_file() -- Write Directly into Artifact

```python
with artifact.new_file("config.yaml", mode="w") as f:
    f.write("learning_rate: 0.001\nbatch_size: 32\n")
```

---

## 2. Artifacts: Logging & Using

### log_artifact() -- Mark as Run Output

```python
with wandb.init(project="forex-models", job_type="training") as run:
    # Create and populate
    artifact = wandb.Artifact("model-checkpoint", type="model")
    artifact.add_file("checkpoints/best.pt")

    # Log as output of this run
    run.log_artifact(artifact, aliases=["latest", "best"], tags=["production-ready"])
```

### use_artifact() -- Mark as Run Input (Dependency)

```python
with wandb.init(project="forex-models", job_type="evaluation") as run:
    # Declare dependency -- creates lineage edge
    artifact = run.use_artifact("model-checkpoint:latest")

    # Download contents
    model_dir = artifact.download()
    print(f"Model downloaded to: {model_dir}")
```

### save() -- Outside Run Context

```python
# Create and save without a run
artifact = wandb.Artifact("preprocessed-data", type="dataset")
artifact.add_dir("data/processed")
artifact.save()  # auto-creates a background run
```

### Distributed / Parallel Runs

```python
# Worker runs -- add their piece
with wandb.init(group="distributed-training") as run:
    artifact = wandb.Artifact("distributed-model", type="model")
    artifact.add_file(f"shard_{run.id}.pt")
    run.upsert_artifact(artifact, distributed_id="my_dist_artifact")

# Coordinator run -- finalize (must run last)
with wandb.init(group="distributed-training") as run:
    artifact = wandb.Artifact("distributed-model", type="model")
    run.finish_artifact(artifact, distributed_id="my_dist_artifact")
```

---

## 3. Artifact Versioning & Aliases

### Automatic Version Numbering

- **v0**: Created when artifact name is new
- **v1, v2, ...**: Auto-incremented when content changes (checksum-based diff)
- If content is identical, no new version is created

```python
# First time -- creates v0
artifact = wandb.Artifact("my-dataset", type="dataset")
artifact.add_file("data_v1.csv")
run.log_artifact(artifact)

# Changed content -- creates v1
artifact = wandb.Artifact("my-dataset", type="dataset")
artifact.add_file("data_v2.csv")
run.log_artifact(artifact)

# Same content as v1 -- NO new version created
artifact = wandb.Artifact("my-dataset", type="dataset")
artifact.add_file("data_v2.csv")
run.log_artifact(artifact)
```

### Aliases

Aliases are mutable pointers to specific versions. `"latest"` is auto-assigned to the newest version.

```python
# Log with aliases
run.log_artifact(artifact, aliases=["latest", "best", "production"])

# Reference by alias
artifact = run.use_artifact("my-model:best")
artifact = run.use_artifact("my-model:production")
artifact = run.use_artifact("my-model:v3")  # specific version
```

### Managing Aliases Programmatically (Public API)

```python
api = wandb.Api()
artifact = api.artifact("entity/project/my-model:v5")

# Add alias
artifact.aliases.append("production")

# Remove alias
artifact.aliases.remove("staging")

# Replace all aliases
artifact.aliases = ["latest", "production", "v5"]

# Save changes
artifact.save()
```

### Incremental Versions (Draft System)

```python
with wandb.init() as run:
    # Get current version
    saved = run.use_artifact("my-dataset:latest")

    # Create a draft from it
    draft = saved.new_draft()

    # Modify: add new files, remove old ones
    draft.add_file("new_samples.csv")
    draft.remove("outdated_file.csv")

    # Log as new version
    run.log_artifact(draft)
```

---

## 4. Artifact Lineage & Dependency Graphs

W&B tracks inputs/outputs as a directed acyclic graph (DAG).

### Creating Lineage

```python
with wandb.init(project="ml-pipeline", job_type="preprocess") as run:
    # INPUT: declare raw data as dependency
    raw_data = run.use_artifact("raw-forex-data:latest")
    raw_dir = raw_data.download()

    # ... preprocessing logic ...

    # OUTPUT: log processed data
    processed = wandb.Artifact("processed-forex-data", type="dataset")
    processed.add_dir("data/processed")
    run.log_artifact(processed)
```

This creates the lineage: `raw-forex-data:latest --> preprocess run --> processed-forex-data:v0`

### Traversing the Graph Programmatically

```python
api = wandb.Api()
artifact = api.artifact("entity/project/my-model:latest")

# Who produced this artifact?
producer_run = artifact.logged_by()
print(f"Produced by run: {producer_run.name} (id: {producer_run.id})")
print(f"Run config: {producer_run.config}")

# What runs consumed this artifact?
consumer_runs = artifact.used_by()
for r in consumer_runs:
    print(f"Used by: {r.name} -- state: {r.state}")
```

### Run-Side Artifact Inspection

```python
api = wandb.Api()
run = api.run("entity/project/run_id")

# All artifacts this run produced
for art in run.logged_artifacts():
    print(f"Output: {art.name} v{art.version} ({art.type})")

# All artifacts this run consumed
for art in run.used_artifacts():
    print(f"Input: {art.name} v{art.version} ({art.type})")
```

### Full Pipeline Lineage Example

```python
# Step 1: Data ingestion
with wandb.init(job_type="ingest") as run:
    raw = wandb.Artifact("raw-data", type="raw_data")
    raw.add_dir("data/raw")
    run.log_artifact(raw)

# Step 2: Preprocessing
with wandb.init(job_type="preprocess") as run:
    raw = run.use_artifact("raw-data:latest")
    raw.download()
    # ... preprocess ...
    processed = wandb.Artifact("processed-data", type="dataset")
    processed.add_dir("data/processed")
    run.log_artifact(processed)

# Step 3: Training
with wandb.init(job_type="train") as run:
    data = run.use_artifact("processed-data:latest")
    data.download()
    # ... train model ...
    model = wandb.Artifact("trained-model", type="model")
    model.add_file("model.pt")
    run.log_artifact(model)

# Step 4: Evaluation
with wandb.init(job_type="eval") as run:
    model_art = run.use_artifact("trained-model:latest")
    data_art = run.use_artifact("processed-data:latest")
    # ... evaluate ...
```

Lineage graph: `raw-data --> preprocess --> processed-data --> train --> trained-model --> eval`

---

## 5. Model Registry

The Model Registry manages the lifecycle from training to production with role-based access control.

### Linking a Model to the Registry

```python
with wandb.init(entity="team", project="forex-models") as run:
    # Create model artifact
    model = wandb.Artifact(name="hdp-hmm-v2", type="model")
    model.add_file("checkpoints/best.pt")
    model.add_file("config.yaml")

    # Link to registry
    REGISTRY_NAME = "model"          # or custom registry name
    COLLECTION_NAME = "forex-regime" # collection within registry
    target_path = f"wandb-registry-{REGISTRY_NAME}/{COLLECTION_NAME}"

    run.link_artifact(artifact=model, target_path=target_path)
```

### Linking Outside a Run

```python
model = wandb.Artifact(name="hdp-hmm-v2", type="model")
model.add_file("checkpoints/best.pt")

target_path = "wandb-registry-model/forex-regime"
model.link(target_path=target_path, aliases=["candidate"])
```

### Lifecycle Stages

Registry supports these transitions: `development --> staging --> production --> archived`

- Transition models through stages in the W&B UI
- Automate downstream actions with webhooks on stage transitions
- Full audit trail of who changed what and when

### Downloading from Registry

```python
api = wandb.Api()
artifact = api.artifact("wandb-registry-model/forex-regime:production")
model_dir = artifact.download()
```

### Creating a Registry Programmatically

```python
api = wandb.Api()
api.create_registry(
    name="models",
    visibility="restricted",       # or "organization"
    organization="my-org",
    description="Production model registry",
    artifact_types=["model"],      # restrict to model type only
)
```

---

## 6. Dataset Versioning

### How It Works

- W&B checksums every file; only changed/new files are uploaded
- Unchanged files across versions are stored once (deduplication)
- Auto-diffs the latest version: if nothing changed, no new version created

### Versioning Pipeline Example

```python
def log_dataset(name: str, data_dir: str, metadata: dict, job_type: str = "data-pipeline"):
    """Log a dataset artifact with metadata tracking."""
    with wandb.init(project="forex-data", job_type=job_type) as run:
        artifact = wandb.Artifact(
            name=name,
            type="dataset",
            description=f"Dataset version logged at {metadata.get('timestamp', 'unknown')}",
            metadata=metadata,
        )
        artifact.add_dir(data_dir)
        run.log_artifact(artifact, aliases=["latest"])
        return artifact

# Initial dataset
log_dataset("forex-ohlcv", "data/ohlcv/", metadata={
    "symbols": ["EURUSD", "GBPUSD", "USDJPY"],
    "timeframe": "1H",
    "rows": 500000,
    "date_range": "2020-01-01 to 2026-03-01",
    "timestamp": "2026-03-09",
})

# Updated dataset (auto-creates v1, only uploads diffs)
log_dataset("forex-ohlcv", "data/ohlcv/", metadata={
    "symbols": ["EURUSD", "GBPUSD", "USDJPY"],
    "timeframe": "1H",
    "rows": 520000,
    "date_range": "2020-01-01 to 2026-03-09",
    "timestamp": "2026-03-09",
    "changes": "Added 20k new rows for March 2026",
})
```

### Train/Val/Test Split Tracking

```python
with wandb.init(project="forex-data", job_type="split") as run:
    raw = run.use_artifact("forex-ohlcv:latest")
    raw.download()

    for split_name in ["train", "val", "test"]:
        split_artifact = wandb.Artifact(
            name=f"forex-ohlcv-{split_name}",
            type="dataset",
            metadata={"split": split_name, "parent": raw.name},
        )
        split_artifact.add_dir(f"data/splits/{split_name}")
        run.log_artifact(split_artifact)
```

### Large Datasets via References

```python
artifact = wandb.Artifact("large-tick-data", type="dataset", metadata={
    "source": "s3",
    "size_gb": 250,
})
# Reference without uploading -- tracks checksums from S3 metadata
artifact.add_reference("s3://forex-data-bucket/tick-data/", max_objects=50000)
run.log_artifact(artifact)
```

---

## 7. Model Checkpointing Best Practices

### Pattern: Save Every N Epochs, Keep Best + Latest

```python
import torch
import wandb

with wandb.init(project="forex-models", job_type="train") as run:
    best_loss = float("inf")

    for epoch in range(100):
        train_loss = train_one_epoch(model, dataloader)
        val_loss = validate(model, val_loader)

        wandb.log({"epoch": epoch, "train_loss": train_loss, "val_loss": val_loss})

        # Save checkpoint every 10 epochs
        if epoch % 10 == 0:
            torch.save({
                "epoch": epoch,
                "model_state_dict": model.state_dict(),
                "optimizer_state_dict": optimizer.state_dict(),
                "val_loss": val_loss,
            }, "checkpoint.pt")

            artifact = wandb.Artifact(
                f"model-checkpoint",
                type="model",
                metadata={"epoch": epoch, "val_loss": val_loss},
            )
            artifact.add_file("checkpoint.pt")
            aliases = ["latest", f"epoch-{epoch}"]
            if val_loss < best_loss:
                best_loss = val_loss
                aliases.append("best")
            run.log_artifact(artifact, aliases=aliases)
```

### Pattern: Restore from Checkpoint

```python
with wandb.init(project="forex-models", job_type="train") as run:
    # Resume from best checkpoint
    artifact = run.use_artifact("model-checkpoint:best")
    artifact_dir = artifact.download()

    checkpoint = torch.load(f"{artifact_dir}/checkpoint.pt")
    model.load_state_dict(checkpoint["model_state_dict"])
    optimizer.load_state_dict(checkpoint["optimizer_state_dict"])
    start_epoch = checkpoint["epoch"] + 1

    print(f"Resuming from epoch {start_epoch}, val_loss: {checkpoint['val_loss']}")
```

### Pattern: Full Training Artifact (Model + Config + Metrics)

```python
with wandb.init(project="forex-models", job_type="train") as run:
    # ... training loop ...

    # Save everything needed to reproduce
    artifact = wandb.Artifact("trained-model", type="model", metadata={
        "architecture": "HDP-HMM",
        "hidden_states": 8,
        "final_val_loss": best_loss,
        "epochs_trained": 100,
        "training_data": "forex-ohlcv:v3",
    })
    artifact.add_file("model.pt")
    artifact.add_file("config.yaml")
    artifact.add_file("scaler.pkl")           # feature scaler
    artifact.add_file("feature_columns.json")  # feature ordering

    run.log_artifact(artifact, aliases=["latest", "best", "production-candidate"])

    # Link to model registry
    run.link_artifact(
        artifact=artifact,
        target_path="wandb-registry-model/hdp-hmm-forex",
    )
```

### Pattern: PyTorch Lightning Integration

```python
from pytorch_lightning.loggers import WandbLogger
from pytorch_lightning.callbacks import ModelCheckpoint

wandb_logger = WandbLogger(
    project="forex-models",
    log_model="all",  # log checkpoints during training
    # log_model=True   -- only log at end of training
)

checkpoint_callback = ModelCheckpoint(
    monitor="val_loss",
    mode="min",
    save_top_k=3,
    filename="{epoch}-{val_loss:.4f}",
)

trainer = pl.Trainer(
    logger=wandb_logger,
    callbacks=[checkpoint_callback],
    max_epochs=100,
)
trainer.fit(model, train_loader, val_loader)

# Retrieve the best checkpoint later
# Reference: "USER/PROJECT/MODEL-RUN_ID:best"
```

---

## 8. Public API: Querying Runs

### Basic Setup

```python
import wandb

api = wandb.Api(
    timeout=30,           # HTTP timeout in seconds
    # api_key="...",      # or set WANDB_API_KEY env var
)
```

### api.runs() -- Query Runs with Filters

```python
# All runs in a project
runs = api.runs("entity/project")

# With MongoDB-style filters
runs = api.runs("entity/project", filters={
    "state": "finished",
    "config.model_type": "hdp-hmm",
    "summary_metrics.val_loss": {"$lt": 0.05},
})

# Ordering
runs = api.runs("entity/project",
    order="-summary_metrics.accuracy",  # descending by accuracy
    per_page=100,
)

runs = api.runs("entity/project",
    order="+created_at",  # ascending by creation date
)
```

### MongoDB Filter Operators

```python
# Comparison
{"summary_metrics.loss": {"$lt": 0.5}}
{"summary_metrics.loss": {"$lte": 0.5}}
{"summary_metrics.loss": {"$gt": 0.1}}
{"summary_metrics.loss": {"$gte": 0.1}}
{"config.epochs": {"$eq": 100}}
{"config.epochs": {"$ne": 50}}

# Set membership
{"config.model_type": {"$in": ["hdp-hmm", "lstm", "transformer"]}}
{"state": {"$nin": ["crashed", "failed"]}}

# Logical
{"$or": [
    {"config.experiment_name": "baseline"},
    {"config.experiment_name": "improved"},
]}
{"$and": [
    {"summary_metrics.val_loss": {"$lt": 0.1}},
    {"state": "finished"},
]}

# Regex
{"display_name": {"$regex": "hdp-hmm.*"}}
{"config.experiment_name": {"$regex": "^forex_"}}

# Existence
{"summary_metrics.accuracy": {"$exists": True}}

# Range query
{"duration": {"$gte": 3600, "$lte": 7200}}  # 1-2 hours

# Date filtering
{"created_at": {"$gt": "2026-03-01T00:00:00", "$lt": "2026-03-09T00:00:00"}}
```

### Filterable Fields

| Field | Example |
|-------|---------|
| `state` | `"finished"`, `"failed"`, `"crashed"`, `"running"` |
| `display_name` | Run display name |
| `username` | Creator |
| `createdAt` | Creation timestamp |
| `duration` | Run duration in seconds |
| `group` | Run group |
| `jobType` | Job type string |
| `tags` | Tags (limited API filtering -- see Section 11) |
| `config.*` | Any config key |
| `summary_metrics.*` | Any summary metric |

### Iterating Results

```python
runs = api.runs("entity/project", filters={"state": "finished"})

for run in runs:
    print(f"{run.name} | loss={run.summary.get('val_loss', 'N/A')} | {run.state}")
```

The `runs` object is a lazy paginated iterator -- it fetches pages from the server as you iterate.

---

## 9. Public API: Run Data Access

### Core Properties

```python
run = api.run("entity/project/run_id")

run.id            # "a1b2c3d4" -- 8-char unique ID
run.name          # "crimson-wave-42" -- human-readable name
run.state         # "finished" | "failed" | "crashed" | "running"
run.tags          # ["baseline", "production"]
run.entity        # "tyler"
run.project       # "forex-models"
run.url           # "https://wandb.ai/tyler/forex-models/runs/a1b2c3d4"
run.created_at    # creation timestamp
run.config        # dict of hyperparameters
run.summary       # dict of final metrics
run.summary_metrics  # same as summary but as plain dict
```

### run.history() -- Sampled Metrics (Default 500 Points)

```python
# Returns pandas DataFrame
df = run.history(samples=500, keys=["loss", "accuracy"])

# Specific keys only
df = run.history(keys=["val_loss", "val_accuracy"])

# System metrics (GPU, CPU, memory)
sys_df = run.history(stream="events")

# Iterate rows
for i, row in run.history().iterrows():
    print(row["_step"], row["_timestamp"], row.get("loss"))
```

### run.scan_history() -- Full Unsampled History

```python
# Generator -- yields every logged step (no sampling)
history = run.scan_history(keys=["loss", "val_loss"])

losses = [row["loss"] for row in history]

# With pagination control
history = run.scan_history(
    keys=["loss", "val_loss"],
    page_size=1000,
    min_step=0,
    max_step=5000,
)

# Convert to DataFrame
import pandas as pd
df = pd.DataFrame(run.scan_history())
```

### run.config -- Hyperparameters

```python
run = api.run("entity/project/run_id")
config = run.config

print(f"Learning rate: {config['learning_rate']}")
print(f"Batch size: {config['batch_size']}")
print(f"Model: {config.get('model_type', 'unknown')}")
```

### run.summary -- Final Metrics

```python
summary = run.summary

print(f"Best val loss: {summary['best_val_loss']}")
print(f"Final accuracy: {summary['accuracy']}")

# Access as plain dict
summary_dict = run.summary._json_dict
```

### File Operations

```python
# Download a specific file
run.file("model.pt").download(root="downloads/")

# Download all files
for f in run.files():
    f.download()

# Filter files by pattern (MySQL LIKE syntax)
for f in run.files(pattern="*.json"):
    f.download()

# Upload a file to a finished run
run.upload_file("analysis_results.csv")
```

### Download Full History as Parquet

```python
result = run.download_history_exports(
    download_dir="exports/",
    require_complete_history=True,  # raises error if incomplete
)
```

---

## 10. Public API: Downloading Artifacts

### By Name and Version/Alias

```python
api = wandb.Api()

# By alias
artifact = api.artifact("entity/project/my-model:latest")
artifact = api.artifact("entity/project/my-model:best")
artifact = api.artifact("entity/project/my-model:production")

# By version
artifact = api.artifact("entity/project/my-model:v3")

# Download contents
artifact_dir = artifact.download()
print(f"Downloaded to: {artifact_dir}")
```

### Partial Download

```python
artifact = api.artifact("entity/project/my-dataset:latest")

# Single file
artifact.download(path_prefix="train.csv")

# Subdirectory
artifact.download(path_prefix="images/train/")
```

### Inspect Without Downloading

```python
artifact = api.artifact("entity/project/my-model:latest")

print(f"Name: {artifact.name}")
print(f"Type: {artifact.type}")
print(f"Version: {artifact.version}")
print(f"Size: {artifact.size} bytes")
print(f"File count: {artifact.file_count}")
print(f"State: {artifact.state}")
print(f"Aliases: {artifact.aliases}")
print(f"Tags: {artifact.tags}")
print(f"Metadata: {artifact.metadata}")
print(f"Created at: {artifact.created_at}")
print(f"Digest: {artifact.digest}")

# List all files in the artifact
for entry in artifact.manifest.entries:
    print(f"  {entry}: {artifact.manifest.entries[entry].size} bytes")
```

### Check Existence

```python
exists = api.artifact_exists("entity/project/my-model:v5", type="model")
print(f"Artifact exists: {exists}")
```

### Browse Artifact Collections

```python
# List all artifact types in a project
for at in api.artifact_types("my-project"):
    print(at.name)

# List all collections of a type
for coll in api.artifact_collections("my-project", type_name="model"):
    print(coll.name)

# List all versions in a collection
for version in api.artifacts(type_name="model", name="entity/project/my-model"):
    print(f"{version.name} -- {version.version} -- {version.state}")
```

### Verify Downloaded Artifact

```python
artifact.download(root="artifacts/my-model")
artifact.verify(root="artifacts/my-model")  # raises ValueError on mismatch
```

### Delete an Artifact

```python
artifact = api.artifact("entity/project/old-model:v0")
artifact.delete(delete_aliases=True)  # must delete aliases first or set this True
```

---

## 11. Public API: Updating Runs & Tags

### Update Run Properties

```python
api = wandb.Api()
run = api.run("entity/project/run_id")

# Update config
run.config["post_hoc_note"] = "This run used wrong learning rate"
run.update()

# Update summary metrics
run.summary["adjusted_accuracy"] = 0.92
run.summary.update()

# Rename a metric
run.summary["val_accuracy"] = run.summary["accuracy"]
del run.summary["accuracy"]
run.summary.update()
```

### Adding Tags Programmatically

```python
# During a run
with wandb.init(project="forex-models", tags=["baseline", "v2"]) as run:
    # ... training ...
    if val_loss < threshold:
        run.tags = run.tags + ("production-ready",)

# After a run (Public API)
api = wandb.Api()
run = api.run("entity/project/run_id")
run.tags.append("reviewed")
run.tags.append("production-candidate")
run.update()
```

### Batch Tagging

```python
api = wandb.Api()
runs = api.runs("entity/project", filters={
    "state": "finished",
    "summary_metrics.val_loss": {"$lt": 0.05},
})

for run in runs:
    if "top-performer" not in run.tags:
        run.tags.append("top-performer")
        run.update()
```

### Update Run State

```python
run = api.run("entity/project/run_id")
# Transition failed/crashed runs back to pending
success = run.update_state(state="pending")
```

### Delete a Run

```python
run = api.run("entity/project/run_id")
run.delete(delete_artifacts=False)  # True = also delete associated artifacts
```

---

## 12. Public API: Project Management

### List Projects

```python
api = wandb.Api()

# All projects for an entity
projects = api.projects(entity="tyler", per_page=200)
for p in projects:
    print(f"{p.name} -- {p.entity}")
```

### Get Project Details

```python
project = api.project("forex-models", entity="tyler")
```

### Create a Project

```python
api.create_project(name="forex-regime-detection", entity="tyler")
```

### Delete Runs in Bulk

```python
api = wandb.Api()
runs = api.runs("entity/project", filters={"state": "crashed"})

for run in runs:
    print(f"Deleting crashed run: {run.name}")
    run.delete()
```

### Sweep Operations

```python
# Get sweep details
sweep = api.sweep("entity/project/sweep_id")
print(f"Best run: {sweep.best_run().name}")
print(f"Total runs: {len(sweep.runs)}")

# Iterate sweep runs
for run in sweep.runs:
    print(f"{run.name}: {run.summary.get('val_loss')}")
```

---

## 13. Public API: Exporting Data

### Multiple Runs to DataFrame

```python
import pandas as pd
import wandb

api = wandb.Api()
runs = api.runs("entity/project", filters={"state": "finished"})

data = []
for run in runs:
    row = {
        "name": run.name,
        "id": run.id,
        "state": run.state,
        "created_at": run.created_at,
        **{f"config.{k}": v for k, v in run.config.items() if not k.startswith("_")},
        **{f"metric.{k}": v for k, v in run.summary._json_dict.items()
           if not k.startswith("_")},
    }
    data.append(row)

df = pd.DataFrame(data)
df.to_csv("all_runs.csv", index=False)
print(f"Exported {len(df)} runs")
```

### Single Run History to CSV

```python
run = api.run("entity/project/run_id")

# Sampled (default 500 points)
df = run.history(keys=["loss", "val_loss", "accuracy"])
df.to_csv("run_history_sampled.csv", index=False)

# Full unsampled history
df_full = pd.DataFrame(run.scan_history(keys=["loss", "val_loss", "accuracy"]))
df_full.to_csv("run_history_full.csv", index=False)
```

### System Metrics Export

```python
sys_df = run.history(stream="events")
sys_df.to_csv("system_metrics.csv", index=False)
# Contains: gpu utilization, memory, CPU, network, etc.
```

### Compare Two Runs

```python
run1 = api.run("entity/project/run_id_1")
run2 = api.run("entity/project/run_id_2")

# Compare configs
config_df = pd.DataFrame([run1.config, run2.config]).transpose()
config_df.columns = [run1.name, run2.name]
diff = config_df[config_df[run1.name] != config_df[run2.name]]
print("Config differences:")
print(diff)

# Compare final metrics
metrics_df = pd.DataFrame([run1.summary._json_dict, run2.summary._json_dict]).transpose()
metrics_df.columns = [run1.name, run2.name]
print("\nMetrics comparison:")
print(metrics_df)
```

### Bulk History Export (Multiple Runs)

```python
api = wandb.Api()
runs = api.runs("entity/project", filters={"state": "finished"}, per_page=50)

all_histories = {}
for run in runs:
    df = pd.DataFrame(run.scan_history(keys=["loss", "val_loss"]))
    df["run_name"] = run.name
    df["run_id"] = run.id
    all_histories[run.id] = df

combined = pd.concat(all_histories.values(), ignore_index=True)
combined.to_csv("all_run_histories.csv", index=False)
```

### Parquet Export (Complete History)

```python
run = api.run("entity/project/run_id")
result = run.download_history_exports(
    download_dir="exports/",
    require_complete_history=True,
)
# Load parquet files with pandas/polars for analysis
```

---

## 14. Public API: Programmatic Reports

### Installation

```bash
pip install wandb wandb-workspaces
```

### Basic Report Creation

```python
import wandb_workspaces.reports.v2 as wr

report = wr.Report(
    entity="tyler",
    project="forex-models",
    title="HDP-HMM Training Report",
    description="Automated training analysis for regime detection models",
)
report.save()
print(f"Report URL: {report.url}")
```

### Reports with Panels

```python
import wandb_workspaces.reports.v2 as wr

report = wr.Report(
    entity="tyler",
    project="forex-models",
    title="Model Comparison Report",
)

report.blocks = [
    wr.H1(text="Training Results"),

    wr.MarkdownBlock(text="Comparison of HDP-HMM variants trained on forex data."),

    wr.PanelGrid(
        runsets=[
            wr.Runset(
                entity="tyler",
                project="forex-models",
                filters="Config('model_type') == 'hdp-hmm' and Metric('state') in ['finished']",
            )
        ],
        panels=[
            wr.LinePlot(
                title="Training Loss",
                x="_step",
                y=["train_loss"],
                smoothing_factor=0.6,
            ),
            wr.LinePlot(
                title="Validation Loss",
                x="_step",
                y=["val_loss"],
                smoothing_factor=0.6,
                groupby="config.hidden_states",
                groupby_aggfunc="mean",
            ),
            wr.ScatterPlot(
                title="Loss vs Accuracy",
                x="val_loss",
                y="accuracy",
                regression=True,
            ),
        ],
    ),

    wr.H2(text="Conclusions"),
    wr.MarkdownBlock(text="Best model: **hdp-hmm-v2** with 8 hidden states."),
]

report.save()
```

### LinePlot Configuration

```python
wr.LinePlot(
    title="Training Curves",
    x="_step",
    y=["loss", "val_loss"],
    range_x=[0, 10000],
    range_y=[0, 1.0],
    log_x=False,
    log_y=True,
    title_x="Step",
    title_y="Loss",
    ignore_outliers=True,
    groupby="config.learning_rate",
    groupby_aggfunc="mean",         # mean, median, min, max
    groupby_rangefunc="minmax",     # minmax, stddev, stderr
    smoothing_factor=0.5,
    smoothing_type="gaussian",
    smoothing_show_original=True,
    max_runs_to_show=10,
    plot_type="stacked-area",       # or "line"
    font_size="large",
    legend_position="west",
)
```

### Runset Filtering

```python
# Filter by config values
wr.Runset(
    entity="tyler",
    project="forex-models",
    filters="Config('learning_rate') > 0.01 and Config('batch_size') == 32",
    groupby=["config.model_type"],
)

# Filter by state and metrics
wr.Runset(
    entity="tyler",
    project="forex-models",
    filters="Metric('state') in ['finished'] and SummaryMetric('val_loss') < 0.05",
)

# Filter by tags
wr.Runset(
    entity="tyler",
    project="forex-models",
    filters="Tags('production-ready') == 'production-ready'",
)
```

### Code and Text Blocks

```python
report.blocks = [
    wr.H1(text="Experiment Documentation"),
    wr.H2(text="Configuration"),
    wr.CodeBlock(code=["learning_rate: 0.001", "batch_size: 32", "hidden_states: 8"], language="yaml"),
    wr.MarkdownBlock(text="Results show **significant improvement** over baseline."),
    wr.UnorderedList(items=["Lower loss", "Faster convergence", "Better regime detection"]),
]
```

---

## Quick Reference: Key Imports

```python
import wandb

# SDK (during training)
wandb.init()
wandb.Artifact()
wandb.log()

# Public API (after training, analysis, automation)
api = wandb.Api()
api.runs()
api.run()
api.artifact()
api.artifacts()
api.projects()
api.sweep()

# Reports
import wandb_workspaces.reports.v2 as wr
wr.Report()
wr.PanelGrid()
wr.LinePlot()
wr.ScatterPlot()
wr.Runset()
```
