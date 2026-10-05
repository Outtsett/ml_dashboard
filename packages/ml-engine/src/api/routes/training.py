from fastapi import APIRouter, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, List, Dict, Any, Union

router = APIRouter()

# Models
class DateRange(BaseModel):
    start: str
    end: str

class WalkForward(BaseModel):
    trainMonths: int
    testMonths: int
    stepMonths: Optional[int] = None

class TrainingRequest(BaseModel):
    modelType: str
    symbol: str
    timeframe: Optional[str] = None
    dateRange: Optional[DateRange] = None
    hyperparameters: Optional[Dict[str, Union[int, float, str, bool]]] = None
    maxBars: Optional[int] = None
    featureCategories: Optional[List[str]] = None
    includeIndicators: Optional[bool] = None
    allFeatures: Optional[bool] = None
    indicatorGroups: Optional[str] = None
    walkForward: Optional[WalkForward] = None
    labelSetId: Optional[int] = None

class FeaturePreviewBody(BaseModel):
    symbol: str
    timeframe: str
    pipelineId: str
    sampleBars: Optional[int] = None
    start: Optional[str] = None
    end: Optional[str] = None
    redundancyThreshold: Optional[float] = None

class CycleControl(BaseModel):
    action: str
    payload: Optional[Dict[str, Any]] = None

class TelemetryBody(BaseModel):
    runId: str
    epoch: int
    metrics: Dict[str, Any]

# ─── Config ─────────────────────────────────────────────────────────────────

@router.get("/training/config")
async def get_config():
    return {"dummy_config": True}

@router.post("/training/config/reload")
async def reload_config():
    return {"dummy_config": True}

# ─── Data Preview ──────────────────────────────────────────────────────────

@router.get("/training/data-preview")
async def get_data_preview(
    symbol: str,
    timeframe: str,
    start: Optional[str] = None,
    end: Optional[str] = None
):
    return {
        "symbol": symbol,
        "timeframe": timeframe,
        "table": "dummy_table",
        "totalBars": 0,
        "firstTs": None,
        "lastTs": None,
        "spanDays": None,
        "nullCount": 0,
        "ohlcAnyNullCount": 0,
        "zeroVolumeCount": 0,
        "expectedBars": None,
        "coverageRatio": None,
        "dateRange": {"start": start, "end": end} if start and end else None
    }

# ─── Features Preview ──────────────────────────────────────────────────────

@router.post("/training/features/preview")
async def preview_features(body: FeaturePreviewBody):
    return {
        "success": True,
        "symbol": body.symbol,
        "timeframe": body.timeframe,
        "pipelineId": body.pipelineId
    }

# ─── Metric Descriptions ────────────────────────────────────────────────────

@router.get("/training/metric-descriptions")
async def get_metric_descriptions():
    return {"dummy": "descriptions"}

# ─── Start Training ──────────────────────────────────────────────────────────

@router.post("/training/start")
async def start_training(request: TrainingRequest):
    return {"modelId": "dummy-id", "message": f"Training started for dummy-id ({request.modelType})"}

# ─── SSE Stream ──────────────────────────────────────────────────────────────

@router.get("/training/stream/{modelId}")
async def stream_training(modelId: str, req: Request, from_idx: Optional[int] = Query(0, alias="from")):
    async def dummy_stream():
        yield "event: heartbeat\ndata: {}\n\n"
    return StreamingResponse(dummy_stream(), media_type="text/event-stream")

# ─── Status ──────────────────────────────────────────────────────────────────

@router.get("/training/status")
async def get_status():
    return {"sessions": []}

# ─── Stop Training ───────────────────────────────────────────────────────────

@router.post("/training/stop/{modelId}")
async def stop_training(modelId: str):
    return {"message": f"Stopped training {modelId}"}

# ─── Model Cycle control ────────────────────────────────────────────────────

@router.post("/training/control/{modelId}")
async def control_training(modelId: str, body: CycleControl):
    return {"delivered": True}

# ─── Model Cycle runs ───────────────────────────────────────────────────────

