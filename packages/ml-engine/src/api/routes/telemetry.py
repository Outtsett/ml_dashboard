import time
import math
import datetime
import psutil
try:
    import pynvml
except ImportError:
    pynvml = None

from fastapi import APIRouter

router = APIRouter()

# Global state for network bandwidth calculation
last_net_bytes = None
last_net_ts = None

def get_snapshot():
    global last_net_bytes, last_net_ts
    
    # CPU
    cpu_load = psutil.cpu_percent(interval=None)
    cpu_cores = psutil.cpu_percent(interval=None, percpu=True)
    cpu_freq = psutil.cpu_freq()
    
    # Memory
    mem = psutil.virtual_memory()
    swap = psutil.swap_memory()
    
    # Network
    net = psutil.net_io_counters()
    now = time.time()
    
    tx_sec = 0
    rx_sec = 0
    
    if last_net_bytes and last_net_ts:
        dt = now - last_net_ts
        if dt > 0:
            tx_sec = max(0, (net.bytes_sent - last_net_bytes["tx"]) / dt)
            rx_sec = max(0, (net.bytes_recv - last_net_bytes["rx"]) / dt)
            
    last_net_bytes = {"tx": net.bytes_sent, "rx": net.bytes_recv}
    last_net_ts = now

    gpu_data = None
    if pynvml:
        try:
            pynvml.nvmlInit()
            handle = pynvml.nvmlDeviceGetHandleByIndex(0)
            name = pynvml.nvmlDeviceGetName(handle)
            util = pynvml.nvmlDeviceGetUtilizationRates(handle)
            mem_info = pynvml.nvmlDeviceGetMemoryInfo(handle)
            temp = pynvml.nvmlDeviceGetTemperature(handle, pynvml.NVML_TEMPERATURE_GPU)
            power = pynvml.nvmlDeviceGetPowerUsage(handle) / 1000.0
            power_limit = pynvml.nvmlDeviceGetPowerManagementLimit(handle) / 1000.0
            clocks = pynvml.nvmlDeviceGetClockInfo(handle, pynvml.NVML_CLOCK_GRAPHICS)
            mem_clocks = pynvml.nvmlDeviceGetClockInfo(handle, pynvml.NVML_CLOCK_MEM)
            
            try:
                fan_speed = pynvml.nvmlDeviceGetFanSpeed(handle)
            except Exception:
                fan_speed = 0
                
            gpu_data = {
                "name": name,
                "utilizationGpu": util.gpu,
                "utilizationMemory": util.memory,
                "memoryUsedMB": round(mem_info.used / 1024 / 1024, 1),
                "memoryFreeMB": round(mem_info.free / 1024 / 1024, 1),
                "memoryTotalMB": round(mem_info.total / 1024 / 1024, 1),
                "memoryUsedPct": round((mem_info.used / mem_info.total) * 100, 1),
                "temperatureC": temp,
                "powerDrawW": round(power, 1),
                "powerLimitW": round(power_limit, 1),
                "fanSpeedPct": fan_speed,
                "clockGraphicsMHz": clocks,
                "clockMemoryMHz": mem_clocks,
            }
        except Exception:
            pass
            
    snapshot = {
        "cpu": {
            "load": cpu_load,
            "cores": cpu_cores,
            "temp": 0,
            "speed": cpu_freq.current / 1000.0 if cpu_freq else 0,
        },
        "mem": {
            "total": mem.total,
            "active": getattr(mem, "active", mem.used),
            "used": mem.used,
            "swaptotal": swap.total,
            "swapused": swap.used,
        },
        "network": {
            "tx_sec": tx_sec,
            "rx_sec": rx_sec,
        },
        "timestamp": int(now * 1000)
    }
    
    if gpu_data:
        snapshot["gpu"] = gpu_data
        
    return snapshot

# Prime the cpu interval
psutil.cpu_percent(interval=None, percpu=True)


@router.get("/system/matrix")
async def get_system_matrix():
    return get_snapshot()

@router.get("/system/gpu")
async def get_system_gpu():
    snapshot = get_snapshot()
    if "gpu" in snapshot:
        return snapshot["gpu"]
    from fastapi.responses import JSONResponse
    return JSONResponse(status_code=503, content={"error": "GPU telemetry not available"})

@router.get("/system/gpu/info")
async def get_system_gpu_info():
    snapshot = get_snapshot()
    if "gpu" in snapshot:
        g = snapshot["gpu"]
        return {
            "name": g.get("name", "NVIDIA GPU"),
            "driverVersion": "N/A",
            "cudaVersion": "N/A",
            "computeCapability": "N/A",
            "memoryTotalMB": g.get("memoryTotalMB", 0),
            "pciBusId": "N/A",
            "architecture": "NVIDIA"
        }
    from fastapi.responses import JSONResponse
    return JSONResponse(status_code=503, content={"error": "GPU info unavailable"})

@router.get("/system/manifest")
async def get_system_manifest():
    snapshot = get_snapshot()
    
    try:
        load_avg = list(psutil.getloadavg())
    except AttributeError:
        load_avg = [0.0, 0.0, 0.0]
        
    cores = psutil.cpu_count(logical=False) or 0
    threads = psutil.cpu_count(logical=True) or 0
    
    mem = psutil.virtual_memory()
    total_ram_gb = round(mem.total / (1024**3))
    free_ram_gb = round(mem.available / (1024**3))
    
    manifest = {
        "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
        "hardware": {
            "cores": cores,
            "threads": threads,
            "total_ram_gb": total_ram_gb,
            "free_ram_gb": free_ram_gb,
            "load_avg": load_avg
        },
        "infrastructure": {
            "lake": {"connected": False, "row_count": 0, "tables": []},
            "cache": {},
            "storage": {"models_path": "", "size_mb": 0, "free_gb": 0},
        },
        "inventory": {
            "total_models": 0,
            "symbol_coverage": [],
        }
    }
    
    if "gpu" in snapshot:
        manifest["gpu"] = snapshot["gpu"]
        
    return manifest
