"""Unit tests for src.ml.blocks -- shape correctness + gradient flow.

Two cases per public class:
  - test_<class>_shape:    feed a known-shape tensor, assert output shape
  - test_<class>_gradient: backward over output.sum(), assert every param has
                           a non-zero grad

Synthesized tensors are used here intentionally -- this is a unit test of
tensor shapes and autograd graph health, not a model-training data integrity
test (per ~/.claude/rules/ml/no-synthetic-data.md, which scopes to training
data, not unit-test sanity tensors).
"""

from __future__ import annotations

import pytest
import torch
from core.blocks import (
    ALiBiBias,
    BinaryDirectionHead,
    ClassificationHead,
    ConcatFusion,
    Conv1DDecoder,
    Conv1DEncoder,
    CrossAttention,
    CrossAttentionFusion,
    GatedFusion,
    HashGating,
    MLPDecoder,
    MLPEncoder,
    MultiHeadSelfAttention,
    PositionalEncoding,
    RangeBucketHead,
    RegressionHead,
    SoftmaxGating,
    TopKGating,
    TransformerEncoder,
    TwoStreamPriceVolumeEncoder,
    VariationalHead,
)

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _assert_grads_flowed(module: torch.nn.Module) -> None:
    """Assert every trainable parameter has a non-None, non-zero gradient.

    Buffers (registered via register_buffer) are NOT checked -- they are not
    trainable.
    """
    n_checked = 0
    for name, p in module.named_parameters():
        if not p.requires_grad:
            continue
        assert p.grad is not None, f"param {name!r} has grad=None after backward"
        assert torch.isfinite(p.grad).all(), f"param {name!r} grad has non-finite values"
        assert p.grad.abs().max().item() > 0, f"param {name!r} grad is exactly zero"
        n_checked += 1
    # If the module has zero trainable params (e.g. HashGating uses only buffers),
    # the test should still skip gracefully — caller should not invoke this helper.
    assert n_checked > 0, "no trainable parameters were checked"


# ---------------------------------------------------------------------------
# attention.PositionalEncoding
# ---------------------------------------------------------------------------

def test_positional_encoding_shape():
    pe = PositionalEncoding(d_model=64, max_len=128)
    x = torch.randn(8, 32, 64)
    y = pe(x)
    assert y.shape == (8, 32, 64)


def test_positional_encoding_gradient():
    pe = PositionalEncoding(d_model=64, max_len=128)
    x = torch.randn(2, 16, 64, requires_grad=True)
    y = pe(x)
    y.sum().backward()
    # PositionalEncoding has no trainable params (the PE buffer is a buffer),
    # but the input tensor should have a flowed grad.
    assert x.grad is not None
    assert x.grad.abs().max().item() > 0


# ---------------------------------------------------------------------------
# attention.ALiBiBias
# ---------------------------------------------------------------------------

def test_alibi_bias_shape():
    alibi = ALiBiBias(n_heads=4, max_seq_len=64)
    bias = alibi(batch_size=2, seq_len=16)
    assert bias.shape == (2 * 4, 16, 16)


def test_alibi_bias_no_trainable_params():
    # ALiBi is a fixed-bias module (no trainable parameters by design).
    # Verify there are zero trainable params and bias finite.
    alibi = ALiBiBias(n_heads=4, max_seq_len=64)
    n_trainable = sum(p.numel() for p in alibi.parameters() if p.requires_grad)
    assert n_trainable == 0
    bias = alibi(batch_size=2, seq_len=16)
    assert torch.isfinite(bias).all()
    # diag = 0 (i==j) and bias[0,j!=i] strictly negative
    assert (bias.diagonal(dim1=-2, dim2=-1) == 0).all()


# ---------------------------------------------------------------------------
# attention.MultiHeadSelfAttention
# ---------------------------------------------------------------------------

def test_mhsa_shape():
    mhsa = MultiHeadSelfAttention(d_model=64, n_heads=4, dropout=0.0)
    x = torch.randn(8, 32, 64)
    y = mhsa(x)
    assert y.shape == (8, 32, 64)