@router.get("/training/cycle")
async def get_cycle_runs():
    return []

@router.get("/training/cycle/{modelId}")
async def get_cycle_snapshot(modelId: str):
    return {"modelId": modelId, "snapshot": "dummy"}

@router.get("/training/cycle/{modelId}/metrics")
async def get_cycle_metrics(modelId: str):
    return {"metrics": "dummy"}

# ─── List trained models ─────────────────────────────────────────────────────

@router.get("/training/models")
async def list_models():
    return {"models": []}

# ─── Diagnostics ─────────────────────────────────────────────────────────────

@router.get("/training/models/{id}/diagnostics")
async def get_model_diagnostics(id: str):
    return {"diagnostics": "dummy"}

# ─── Convergence ─────────────────────────────────────────────────────────────

@router.get("/training/models/{id}/convergence")
async def get_model_convergence(id: str):
    return {"convergence": "dummy"}

# ─── Assignments ─────────────────────────────────────────────────────────────

@router.get("/training/models/{id}/assignments")
async def get_model_assignments(id: str, limit: int = 10000, offset: Optional[int] = None):
    return {"assignments": []}

# ─── SHAP values ─────────────────────────────────────────────────────────────

@router.get("/training/models/{id}/shap")
async def get_model_shap(id: str, regime: Optional[int] = None, limit: int = 10000, offset: Optional[int] = None):
    return {"shap": []}

# ─── Benchmarks ──────────────────────────────────────────────────────────────

@router.get("/training/models/{id}/benchmarks")
async def get_model_benchmarks(id: str):
    return {"benchmarks": "dummy"}

# ─── Model State Snapshots ───────────────────────────────────────────────────

@router.get("/training/models/{id}/model-state")
async def get_model_state(id: str):
    return {"sessionId": "dummy", "iteration": 0, "snapshot": {}}

# ─── Delete model ────────────────────────────────────────────────────────────

@router.delete("/training/models/{id}")
async def delete_model(id: str):
    return {"message": f"Deleted model '{id}'"}

# ─── Persisted Sessions ──────────────────────────────────────────────────────

@router.get("/training/sessions")
async def list_sessions(
    symbol: Optional[str] = None,
    modelType: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 50
):
    return {"sessions": []}

@router.get("/training/sessions/{id}")
async def get_session(id: int):
    return {"id": id, "dummy": True}

# ─── Quality History ─────────────────────────────────────────────────────────

@router.get("/training/history")
async def get_history(symbol: str, modelType: str):
    return {"sessions": []}

# ─── Per-Iteration Metrics ───────────────────────────────────────────────────

@router.get("/training/sessions/{id}/metrics")
async def get_session_metrics(id: int, metricName: Optional[str] = None):
    return {"metrics": []}

@router.get("/training/sessions/{id}/metrics/names")
async def get_session_metric_names(id: int):
    return {"names": []}

# ─── Evaluation Results ──────────────────────────────────────────────────────

@router.get("/training/sessions/{id}/evaluation")
async def get_session_evaluation(id: int, stage: Optional[str] = None):
    return {"results": {}}

@router.get("/training/sessions/{id}/evaluation/summary")
async def get_session_evaluation_summary(id: int):
    return {"summary": {}}

# ─── Walk-Forward Group ──────────────────────────────────────────────────────

@router.get("/training/walk-forward/{groupId}")
async def get_walk_forward_group(groupId: str):
    return {"groupId": groupId, "windows": [], "totalWindows": 0}

# ─── Visualization Registry ──────────────────────────────────────────────────

@router.get("/training/visualizations")
async def get_visualizations():
    return {}

@router.get("/training/visualizations/{category}")
async def get_visualizations_by_category(category: str):
    return {"universal": [], "components": [], "conditional": {}}

# ─── Telemetry ───────────────────────────────────────────────────────────────

@router.post("/training/telemetry")
async def post_telemetry(body: TelemetryBody):
    return {"success": True}

@router.get("/training/telemetry/{run_id}")
async def get_telemetry(run_id: str):
    return []
