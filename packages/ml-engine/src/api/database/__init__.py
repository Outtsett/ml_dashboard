import os
from .lake import DuckDBLakeService, ILakeService
from .postgres import engine, get_db_session

# Dependency Injection / Inversion of Control setup
LAKE_PATH = os.getenv("LAKE_PATH", "E:/lake")
lake_service: ILakeService = DuckDBLakeService(LAKE_PATH)

__all__ = ["lake_service", "engine", "get_db_session", "ILakeService"]
