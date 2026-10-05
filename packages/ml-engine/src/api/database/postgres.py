import os
import logging
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

logger = logging.getLogger(__name__)

PG_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://postgres:postgres@localhost:5432/ml_dashboard")

try:
    engine = create_async_engine(PG_URL, echo=False)
    AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)
except Exception as e:
    logger.error(f"Failed to initialize PostgreSQL engine: {e}")
    engine = None
    AsyncSessionLocal = None

async def get_db_session() -> AsyncSession: # type: ignore
    if not AsyncSessionLocal:
        yield None
        return
        
    async with AsyncSessionLocal() as session:
        yield session
