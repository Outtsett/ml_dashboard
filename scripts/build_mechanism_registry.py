"""
Build mechanism registry entries from the algo_models spec corpus.

WHAT THIS DOES, PRECISELY: for each catalog key it opens the ONE markdown spec
that key maps to, lifts that spec's own "Principles" / "Algorithm" / "Architecture"
bullets, and emits a MechanismSpec whose stages and beats are those bullets.

WHAT IT DOES NOT DO: invent. Every stage label and every beat detail traces to a
line in the cited file. If a spec yields too little structure, the key is REPORTED
as unextractable rather than padded with plausible-sounding filler -- a registry
entry that reads as researched but is not would defeat the whole module.

Entries emitted here carry `curation: 'extracted'`. The ten hand-read cluster-loop
entries carry `curation: 'curated'` and are NOT touched by this script.

Run:
    uv run python scripts/build_mechanism_registry.py
"""

from __future__ import annotations

import json
import pathlib
import re
import sys
from collections import defaultdict

ROOT = pathlib.Path(r"E:/source/repos/Trading/_architecture/educational/algo_models")
OUT_DIR = pathlib.Path("src/client/src/system/architecture-explorer/mechanism/registry")
SCRATCH = pathlib.Path(
    r"C:/Users/tyler/AppData/Local/Temp/claude/E--source-repos-ml-dashboard"
    r"/c5889abe-6cb9-4352-b045-27c1a0fd242c/scratchpad"
)

# Keys already hand-curated; never regenerate them.
CURATED_KEYS = {
    "k-means-clustering", "gaussian-mixture-model-gmm",
    "dbscan-density-based-spatial-clustering", "mean-shift-clustering",
    "spectral-clustering", "hierarchical-clustering-agglomerative-divisive",
    "affinity-propagation", "semi-supervised-clustering",
    "self-organizing-maps-som", "deep-clustering-network",
}

# Repo-sourced entries: real code here, no markdown spec.
REPO_SOURCED = {
    "xgboost+direction_classifier": "src/ml/xgb_classifier/main.py",
    "transformer_2s+range_classifier": "src/ml/blocks/encoder.py",
    "transformer_tiny+direction_classifier": "src/ml/blocks/encoder.py",
    "temporal_fusion_transformer+direction_classifier": "src/ml/blocks/tft.py",
    "temporal-fusion-transformer": "src/ml/blocks/tft.py",
    "primitives_cnn+multi_head": "src/config/models.json",
    "voting-composite": "src/templates/architectures/composite_voting.py.j2",
    "multimodal-composite": "src/templates/architectures/composite_multimodal.py.j2",
    "stacking-composite": "src/templates/architectures/composite_stacking.py.j2",
    "moe-composite": "src/templates/architectures/composite_moe.py.j2",
}

# ── Archetype classification ────────────────────────────────────────────────
# Ordered: first match wins. Patterns are matched against name + category.
ARCHETYPE_RULES: list[tuple[str, str]] = [
    ("adversarial-duel", r"\bgan\b|adversarial|discriminator|cyclegan|stylegan|wasserstein|biggan"),
    ("contrastive-pair", r"contrastive|simclr|moco|byol|simsiam|barlow|dino|swav|siamese|cross-view|self-predictive"),
    ("teacher-student", r"teacher|student|distill|fixmatch|mixmatch|pseudo|self-train|tri-train|co-training|mean teacher|consistency|virtual adversarial|entropy minim"),
    ("iterative-denoise", r"diffusion|score-based|denois|normalizing flow|neural ode|energy-based|boltzmann|langevin"),
    ("encode-bottleneck-decode", r"autoencoder|\bvae\b|\bae\b|u-net|unet|ladder|masked autoencoder|bottleneck"),
    ("attention-match", r"attention|transformer|\bvit\b|\bbert\b|slot"),
    ("autoregressive", r"autoregressive|pixelrnn|pixelcnn|\bgpt\b|masked language|next-token"),
    ("tree-route", r"xgboost|lightgbm|catboost|gradient boosting|random forest|decision tree|isolation forest|\bgbm\b"),
    ("graph-message-pass", r"\bgnn\b|graph|\bgcn\b|\bgat\b|label propagation|label spreading|manifold regular"),
    ("projection-embed", r"\bpca\b|\bica\b|\bnmf\b|t-sne|umap|isomap|manifold learning|dimensionality|matrix factor"),
    ("cluster-loop", r"cluster|k-means|dbscan|mean shift|affinity|self-organizing|gaussian mixture"),
    ("density-boundary", r"outlier|one-class|novelty|anomaly|robust covariance|local outlier"),
    ("ensemble-route", r"ensemble|stacking|voting|mixture of experts|\bmoe\b|hypernetwork|calibrated|blend"),
    ("symbolic-hybrid", r"symbolic|rule|logic|probabilistic program|bayesian.*hybrid|neuro-symbolic"),
    ("agent-environment", r"reinforcement|\brl\b|agent|policy|\bdqn\b|actor-critic|reward"),
    ("convex-fit", r"regression|\bsvm\b|logistic|ridge|lasso|elasticnet|lars|quantile|probit|ordinal|bayesian ridge|stochastic gradient|linear"),
    ("feedforward-stack", r"neural network|\bmlp\b|\bcnn\b|convolution|resnet|densenet|feedforward|perceptron|hypernet"),
]
DEFAULT_ARCHETYPE = "feedforward-stack"

