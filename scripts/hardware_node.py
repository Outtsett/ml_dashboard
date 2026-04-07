import psutil
import pynvml
import json
import time
import sys
import os
import operator

def get_processes():
    processes = []
    for proc in psutil.process_iter(['pid', 'name', 'cpu_percent', 'memory_info']):
        try:
            pinfo = proc.info
            processes.append({
                "pid": pinfo['pid'],
                "name": pinfo['name'],
                "cpu": pinfo['cpu_percent'],
                "mem": round(pinfo['memory_info'].rss / 1024 / 1024, 1)
            })
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            pass
    
    # Sort by CPU and take top 10
    top_cpu = sorted(processes, key=operator.itemgetter('cpu'), reverse=True)[:10]
    return top_cpu

def get_snapshot():
    try:
        # CPU Metrics
        cpu_load = psutil.cpu_percent(interval=None)
        cpu_cores = psutil.cpu_percent(interval=None, percpu=True)
        cpu_freq = psutil.cpu_freq()
        
        # Memory (active = used on Windows; psutil.virtual_memory().active may be 0)
        mem = psutil.virtual_memory()
        swap = psutil.swap_memory()
        
        # Network
        net = psutil.net_io_counters()
        
        # GPU
        gpu_data = None
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
                "clockMemoryMHz": mem_clocks
            }
        except Exception as e:
            import sys as _sys
            print(f"GPU_ERROR: {e}", file=_sys.stderr, flush=True)

        snapshot = {
            "type": "hardware_node_update",
            "cpu": {
                "load": cpu_load,
                "cores": cpu_cores,
                "temp": 0, # psutil temp is tricky on Windows, we'll use si fallback or 0
                "speed": cpu_freq.current / 1000.0 if cpu_freq else 0
            },
            "mem": {
                "total": mem.total,
                "available": mem.available,
                "used": mem.used,
                "active": getattr(mem, 'active', mem.used),
                "swaptotal": swap.total,
                "swapused": swap.used
            },
            "network": {
                "tx_sec": 0, # Calculated by Node side or we can diff here
                "rx_sec": 0,
                "total_tx": net.bytes_sent,
                "total_rx": net.bytes_recv
            },
            "gpu": gpu_data,
            "processes": get_processes(),
            "timestamp": int(time.time() * 1000)
        }
        return snapshot
    except Exception as e:
        return {"type": "error", "message": str(e)}

# Main loop
# First call returns 0, so prime it
psutil.cpu_percent(interval=None, percpu=True)

while True:
    sys.stdout.write(json.dumps(get_snapshot()) + "\n")
    sys.stdout.flush()
    time.sleep(0.5)
