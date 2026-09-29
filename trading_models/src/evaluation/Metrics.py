import torch
import torch.nn as nn

class GaussianNLLLoss(nn.Module):
    """
    Computes the Negative Log-Likelihood of the target under a Gaussian distribution
    parameterized by the model's predicted Mean (mu) and Variance (var).
    This forces the model to learn "Honesty" (Uncertainty).
    """
    def __init__(self):
        super(GaussianNLLLoss, self).__init__()

    def forward(self, mu: torch.Tensor, var: torch.Tensor, target: torch.Tensor) -> torch.Tensor:
        # NLL = 0.5 * (log(var) + (target - mu)^2 / var) + const
        loss = 0.5 * (torch.log(var) + ((target - mu) ** 2) / var)
        return torch.mean(loss)

def compute_expertise_rmse(mu: torch.Tensor, target: torch.Tensor) -> float:
    """
    Semantic Metric: Expertise (Raw predictive accuracy ignoring confidence).
    """
    with torch.no_grad():
        mse = torch.mean((mu - target) ** 2)
        return torch.sqrt(mse).item()

def compute_honesty_uncertainty(var: torch.Tensor) -> float:
    """
    Semantic Metric: Honesty (Average predicted variance/uncertainty).
    """
    with torch.no_grad():
        return torch.mean(var).item()
