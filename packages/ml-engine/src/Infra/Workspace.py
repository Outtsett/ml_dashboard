import os
import gc
import time
import pynvml
import torch
import logging

logger = logging.getLogger(__name__)

class WorkspaceManager:
    """
    Infra/Workspace: Handles environment setup, artifact initialization,
    and aggressive GPU health checks prior to and during training loops.
    """
    def __init__(self):
        self.max_compute_pct = 50.0
        self.max_vram_pct = 60.0
        
        try:
            pynvml.nvmlInit()
            self.device_count = pynvml.nvmlDeviceGetCount()
            self.gpu_handles = [pynvml.nvmlDeviceGetHandleByIndex(i) for i in range(self.device_count)]
            self.nvml_active = True
        except pynvml.NVMLError:
            logger.warning("NVML not available. GPU throttling disabled.")
            self.nvml_active = False

    def setup_environment(self, symbol: str, timeframe: str, target: str):
        """
        Model Registry Naming: {Symbol}/{Timeframe}/{Target}
        Example: MNQ/1m/RET_LOG_1M
        """
        registry_name = f"{symbol}/{timeframe}/{target}"
        artifact_path = os.path.join(os.getcwd(), "artifacts", registry_name)
        os.makedirs(artifact_path, exist_ok=True)
        
        logger.info(f"Workspace initialized for {registry_name} at {artifact_path}")
        
        # Ensure VRAM is clean before starting
        self.cleanup_trial()
        
        return artifact_path

    def cleanup_trial(self):
        """Explicit trial cleanup for memory preservation."""
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

    def check_gpu_health(self):
        """
        Monitor global GPU Compute Utilization and VRAM.
        NEVER exceed 50% Compute or 60% VRAM.
        """
        if not self.nvml_active:
            return

        for i, handle in enumerate(self.gpu_handles):
            utilization = pynvml.nvmlDeviceGetUtilizationRates(handle)
            memory = pynvml.nvmlDeviceGetMemoryInfo(handle)
            
            compute_pct = utilization.gpu
            vram_pct = (memory.used / memory.total) * 100.0
            
            # Deep Telemetry Logging
            # Log metrics to telemetry system/gpu_compute_pct, system/gpu_vram_pct
            
            if compute_pct > self.max_compute_pct or vram_pct > self.max_vram_pct:
                severity = max(
                    (compute_pct - self.max_compute_pct) / self.max_compute_pct if self.max_compute_pct else 0,
                    (vram_pct - self.max_vram_pct) / self.max_vram_pct if self.max_vram_pct else 0
                )
                sleep_time = min(severity * 2.0, 5.0)  # Max 5s sleep
                logger.warning(f"GPU {i} throttled (Compute: {compute_pct}%, VRAM: {vram_pct:.1f}%). Sleeping {sleep_time:.2f}s")
                time.sleep(sleep_time)

    def adaptive_fluctuation(self, batch_idx: int, check_frequency: int = 5):
        """Frequency of checks: every 5 batches."""
        if batch_idx % check_frequency == 0:
            self.check_gpu_health()
            if batch_idx % (check_frequency * 4) == 0:
                torch.cuda.empty_cache() # VRAM Best Practices interval

workspace = WorkspaceManager()
