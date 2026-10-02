"""The ``latent_state_readout`` bridge family: an unsupervised state model read out through its states' history.

Sixteen catalog specs share one mechanism in two stages:

1. **An unsupervised state model** fitted on the training span's feature rows,
   standardised with the training rows' own mean and deviation: a clustering
   (k-means, hierarchical, DBSCAN, mean shift, affinity propagation, spectral),
   a density (Gaussian mixture, Dirichlet-process mixture, a class-conditional
   mixture, a scenario mixture), a self-organising map, an anomaly detector
   (isolation forest, local outlier factor, one-class SVM, robust covariance)
   or a hidden Markov model read through its forward filter.
2. **A readout**: each state's Beta-smoothed training up-rate (direction) or
   shrunk mean scaled move (price), from training rows only. A bar's P(up) is
   the sum over states of its responsibility times that rate.

Modules: ``adapter`` (the Model Cycle adapter), ``common`` (standardising,
projections, nearest neighbours, Gaussian densities), ``readout`` (the
Beta-smoothed state table), ``clustering``, ``mixtures``, ``anomaly``,
``self_organizing_map`` and ``hidden_markov`` (the state models).

Causality: every state model and readout is fitted on training rows (the
labels only through ``train_index``); a prediction at bar t reads the feature
row t alone, except the hidden Markov model, whose forward filter reads rows
<= t. Every fitted state is saved as plain arrays (no pickles), so a reload
predicts exactly what the fitted model predicted.
"""