# Order matters: first match wins.
#
# `output` deliberately does NOT match "generat" or "decode". In a GAN,
# "Generator" is a COMPONENT that transforms a latent into a sample — it is not
# the pipeline's output stage — and matching the substring mislabelled BigGAN's
# generator as `output`, which then coloured and shaped it wrongly. Component
# nouns fall through to the `transform` default, which is what they are.
ROLE_RULES: list[tuple[str, str]] = [
    ("input", r"^(input|data|dataset|feature|observation|latent z|noise|sample|initiali[sz])"),
    ("loss", r"loss|objective|likelihood|divergence|\berror\b|\bcost\b|elbo|regulari[sz]"),
    ("update", r"update|optimi|backprop|gradient|m-step|maximi|re-?fit|adjust|propagat|convergence"),
    ("score", r"discrimin|critic|\bscore\b|evaluat|assign|classif|probabilit|responsib|similarit|distance|attention"),
    ("latent", r"latent|embedding|bottleneck|representation|\bcode\b|manifold"),
    ("output", r"^output|reconstruct|prediction|\bresult\b|synthesi"),
]
DEFAULT_ROLE = "transform"


def esc(s: str) -> str:
    return s.replace("\\", "\\\\").replace("'", "\\'")


def clean(text: str) -> str:
    """Strip markdown emphasis, links, math and citation noise from a bullet."""
    text = re.sub(r"\[\]\(https?://[^)]*\)", " ", text)
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"\\\[[\s\S]*?\\\]", " ", text)
    text = re.sub(r"\$[^$]*\$", " ", text)
    text = text.replace("**", "").replace("*", "").replace("`", "")
    text = re.sub(r"\s+", " ", text)
    return text.strip(" -:\u2014")


def section(md: str, *titles: str) -> str:
    for t in titles:
        m = re.search(rf"^#+\s*{t}\b.*?$(.*?)(?=^#+\s|\Z)", md, re.M | re.S | re.I)
        if m and m.group(1).strip():
            return m.group(1)
    return ""


def bullets(block: str) -> list[tuple[str, str]]:
    """(label, detail) from '- **Label**: detail' / '1. **Label**: detail' lines."""
    out: list[tuple[str, str]] = []
    for line in block.splitlines():
        m = re.match(r"\s*(?:[-*+]|\d+\.)\s+(.*)", line)
        if not m:
            continue
        body = clean(m.group(1))
        if len(body) < 8:
            continue
        if ":" in body:
            label, detail = body.split(":", 1)
        elif " - " in body:
            label, detail = body.split(" - ", 1)
        else:
            label, detail = body, ""
        label = label.strip().rstrip(".")
        detail = detail.strip()
        if 2 <= len(label) <= 64:
            out.append((label, detail))
    return out


def role_for(label: str) -> str:
    low = label.lower()
    for role, pat in ROLE_RULES:
        if re.search(pat, low):
            return role
    return DEFAULT_ROLE


def archetype_for(name: str, category: str, body: str) -> str:
    hay = f"{name} {category}".lower()
    for arch, pat in ARCHETYPE_RULES:
        if re.search(pat, hay):
            return arch
    low = body.lower()
    for arch, pat in ARCHETYPE_RULES:
        if re.search(pat, low):
            return arch
    return DEFAULT_ARCHETYPE


def slug(s: str, used: set[str]) -> str:
    base = re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")[:26] or "stage"
    cand, i = base, 2
    while cand in used:
        cand, i = f"{base}_{i}", i + 1
    used.add(cand)
    return cand


def repo_runner_for(entry: dict) -> str:
    tpl = entry.get("templateId")
    src = entry.get("runnerSource")
    if tpl in (None, "", "none"):
        if src == "browse-only":
            return (
                "{ templateId: 'none', note: 'Browse-only catalog spec \\u2014 this repo has "
                "no runner for it, so pressing Run would train nothing. The mechanism above "
                "is the published algorithm.' }"
            )
        return "null"
    if tpl == "pytorch_mlp":
        return (
            "{ templateId: 'pytorch_mlp', note: 'This repo has no runner for this "
            "architecture. Training this spec renders the generic pytorch_mlp template "
            "\\u2014 a plain MLP over the 35-feature vector, with none of the mechanism "
            "shown above.' }"
        )
    return (
        f"{{ templateId: '{esc(tpl)}', note: 'Trained here through the generic "
        f"{esc(tpl)} template rather than this architecture\\u2019s own implementation.' }}"
    )