def test_mhsa_gradient():
    mhsa = MultiHeadSelfAttention(d_model=64, n_heads=4, dropout=0.0)
    x = torch.randn(4, 16, 64)
    y = mhsa(x)
    y.sum().backward()
    _assert_grads_flowed(mhsa)


# ---------------------------------------------------------------------------
# attention.CrossAttention
# ---------------------------------------------------------------------------

def test_cross_attention_shape():
    ca = CrossAttention(d_model_q=64, d_model_kv=32, n_heads=4, dropout=0.0)
    q = torch.randn(8, 16, 64)
    kv = torch.randn(8, 24, 32)
    y = ca(q, kv)
    assert y.shape == (8, 16, 64)


def test_cross_attention_gradient():
    ca = CrossAttention(d_model_q=64, d_model_kv=32, n_heads=4, dropout=0.0)
    q = torch.randn(4, 8, 64)
    kv = torch.randn(4, 12, 32)
    y = ca(q, kv)
    y.sum().backward()
    _assert_grads_flowed(ca)


# ---------------------------------------------------------------------------
# encoder.MLPEncoder
# ---------------------------------------------------------------------------

def test_mlp_encoder_shape():
    enc = MLPEncoder(in_dim=32, hidden_dims=[64, 64], out_dim=16, dropout=0.0)
    x = torch.randn(8, 32)
    y = enc(x)
    assert y.shape == (8, 16)


def test_mlp_encoder_gradient():
    enc = MLPEncoder(in_dim=32, hidden_dims=[64, 64], out_dim=16, dropout=0.0)
    x = torch.randn(4, 32)
    y = enc(x)
    y.sum().backward()
    _assert_grads_flowed(enc)


# ---------------------------------------------------------------------------
# encoder.Conv1DEncoder
# ---------------------------------------------------------------------------

def test_conv1d_encoder_shape():
    enc = Conv1DEncoder(
        in_channels=5, channels=[16, 32, 64], kernel_sizes=[3, 5, 7], dropout=0.0
    )
    x = torch.randn(8, 64, 5)  # (B, T, C_in)
    y = enc(x)
    assert y.shape == (8, 64, 64)


def test_conv1d_encoder_gradient():
    enc = Conv1DEncoder(
        in_channels=5, channels=[16, 32], kernel_sizes=[3, 5], dropout=0.0
    )
    x = torch.randn(4, 32, 5)
    y = enc(x)
    y.sum().backward()
    _assert_grads_flowed(enc)


# ---------------------------------------------------------------------------
# encoder.TransformerEncoder
# ---------------------------------------------------------------------------

def test_transformer_encoder_shape():
    enc = TransformerEncoder(
        d_model=64, n_heads=4, n_layers=2, d_ff=128, dropout=0.0, max_seq_len=128
    )
    x = torch.randn(8, 32, 64)
    y = enc(x)
    assert y.shape == (8, 32, 64)


def test_transformer_encoder_gradient():
    enc = TransformerEncoder(
        d_model=64, n_heads=4, n_layers=2, d_ff=128, dropout=0.0, max_seq_len=128
    )
    x = torch.randn(2, 16, 64)
    y = enc(x)
    y.sum().backward()
    _assert_grads_flowed(enc)


# ---------------------------------------------------------------------------
# encoder.TwoStreamPriceVolumeEncoder
# ---------------------------------------------------------------------------

def test_two_stream_encoder_shape():
    enc = TwoStreamPriceVolumeEncoder(
        window_size=64,
        d_model_price=112,
        d_model_vol=16,
        n_heads=4,
        n_layers=2,
        d_ff=128,
        dropout=0.0,
    )
    # Use realistic price-like tensor with positive close prices so the
    # ref-close clamp doesn't kick in.
    x_price = torch.randn(8, 64, 4) * 0.01 + 21000.0  # (B, T, OHLC)
    x_vol = torch.rand(8, 64, 1) * 1000.0
    y = enc(x_price, x_vol)
    assert y.shape == (8, 64, 128)


