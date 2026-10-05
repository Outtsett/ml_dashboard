import os
import duckdb
import logging
from abc import ABC, abstractmethod

logger = logging.getLogger(__name__)

class ILakeService(ABC):
    @abstractmethod
    def connect(self) -> duckdb.DuckDBPyConnection:
        pass

class DuckDBLakeService(ILakeService):
    def __init__(self, lake_path: str):
        self.lake_path = lake_path
        self._conn = None

    def connect(self) -> duckdb.DuckDBPyConnection:
        if self._conn is None:
            try:
                self._conn = duckdb.connect(':memory:')
                logger.info(f"DuckDB attached to lake at {self.lake_path}")
            except Exception as e:
                logger.error(f"Failed to initialize DuckDB lake connection: {e}")
        return self._conn
