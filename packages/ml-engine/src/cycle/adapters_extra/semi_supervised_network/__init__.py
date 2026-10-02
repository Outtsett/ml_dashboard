"""Semi-supervised networks: the catalog's semi-supervised specs run as Model Cycle direction and price models.

Every key trains one torch network on the fold's training span in two parts:

- a SUPERVISED term on the labelled rows (binary cross-entropy on the up /
  down label for the direction model, Huber on the scaled move for the price
  model), exactly what a plain multilayer perceptron would minimise;
- the variant's UNSUPERVISED term on an unlabelled pool drawn from the same
  training span, weighted by ``unlabeled_weight`` times a ramp.

The unlabelled pool exists because the labels of the training span are masked
in contiguous blocks with an embargo of the label horizon
(``bridges.pool.block_mask``): a seeded ``labeled_fraction`` of the blocks keeps
its labels, the rest (plus the span rows the horizon or gap rule left
unlabelled) form the pool. That deliberately handicaps the model against full
supervision, which is the premise of every spec in this family.

    adapter.py      ``SemiSupervisedNetworkAdapter``: standardisation, the block
                    mask, the shared epoch loop (labelled batches, unlabelled
                    draws, the ramp, cosine learning rate), validation early
                    stopping, the float64 CPU scorer, save / load
    methods.py      the shared network and the discriminative variants:
                    ``pseudo_label`` (Lee 2013), ``consistency`` (Pi-model and
                    Mean Teacher), ``fixmatch``, ``mixmatch``,
                    ``virtual_adversarial`` (VAT), ``entropy_minimization``
    generative.py   the generative and hybrid variants: ``ladder`` (Rasmus et
                    al. 2015), ``generative_discriminative`` (Kingma et al.
                    2014 M2; M1 plus a regression head for the price model),
                    ``k_plus_one_gan`` (Salimans et al. 2016)
    augment.py      the tabular augmentations (Gaussian noise, the strong
                    FixMatch view, MixUp, sharpening)

Causality: the standardisation, the mask, both pools and every weight are fitted
on rows of the training span only (``MarketView.fit_rows``); validation rows set
only the early-stopping epoch; a prediction at bar t reads only row t of the
feature matrix. The unsupervised term draws its randomness from its own seeded
stream (``methods.isolated_random_state``), so with ``unlabeled_weight`` = 0 a
variant trains bit for bit the plain multilayer perceptron it extends.
"""
