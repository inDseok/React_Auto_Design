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

app = FastAPI()

app.include_router(sub_router, prefix="/api")

templates = Jinja2Templates(directory="frontend/template")
app.mount("/static", StaticFiles(directory="frontend/static"), name="static")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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

    # 기존 상태 가져오기 (없으면 빈 dict)
    prev = SESSION_STATE.get(sid, {})
    print("[SESSION_STATE]", SESSION_STATE)
    # merge 규칙:
    # payload에 있는 값만 갱신
    # payload에 없으면 기존 값 유지
    next_state = {
        "bom_id": payload["bom_id"] if "bom_id" in payload else prev.get("bom_id"),
        "spec": payload["spec"] if "spec" in payload else prev.get("spec"),
        "selected_id": payload["selected_id"] if "selected_id" in payload else prev.get("selected_id"),
    }

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

