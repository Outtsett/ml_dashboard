"""Graph and cluster semi-supervised label inference (bridge family ``graph_label_inference``).

``adapter.GraphLabelInferenceAdapter`` runs label propagation, label spreading,
the harmonic function, Laplacian RLS (manifold regularisation) and seeded
constrained k-means on the training span's bars; ``nodes.py`` holds the
block-masked semi-supervised split (shared with ``pseudo_label_ensemble``),
``graph.py`` the geometry and ``methods.py`` the five methods.
"""
