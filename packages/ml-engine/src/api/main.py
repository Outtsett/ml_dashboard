import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Quant AI Dashboard", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5000", "http://localhost:5000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/readiness")
async def readiness():
    return {"ready": True, "reason": "FastAPI migration active"}

@app.get("/health")
async def health():
    return {"status": "ok", "uptime": 0}

if __name__ == "__main__":
    # uvloop is only strictly available on Unix, but uvicorn handles it or ignores on Windows.
    # We omit it here since Windows doesn't natively support uvloop.
    uvicorn.run("api.main:app", host="127.0.0.1", port=5000, reload=True)
