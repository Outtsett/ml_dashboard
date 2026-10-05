from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

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
    """
    # Dummy data mirroring the Express listing endpoint
    return StudiesResponse(
        studies=[
            StudyListing(
                slug="sample-study",
                datasets=[
                    DatasetListing(name="example-view-1", served=True),
                    DatasetListing(name="example-view-2", served=False)
                ]
            )
        ]
    )

@router.get("/studies/{slug}", response_model=StudyDataResponse)
async def get_study(slug: str, request: Request):
    """
    Get one study's body for the parsed query.
    """
    # Dummy 404 response for testing
    if slug == "not-found":
        raise HTTPException(status_code=404, detail=f'No study named "{slug}".')

    # Dummy response mirroring the Express study execution endpoint
    return StudyDataResponse(
        slug=slug,
        notes=["This is a dummy note indicating successful mock execution."],
        data={
            "status": "success",
            "query_params": dict(request.query_params)
        }
    )