def test_two_stream_encoder_gradient():
    enc = TwoStreamPriceVolumeEncoder(
        window_size=32,
        d_model_price=48,
        d_model_vol=16,
        n_heads=4,
        n_layers=1,
        d_ff=64,
        dropout=0.0,
    )
    x_price = torch.randn(4, 32, 4) * 0.01 + 21000.0
    x_vol = torch.rand(4, 32, 1) * 1000.0
    y = enc(x_price, x_vol)
    y.sum().backward()
    _assert_grads_flowed(enc)


# ---------------------------------------------------------------------------
# decoder.MLPDecoder
# ---------------------------------------------------------------------------

def test_mlp_decoder_shape():
    dec = MLPDecoder(in_dim=16, hidden_dims=[64, 64], out_dim=32, dropout=0.0)
    x = torch.randn(8, 16)
    y = dec(x)
    assert y.shape == (8, 32)


def test_mlp_decoder_gradient():
    dec = MLPDecoder(in_dim=16, hidden_dims=[64, 64], out_dim=32, dropout=0.0)
    x = torch.randn(4, 16)
    y = dec(x)
    y.sum().backward()
    _assert_grads_flowed(dec)


# ---------------------------------------------------------------------------
# decoder.Conv1DDecoder
# ---------------------------------------------------------------------------

def test_conv1d_decoder_shape():
    dec = Conv1DDecoder(
        in_channels=64, channels=[32, 16, 5], kernel_sizes=[7, 5, 3], dropout=0.0
    )
    x = torch.randn(8, 64, 64)  # (B, T, C_in)
    y = dec(x)
    assert y.shape == (8, 64, 5)


def test_conv1d_decoder_gradient():
    dec = Conv1DDecoder(
        in_channels=32, channels=[16, 5], kernel_sizes=[5, 3], dropout=0.0
    )
    x = torch.randn(4, 32, 32)
    y = dec(x)
    y.sum().backward()
    _assert_grads_flowed(dec)


# ---------------------------------------------------------------------------
# head.ClassificationHead
# ---------------------------------------------------------------------------

def test_classification_head_shape():
    head = ClassificationHead(in_dim=64, n_classes=10)
    x = torch.randn(8, 64)
    y = head(x)
    assert y.shape == (8, 10)
    # log-softmax: exp(y).sum(-1) should be ~1
    assert torch.allclose(y.exp().sum(dim=-1), torch.ones(8), atol=1e-5)


def test_classification_head_gradient():
    head = ClassificationHead(in_dim=64, n_classes=10)
    x = torch.randn(4, 64)
    y = head(x)
    y.sum().backward()
    _assert_grads_flowed(head)


# ---------------------------------------------------------------------------
# head.BinaryDirectionHead
# ---------------------------------------------------------------------------

def test_binary_direction_head_shape():
    head = BinaryDirectionHead(in_dim=64)
    x = torch.randn(8, 64)
    y = head(x)
    assert y.shape == (8, 2)


def test_binary_direction_head_gradient():
    head = BinaryDirectionHead(in_dim=64)
    x = torch.randn(4, 64)
    y = head(x)
    y.sum().backward()
    _assert_grads_flowed(head)


# ---------------------------------------------------------------------------
# head.RegressionHead
# ---------------------------------------------------------------------------

def test_regression_head_shape():
    head = RegressionHead(in_dim=64, out_dim=3)
    x = torch.randn(8, 64)
    y = head(x)
    assert y.shape == (8, 3)


def test_regression_head_gradient():
    head = RegressionHead(in_dim=64, out_dim=3)
    x = torch.randn(4, 64)
    y = head(x)
    y.sum().backward()
    _assert_grads_flowed(head)


# ---------------------------------------------------------------------------
# head.RangeBucketHead
# ---------------------------------------------------------------------------

