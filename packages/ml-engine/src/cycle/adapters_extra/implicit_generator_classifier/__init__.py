"""Implicit generative models (GANs and relatives) turned into direction and price models.

A GAN has no density to evaluate, so it cannot score a bar by itself. Every
key of this family therefore answers "which class does this bar's feature row
look like it was generated from?" in one of three ways (``adapter.py``):

- generated samples (GAN, cGAN, WGAN-GP, BigGAN, StyleGAN, self-supervised
  GAN): the generator learns p(x | class) on the training span, draws exactly
  ``samples_per_class`` rows per class, a classifier is trained on those
  synthetic rows only (train on synthetic, test on real) and the train prior is
  added to its logits: Bayes' rule under the generator's class laws;
- the native head (adversarial autoencoder): the semi-supervised AAE's own
  q(class | x);
- translation displacement (CycleGAN): how far each learned translator moves
  the bar, calibrated on validation.

The classes are the label (down / up) for the direction model and quantile bins
of the price target for the price model (forecast = sum of P(bin) times the
bin's mean train target).
"""
