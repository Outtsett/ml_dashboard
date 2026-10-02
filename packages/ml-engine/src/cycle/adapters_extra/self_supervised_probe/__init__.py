"""Self-supervised representation learning, read out by a linear probe (bridge family ``self_supervised_probe``).

Nineteen catalog specs (denoising autoencoders, contrastive and non-contrastive
siamese methods, masked modelling, predictive coding) share one shape in the
Model Cycle:

1. **Pretext.** An encoder is trained with the spec's own self-supervised
   objective on the unlabelled pool of the fold's training span
   (``cycle.bridges.pool.unlabelled_pool``): every row from ``train_index[0]``
   to ``train_index[-1]`` whose feature history is finite, labelled or not.
   Nothing from the validation or test span is read. The two predictive
   pretexts that look forward (CPC, SPR) take their future targets only from
   rows that are themselves inside that span.
2. **Probe.** The encoder is frozen and a linear head is fitted on the
   labelled training rows (logistic for P(up), Huber for the price model),
   early-stopped on the validation rows.

Modules: ``adapter`` (the Cycle adapter), ``base`` (the pretext contract and
the shared losses), ``encoders`` (MLP, GRU, temporal convolution, patch
transformer, dense graph), ``augment`` (row and window augmentations),
``reconstruction``, ``siamese`` and ``predictive`` (one class per spec) and
``variants`` (variant name -> class).
"""
