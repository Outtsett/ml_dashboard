import os
import torch
import pynvml
import time
import logging

class WorkspaceManager:
    """
    Handles global hardware state, adaptive throttling, and reproducibility seeding.
    """
    def __init__(self, config: dict):
        self.config = config
        self.logger = logging.getLogger("Workspace")
        self._init_nvml()
        self._set_seeds()

    def _init_nvml(self):
        try:
            pynvml.nvmlInit()
            self.gpu_handle = pynvml.nvmlDeviceGetHandleByIndex(0)
            self.logger.info("NVML Initialized. GPU 0 ready.")
        except Exception as e:
            self.logger.warning(f"Could not initialize NVML: {e}")
            self.gpu_handle = None

    def _set_seeds(self, seed=42):
        torch.manual_seed(seed)
        if torch.cuda.is_available():
            torch.cuda.manual_seed_all(seed)

    def adaptive_throttle(self):
        """
        Enforces maximum VRAM and Compute percentage constraints.
        If exceeded, aggressively sleeps to free up UI resources.
        """
        if not self.gpu_handle:
            return

        try:
            mem_info = pynvml.nvmlDeviceGetMemoryInfo(self.gpu_handle)
            util_info = pynvml.nvmlDeviceGetUtilizationRates(self.gpu_handle)
            
            vram_pct = (mem_info.used / mem_info.total) * 100
            compute_pct = util_info.gpu
            
            max_vram = self.config['hardware'].get('max_vram_pct', 60)
            max_comp = self.config['hardware'].get('max_compute_pct', 50)

            throttle_time = 0.0
            
            if compute_pct > max_comp:
                # Proportional throttle: 10% over -> 0.1s sleep, 50% over -> 0.5s sleep
                throttle_time += (compute_pct - max_comp) * 0.01
                
            if vram_pct > max_vram:
                import torch
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
                throttle_time += 0.2

            if throttle_time > 0:
                if vram_pct > 95:
                    self.logger.warning(f"CRITICAL VRAM {vram_pct:.0f}% — flushing cache + sleeping {throttle_time:.2f}s")
                import time
                time.sleep(throttle_time)
                
        except Exception as e:
            self.logger.error(f"Error reading GPU stats: {e}")

    def cleanup(self):
        """Forces garbage collection and VRAM cache clear between epochs/trials."""
        import gc
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