def test_range_bucket_head_shape():
    head = RangeBucketHead(in_dim=128, n_buckets=21)
    x = torch.randn(8, 128)
    y = head(x)
    assert y.shape == (8, 21)
    assert torch.allclose(y.exp().sum(dim=-1), torch.ones(8), atol=1e-5)


def test_range_bucket_head_gradient():
    head = RangeBucketHead(in_dim=128, n_buckets=21)
    x = torch.randn(4, 128)
    y = head(x)
    y.sum().backward()
    _assert_grads_flowed(head)


# ---------------------------------------------------------------------------
# head.VariationalHead
# ---------------------------------------------------------------------------

def test_variational_head_shape():
    head = VariationalHead(in_dim=64, latent_dim=16)
    x = torch.randn(8, 64)
    mu, logvar = head(x)
    assert mu.shape == (8, 16)
    assert logvar.shape == (8, 16)
    z = VariationalHead.reparameterize(mu, logvar)
    assert z.shape == (8, 16)


def test_variational_head_gradient():
    head = VariationalHead(in_dim=64, latent_dim=16)
    x = torch.randn(4, 64)
    mu, logvar = head(x)
    z = VariationalHead.reparameterize(mu, logvar)
    # Backward through reparameterized z exercises both mu and logvar branches.
    z.sum().backward()
    _assert_grads_flowed(head)


# ---------------------------------------------------------------------------
# gating.TopKGating
# ---------------------------------------------------------------------------

def test_topk_gating_shape():
    gate = TopKGating(d_model=64, n_experts=8, k=2, temperature=1.0)
    x = torch.randn(16, 64)
    gates, top_k_idx, top_k_w = gate(x)
    assert gates.shape == (16, 8)
    assert top_k_idx.shape == (16, 2)
    assert top_k_w.shape == (16, 2)
    # Top-K weights sum to 1 within selection
    assert torch.allclose(top_k_w.sum(dim=-1), torch.ones(16), atol=1e-5)
    # Full gates sum to 1 too (mass concentrated on top-K)
    assert torch.allclose(gates.sum(dim=-1), torch.ones(16), atol=1e-5)


def test_topk_gating_gradient():
    gate = TopKGating(d_model=64, n_experts=8, k=2, temperature=1.0)
    x = torch.randn(8, 64)
    gates, _, _ = gate(x)
    # NOTE: do NOT use gates.sum() as the objective. Each row of `gates` is a
    # softmax and sums to exactly 1, so gates.sum() is the constant B and its
    # true gradient is zero -- the test would then assert on float rounding
    # noise (and fails outright when that noise cancels exactly). Weighting by
    # a fixed random vector breaks the degeneracy and probes a real gradient.
    torch.manual_seed(0)
    (gates * torch.randn_like(gates)).sum().backward()
    _assert_grads_flowed(gate)


# ---------------------------------------------------------------------------
# gating.SoftmaxGating
# ---------------------------------------------------------------------------

def test_softmax_gating_shape():
    gate = SoftmaxGating(d_model=64, n_experts=8, temperature=1.0)
    x = torch.randn(16, 64)
    g = gate(x)
    assert g.shape == (16, 8)
    assert torch.allclose(g.sum(dim=-1), torch.ones(16), atol=1e-5)


def test_softmax_gating_gradient():
    gate = SoftmaxGating(d_model=64, n_experts=8, temperature=1.0)
    x = torch.randn(8, 64)
    g = gate(x)
    # Same degeneracy as the top-K case: a softmax row sums to 1, so g.sum()
    # is constant and carries no gradient signal. Weight it to probe a real one.
    torch.manual_seed(0)
    (g * torch.randn_like(g)).sum().backward()
    _assert_grads_flowed(gate)


# ---------------------------------------------------------------------------
# gating.HashGating
# ---------------------------------------------------------------------------

def test_hash_gating_shape():
    gate = HashGating(n_experts=8, hash_dim=32, seed=42)
    x = torch.randn(16, 64)
    g = gate(x)
    assert g.shape == (16, 8)
    # One-hot: each row sums to 1, each entry is 0 or 1
    assert torch.allclose(g.sum(dim=-1), torch.ones(16))
    assert ((g == 0) | (g == 1)).all()


