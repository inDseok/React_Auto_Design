from typing import Dict, Optional, Any, Tuple
from pathlib import Path
import json
from uuid import uuid4

from fastapi import Request, Response, HTTPException

SESSION_COOKIE = "sid"

BASE_DIR = Path(__file__).resolve().parents[1]  # 프로젝트 루트
DATA_DIR = BASE_DIR / "backend"

SESSION_STORE_PATH = DATA_DIR / "session_state.json"

DATA_DIR.mkdir(parents=True, exist_ok=True)

def load_session_state() -> Dict[str, Dict[str, Optional[str]]]:
    if not SESSION_STORE_PATH.exists():
        return {}
    try:
        return json.loads(SESSION_STORE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}

SESSION_STATE: Dict[str, Dict[str, Optional[str]]] = load_session_state()

def save_session_state() -> None:
    SESSION_STORE_PATH.write_text(
        json.dumps(SESSION_STATE, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )

def refresh_session_state() -> None:
    global SESSION_STATE
    SESSION_STATE = load_session_state()

def get_or_create_sid(request: Request, response: Response) -> str:
    sid = request.cookies.get(SESSION_COOKIE)
    if not sid:
        sid = str(uuid4())
        response.set_cookie(
            key=SESSION_COOKIE,
            value=sid,
            httponly=True,
            samesite="lax",
            path="/",
        )
    return sid

def get_or_init_state(request: Request, response: Response) -> Tuple[str, Dict[str, Any]]:
    sid = get_or_create_sid(request, response)

    refresh_session_state()
    state = SESSION_STATE.get(sid)

    if state is None:
        state = {}
        SESSION_STATE[sid] = state
        save_session_state()

    return sid, state

def require_bom_context(request: Request, response: Response) -> Tuple[str, str, str, Dict[str, Any]]:
    sid, state = get_or_init_state(request, response)
    bom_id = state.get("bom_id")
    spec = state.get("spec")
    if not bom_id or not spec:
        raise HTTPException(400, "bom_id 또는 spec 없음")
    return sid, bom_id, spec, state
