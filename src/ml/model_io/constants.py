"""Constants shared across model I/O modules."""

# 20 visually distinct regime colors (Material Design palette)
REGIME_COLORS = [
    "#4CAF50", "#2196F3", "#FF9800", "#E91E63", "#9C27B0",
    "#00BCD4", "#FFEB3B", "#795548", "#607D8B", "#F44336",
    "#8BC34A", "#3F51B5", "#FF5722", "#009688", "#CDDC39",
    "#673AB7", "#FFC107", "#03A9F4", "#FF4081", "#00E676",
]

# Feature name → (category, positive_description, negative_description)
FEATURE_DESCRIPTIONS = {
    "return_1": ("Returns", "Strong Uptrend", "Sharp Selloff"),
    "return_5": ("5-bar Returns", "Sustained Rally", "Multi-bar Decline"),
    "return_10": ("10-bar Momentum", "Extended Rally", "Extended Decline"),
    "return_20": ("20-bar Trend", "Strong Trend Up", "Strong Trend Down"),
    "volatility_10": ("Short Vol", "Volatile", "Calm"),
    "volatility_20": ("Med Vol", "High Volatility", "Low Volatility"),
    "volatility_50": ("Long Vol", "Turbulent", "Quiet"),
    "parkinson_vol_10": ("Range Vol", "Wide Ranges", "Tight Ranges"),
    "parkinson_vol_20": ("Range Vol 20", "Wide Ranges", "Tight Ranges"),
    "volume_ratio_10": ("Volume", "Heavy Volume", "Light Volume"),
    "volume_ratio_20": ("Volume 20", "Heavy Volume", "Light Volume"),
    "bar_range": ("Bar Size", "Wide Bars", "Narrow Bars"),
    "body_ratio": ("Body Ratio", "Strong Bodies", "Indecisive"),
    "upper_shadow": ("Upper Shadow", "Rejection High", "Clean Highs"),
    "lower_shadow": ("Lower Shadow", "Rejection Low", "Clean Lows"),
    "roc_5": ("ROC 5", "Accelerating", "Decelerating"),
    "roc_10": ("ROC 10", "Accelerating", "Decelerating"),
    "roc_20": ("ROC 20", "Accelerating", "Decelerating"),
    "ma_dist_10": ("MA Distance 10", "Extended Above MA", "Extended Below MA"),
    "ma_dist_20": ("MA Distance 20", "Extended Above MA", "Extended Below MA"),
    "ma_dist_50": ("MA Distance 50", "Extended Above MA", "Extended Below MA"),
}
