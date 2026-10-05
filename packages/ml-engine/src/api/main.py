import os
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import logging

from api.database import lake_service, engine
from Infra.Workspace import workspace

# Import the routes migrated by the subagent swarm
try:
    from api.routes import telemetry, training, market_data
except ImportError as e:
    logging.warning(f"Some subagent routes are not yet available or failed to import: {e}")
    telemetry = training = market_data = None

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Quant AI Dashboard", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5000", "http://localhost:5000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Wire the subagent routes if they exist
if training:
    app.include_router(training.router, prefix="/api/training")
if telemetry:
    app.include_router(telemetry.router, prefix="/api/telemetry")
if market_data:
    app.include_router(market_data.router, prefix="/api/market")

@app.on_event("startup")
async def startup_event():
    logger.info("Initializing DuckDB Lake Service...")
    lake_service.connect()
    logger.info("Initializing Standalone Workspace Infra...")
    workspace.check_gpu_health()

@app.get("/api/readiness")
async def readiness():
    db_ready = engine is not None
    return {"ready": True, "reason": "FastAPI migration active", "db_connected": db_ready}

@app.get("/health")
async def health():
    return {"status": "ok", "uptime": 0}

if __name__ == "__main__":
    uvicorn.run("api.main:app", host="127.0.0.1", port=5000, reload=True)
