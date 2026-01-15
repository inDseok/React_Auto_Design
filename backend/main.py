from __future__ import annotations

from backend.Sub.session_excel import get_or_create_sid, SessionState
from typing import Dict, List, Optional, Any

import json
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request, Response, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles

from pathlib import Path

from backend.Sub.utills import load_session_state, save_session_state
from backend.Sub.bom_service import create_bom_run, DATA_DIR
from backend.sub_router import sub_router
from backend.Assembly_router import router as assembly_router

app = FastAPI()

app.include_router(sub_router, prefix="/api")
app.include_router(assembly_router, prefix="/api")

templates = Jinja2Templates(directory="frontend/template")
app.mount("/static", StaticFiles(directory="frontend/static"), name="static")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # 프론트 주소
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


DATA_DIR = Path("backend/data")

SESSION_STORE_PATH = DATA_DIR / "session_state.json"
SESSION_STATE: Dict[str, Dict[str, Optional[str]]] = load_session_state()



@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return Response(status_code=204)


@app.post("/api/state", response_model=SessionState)
def set_state(payload: dict, request: Request, response: Response):
    sid = get_or_create_sid(request, response)

    prev = SESSION_STATE.get(sid, {})

    # core 키만 유지
    allowed_keys = {"bom_id", "spec", "selected_id"}

    # payload에서 core 키만 반영
    filtered_payload = {k: v for k, v in payload.items() if k in allowed_keys}

    next_state = {**prev, **filtered_payload}

    SESSION_STATE[sid] = next_state
    save_session_state()

    return SessionState(**next_state)



@app.get("/api/state", response_model=SessionState)
def get_state(request: Request, response: Response):
    sid = get_or_create_sid(request, response)
    state = SESSION_STATE.get(sid, {})
    print("[SESSION_STATE]", SESSION_STATE)
    return SessionState(
        bom_id=state.get("bom_id"),
        spec=state.get("spec"),
        selected_id=state.get("selected_id"),
    )

