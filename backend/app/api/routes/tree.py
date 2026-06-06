from fastapi import APIRouter

from app.services.tree_service import build_tree

router = APIRouter(prefix="/api", tags=["tree"])


@router.get("/tree")
def get_tree():
    return build_tree()
