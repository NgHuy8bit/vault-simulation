from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import files, run, scenarios, specs, tree
from app.core.config import APP_NAME


def create_app() -> FastAPI:
    app = FastAPI(title=APP_NAME)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:5173",
            "http://127.0.0.1:5173",
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(tree.router)
    app.include_router(files.router)
    app.include_router(scenarios.router)
    app.include_router(specs.router)
    app.include_router(run.router)
    return app


app = create_app()