def test_hash_gating_no_trainable_params():
    # HashGating is a fixed router (no trainable parameters by design).
    gate = HashGating(n_experts=8, hash_dim=32, seed=42)
    n_trainable = sum(p.numel() for p in gate.parameters() if p.requires_grad)
    assert n_trainable == 0


# ---------------------------------------------------------------------------
# fusion.ConcatFusion
# ---------------------------------------------------------------------------

def test_concat_fusion_shape():
    fuse = ConcatFusion(d_in_list=[32, 16, 24], d_out=64)
    mods = [torch.randn(8, 32), torch.randn(8, 16), torch.randn(8, 24)]
    y = fuse(mods)
    assert y.shape == (8, 64)


def test_concat_fusion_gradient():
    fuse = ConcatFusion(d_in_list=[32, 16, 24], d_out=64)
    mods = [torch.randn(4, 32), torch.randn(4, 16), torch.randn(4, 24)]
    y = fuse(mods)
    y.sum().backward()
    _assert_grads_flowed(fuse)


# ---------------------------------------------------------------------------
# fusion.CrossAttentionFusion
# ---------------------------------------------------------------------------

def test_cross_attention_fusion_shape():
    fuse = CrossAttentionFusion(d_query=64, d_kv_list=[32, 16], n_heads=4)
    q = torch.randn(8, 64)
    mods = [torch.randn(8, 32), torch.randn(8, 16)]
    y = fuse(q, mods)
    assert y.shape == (8, 64)


def test_cross_attention_fusion_gradient():
    fuse = CrossAttentionFusion(d_query=64, d_kv_list=[32, 16], n_heads=4)
    q = torch.randn(4, 64)
    mods = [torch.randn(4, 32), torch.randn(4, 16)]
    y = fuse(q, mods)
    y.sum().backward()
    _assert_grads_flowed(fuse)


# ---------------------------------------------------------------------------
# fusion.GatedFusion
# ---------------------------------------------------------------------------

def test_gated_fusion_shape():
    fuse = GatedFusion(d_in_list=[32, 16, 24], d_out=64)
    mods = [torch.randn(8, 32), torch.randn(8, 16), torch.randn(8, 24)]
    y = fuse(mods)
    assert y.shape == (8, 64)


def test_gated_fusion_gradient():
    fuse = GatedFusion(d_in_list=[32, 16, 24], d_out=64)
    mods = [torch.randn(4, 32), torch.randn(4, 16), torch.randn(4, 24)]
    y = fuse(mods)
    y.sum().backward()
    _assert_grads_flowed(fuse)


# ---------------------------------------------------------------------------
# defensive validation tests (each module's __init__ rejects bad args)
# ---------------------------------------------------------------------------

def test_input_validation_smoke():
    """Each block module rejects malformed args -- sample one per module."""
    with pytest.raises(ValueError):
        MLPEncoder(in_dim=0, hidden_dims=[16], out_dim=4)
    with pytest.raises(ValueError):
        Conv1DEncoder(in_channels=4, channels=[8, 16], kernel_sizes=[3])
    with pytest.raises(ValueError):
        TransformerEncoder(d_model=10, n_heads=3, n_layers=1, d_ff=8)  # 10 % 3 != 0
    with pytest.raises(ValueError):
        TwoStreamPriceVolumeEncoder(d_model_price=15, d_model_vol=2, n_heads=4)
    with pytest.raises(ValueError):
        ClassificationHead(in_dim=8, n_classes=1)
    with pytest.raises(ValueError):
        VariationalHead(in_dim=8, latent_dim=0)
    with pytest.raises(ValueError):
        TopKGating(d_model=16, n_experts=4, k=5)  # k > n_experts
    with pytest.raises(ValueError):
        ConcatFusion(d_in_list=[], d_out=16)
