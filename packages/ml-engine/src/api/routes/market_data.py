from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
import logging

logger = logging.getLogger(__name__)

router = APIRouter()

class DatasetListing(BaseModel):
    name: str
    served: bool

class StudyListing(BaseModel):
    slug: str
    datasets: List[DatasetListing]

class StudiesResponse(BaseModel):
    studies: List[StudyListing]

class StudyDataResponse(BaseModel):
    slug: str
    notes: List[str]
    data: Any

@router.get("/studies", response_model=StudiesResponse)
async def get_studies():
    """
    List every study with the lake views it reads and whether each is served.
    In this implementation, we treat each DuckDB table/view as a study.
    """
    from api.database import lake_service
    
    try:
        conn = lake_service.connect()
        tables = conn.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = 'main'").fetchall()
        
        studies = []
        for (table_name,) in tables:
            studies.append(
                StudyListing(
                    slug=table_name,
                    datasets=[DatasetListing(name=table_name, served=True)]
                )
            )
        return StudiesResponse(studies=studies)
    except Exception as e:
        logger.error(f"Error listing studies: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/studies/{slug}", response_model=StudyDataResponse)
async def get_study(slug: str, request: Request):
    """
    Get one study's body for the parsed query.
    Executes a DuckDB SQL query against the local iceberg lake.
    """
    from api.database import lake_service
    
    try:
        conn = lake_service.connect()
        
        # Verify if the table/view exists to prevent SQL injection or bad requests
        tables = conn.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = 'main'").fetchall()
        table_names = [t[0] for t in tables]
        
        if slug not in table_names:
            raise HTTPException(status_code=404, detail=f'No study named "{slug}".')

        # Extract query parameters for aggregation logic
        params = dict(request.query_params)
        limit = params.get("limit", 1000) # Default limit to prevent massive payload
        
        # Build the aggregation query
        query = f"SELECT * FROM {slug}"
        
        # Add basic limit
        if str(limit).isdigit():
            query += f" LIMIT {limit}"
            
        logger.info(f"Executing study query for '{slug}': {query}")
        df = conn.execute(query).fetchdf()
        
        # Handle datetime and NaN values for JSON serialization
        # Pandas NaN becomes float('nan') which pydantic/fastapi might reject depending on setup
        df = df.fillna(0) # Simple fallback for numeric NaNs
        
        # Convert date/datetime columns to string
        for col in df.select_dtypes(include=['datetime64', 'datetimetz']):
            df[col] = df[col].dt.strftime('%Y-%m-%dT%H:%M:%S.%fZ')
            
        data = df.to_dict(orient="records")
        
        return StudyDataResponse(
            slug=slug,
            notes=[f"Successfully executed query against {slug} with limit {limit}"],
            data=data
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error executing study '{slug}': {e}")
        raise HTTPException(status_code=500, detail=str(e))
