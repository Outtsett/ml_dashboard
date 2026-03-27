"""Tests for scaled CNN+Transformer model with dict-based heads."""

import torch
import pytest


def test_model_forward_returns_dict():
    """forward() returns dict keyed by head name."""
    from ml.cnn_transformer.model import CnnTransformerModel

    model = CnnTransformerModel()
    x = torch.randn(2, 128, 5)
    out = model(x)
    assert isinstance(out, dict)
    assert "barrier_class" in out
    assert "vol_regime" in out
    assert "return_bucket" in out


def test_model_output_shapes():
    """Each head produces correct output shape."""
    from ml.cnn_transformer.model import CnnTransformerModel

    model = CnnTransformerModel()
    x = torch.randn(4, 128, 5)
    out = model(x)
    assert out["barrier_class"].shape == (4, 3)
    assert out["vol_regime"].shape == (4, 3)
    assert out["return_bucket"].shape == (4, 8)


def test_model_active_heads():
    """Only active heads are computed when active_heads is specified."""
    from ml.cnn_transformer.model import CnnTransformerModel

    model = CnnTransformerModel()
    x = torch.randn(2, 128, 5)
    out = model(x, active_heads={"barrier_class"})
    assert out["barrier_class"] is not None
    assert out.get("vol_regime") is None
    assert out.get("return_bucket") is None


def test_model_param_count():
    """Model should be approximately 4-10M params."""
    from ml.cnn_transformer.model import CnnTransformerModel

    model = CnnTransformerModel()
    n_params = sum(p.numel() for p in model.parameters())
    assert 4_000_000 < n_params < 10_000_000


def test_model_has_soft_quantization():
    """Model contains a SoftQuantizationLayer module."""
    from ml.cnn_transformer.model import CnnTransformerModel

    model = CnnTransformerModel()
    module_names = [name for name, _ in model.named_modules()]
    assert any("quantiz" in name.lower() for name in module_names)


def test_model_gradient_flows():
    """Gradients flow from all heads back through trunk."""
    from ml.cnn_transformer.model import CnnTransformerModel

    model = CnnTransformerModel()
    x = torch.randn(2, 128, 5)
    out = model(x)
    loss = sum(v.sum() for v in out.values() if v is not None)
    loss.backward()
    # Check CNN block has gradients
    found_grad = False
    for name, param in model.named_parameters():
        if "cnn" in name.lower() and param.requires_grad:
            assert param.grad is not None, f"No gradient for {name}"
            found_grad = True
            break
    assert found_grad, "No CNN parameter found with gradients"


def test_model_small_window():
    """Model works with window_size=32 for fast tests."""
    from ml.cnn_transformer.model import CnnTransformerModel

    model = CnnTransformerModel(window_size=32, d_model=64, n_heads=4, n_layers=2, n_codebook=8)
    x = torch.randn(2, 32, 5)
    out = model(x)
    assert out["barrier_class"].shape == (2, 3)


def test_model_custom_heads():
    """Custom head_configs produces different output dimensions."""
    from ml.cnn_transformer.model import CnnTransformerModel

    model = CnnTransformerModel(head_configs={"direction": 2, "regime": 5})
    x = torch.randn(2, 128, 5)
    out = model(x)
    assert "direction" in out
    assert "regime" in out
    assert out["direction"].shape == (2, 2)
    assert out["regime"].shape == (2, 5)
    assert "barrier_class" not in out
