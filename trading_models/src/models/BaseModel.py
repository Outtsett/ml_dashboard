import torch
import torch.nn as nn
from abc import ABC, abstractmethod

class BaseModel(nn.Module, ABC):
    """
    Abstract Base Class enforcing the contract for all DDFA ML models.
    Every model must output a mean and variance (Probabilistic Head).
    """
    def __init__(self, config: dict):
        super(BaseModel, self).__init__()
        self.config = config

    @abstractmethod
    def forward(self, x: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        """
        Forward pass.
        Args:
            x (torch.Tensor): Input sequence [Batch, SeqLen, Features]
        Returns:
            mu (torch.Tensor): Expected forward log return [Batch, 1]
            var (torch.Tensor): Predictive uncertainty [Batch, 1]
        """
        pass
