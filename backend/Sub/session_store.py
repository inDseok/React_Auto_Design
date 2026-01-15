from typing import Dict, Optional
from backend.Sub.utills import load_session_state, save_session_state

SESSION_STATE: Dict[str, Dict[str, Optional[str]]] = load_session_state()

def save():
    save_session_state()