def main() -> int:
    cat = json.load(open(SCRATCH / "cat.json", encoding="utf-8"))
    specmap = json.load(open(SCRATCH / "specmap.json", encoding="utf-8"))

    by_arch: dict[str, list[str]] = defaultdict(list)
    skipped: list[tuple[str, str]] = []
    made = 0

    for key, entry in cat.items():
        if key in CURATED_KEYS:
            continue
        name = entry.get("name") or key
        category = entry.get("category") or ""

        rel = specmap.get(key)
        if rel:
            path = ROOT / rel
            md = path.read_text(encoding="utf-8", errors="replace")
            cite = rel
        elif key in REPO_SOURCED:
            md, cite = "", REPO_SOURCED[key]
        else:
            skipped.append((key, "no spec mapping"))
            continue

        stage_src = bullets(section(md, "Algorithm", "Algorithms", "Architecture", "Training"))
        beat_src = bullets(section(md, "Principles", "Key Characteristics", "Overview"))
        if len(stage_src) < 2:
            stage_src = beat_src
        if len(beat_src) < 1:
            beat_src = stage_src

        # Not enough real structure -> report, never pad with filler.
        if len(stage_src) < 2 or len(beat_src) < 1:
            skipped.append((key, f"too little structure (stages={len(stage_src)})"))
            continue

        used: set[str] = set()
        stages = []
        for label, detail in stage_src[:6]:
            sid = slug(label, used)
            d = f", detail: '{esc(detail[:110])}'" if detail else ""
            stages.append(
                f"      {{ id: '{sid}', role: '{role_for(label)}', "
                f"label: '{esc(label[:58])}'{d} }},"
            )
        stage_ids = list(used)

        beats = []
        for i, (label, detail) in enumerate(beat_src[:3]):
            at = stage_ids[min(i, len(stage_ids) - 1)]
            text = detail or label
            beats.append(
                f"      {{ id: 'b{i + 1}', at: '{at}', label: '{esc(label[:52])}', "
                f"detail: '{esc(text[:190])}' }},"
            )

        arch = archetype_for(name, category, md)
        first = clean(stage_src[0][0])
        last = clean(stage_src[min(len(stage_src), 6) - 1][0])
        analogy = f"Information enters at {first.lower()} and ends at {last.lower()}."

        by_arch[arch].append(
            "  {\n"
            f"    catalogKey: '{esc(key)}',\n"
            f"    name: '{esc(name)}',\n"
            f"    archetype: '{arch}',\n"
            f"    provenance: 'schematic',\n"
            f"    specPath: '{esc(cite)}',\n"
            f"    analogy: '{esc(analogy[:150])}',\n"
            "    stages: [\n" + "\n".join(stages) + "\n    ],\n"
            "    beats: [\n" + "\n".join(beats) + "\n    ],\n"
            f"    repoRunner: {repo_runner_for(entry)},\n"
            "    kernelId: null,\n"
            "    curation: 'extracted',\n"
            "  },"
        )
        made += 1

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for arch, items in sorted(by_arch.items()):
        var = re.sub(r"[^a-z0-9]+", "_", arch).upper()
        fname = "".join(w.capitalize() for w in arch.split("-"))
        fname = fname[0].lower() + fname[1:] + "Extracted.ts"
        header = (
            "/**\n"
            f" * {arch} family \\u2014 EXTRACTED entries.\n"
            " *\n"
            " * Generated by scripts/build_mechanism_registry.py. Every stage and beat\n"
            " * below was lifted from the Principles / Algorithm section of the single\n"
            " * markdown spec named in each entry's `specPath`; nothing here is invented.\n"
            " * These carry `curation: 'extracted'` to distinguish them from the\n"
            " * hand-read entries, which carry 'curated'.\n"
            " *\n"
            " * Regenerate rather than hand-editing:\n"
            " *     uv run python scripts/build_mechanism_registry.py\n"
            " */\n\n"
            "import type { MechanismSpec } from './types';\n\n"
            f"export const {var}_EXTRACTED: MechanismSpec[] = [\n"
        )
        (OUT_DIR / fname).write_text(header + "\n".join(items) + "\n];\n", encoding="utf-8")
        print(f"  {fname:44s} {len(items):3d} entries")

    print(f"\nemitted {made} extracted entries across {len(by_arch)} families")
    if skipped:
        print(f"\nSKIPPED {len(skipped)} (reported, not faked):")
        for k, why in skipped:
            print(f"  {k}: {why}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
