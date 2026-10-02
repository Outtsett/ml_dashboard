"""ml_dashboard ml-blocks library -- composable nn.Module building blocks.

Domain-driven flat modules:
- attention.py  -- PositionalEncoding, ALiBiBias, MultiHeadSelfAttention, CrossAttention
- encoder.py    -- MLPEncoder, Conv1DEncoder, TransformerEncoder, TwoStreamPriceVolumeEncoder
- decoder.py    -- MLPDecoder, Conv1DDecoder
- head.py       -- ClassificationHead, BinaryDirectionHead, RegressionHead,
                   RangeBucketHead, VariationalHead
- gating.py     -- TopKGating, SoftmaxGating, HashGating
- fusion.py     -- ConcatFusion, CrossAttentionFusion, GatedFusion
- tft.py        -- GatedLinearUnit, GatedResidualNetwork,
                   VariableSelectionNetwork, InterpretableMultiHeadAttention,
                   TemporalFusionTransformer

Generated PyTorch templates (W3.b: pytorch_mlp / pytorch_cnn / pytorch_autoencoder /
pytorch_vae / transformer_seq) and composite templates (W5: composite_moe /
composite_stacking / composite_voting / composite_multimodal) import from
this package -- the public API surface is the contract.
"""

from core.blocks.attention import (
    ALiBiBias,
    CrossAttention,
    MultiHeadSelfAttention,
    PositionalEncoding,
)
from core.blocks.decoder import (
    Conv1DDecoder,
    MLPDecoder,
)
from core.blocks.encoder import (
    Conv1DEncoder,
    MLPEncoder,
    TransformerEncoder,
    TwoStreamPriceVolumeEncoder,
)
from core.blocks.fusion import (
    ConcatFusion,
    CrossAttentionFusion,
    GatedFusion,
)
from core.blocks.gating import (
    HashGating,
    SoftmaxGating,
    TopKGating,
)
from core.blocks.head import (
    BinaryDirectionHead,
    ClassificationHead,
    RangeBucketHead,
    RegressionHead,
    VariationalHead,
)
from core.blocks.tft import (
    GatedLinearUnit,
    GatedResidualNetwork,
    InterpretableMultiHeadAttention,
    TemporalFusionTransformer,
    VariableSelectionNetwork,
)

__all__ = [
    # attention
    "ALiBiBias",
    "CrossAttention",
    "MultiHeadSelfAttention",
    "PositionalEncoding",
    # decoder
    "Conv1DDecoder",
    "MLPDecoder",
    # encoder
    "Conv1DEncoder",
    "MLPEncoder",
    "TransformerEncoder",
    "TwoStreamPriceVolumeEncoder",
    # fusion
    "ConcatFusion",
    "CrossAttentionFusion",
    "GatedFusion",
    # gating
    "HashGating",
    "SoftmaxGating",
    "TopKGating",
    # head
    "BinaryDirectionHead",
    "ClassificationHead",
    "RangeBucketHead",
    "RegressionHead",
    "VariationalHead",
    # tft
    "GatedLinearUnit",
    "GatedResidualNetwork",
    "InterpretableMultiHeadAttention",
    "TemporalFusionTransformer",
    "VariableSelectionNetwork",
]
