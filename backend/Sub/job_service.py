from __future__ import annotations

import json
import os
import socket
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional
from uuid import uuid4

from backend.Sub.bom_service import (
    BOM_RUNS_DIR,
    build_initial_bom_run,
    process_bom_run,
    store_uploaded_file,
    write_bom_meta,
)

JOBS_DIR = Path(__file__).resolve().parents[1] / "data" / "jobs"
WORKERS_DIR = JOBS_DIR / "workers"
JOBS_DIR.mkdir(parents=True, exist_ok=True)
WORKERS_DIR.mkdir(parents=True, exist_ok=True)

FINAL_STATUSES = {"completed", "failed", "cancelled"}
ACTIVE_STATUSES = {"queued", "claimed", "running"}
DEFAULT_POLL_INTERVAL_SECONDS = 1.5
WORKER_HEARTBEAT_TTL_SECONDS = 10


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _job_path(job_id: str) -> Path:
    return JOBS_DIR / f"{job_id}.json"


def _job_lock_path(job_id: str) -> Path:
    return JOBS_DIR / f"{job_id}.lock"


def _worker_state_path(worker_id: str) -> Path:
    return WORKERS_DIR / f"{worker_id}.json"


def _run_status_path(bom_id: str) -> Path:
    return BOM_RUNS_DIR / bom_id / "processing_status.json"


def _serialize_job(job: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "job_id": job["job_id"],
        "job_type": job["job_type"],
        "bom_id": job["bom_id"],
        "status": job["status"],
        "step": job.get("step"),
        "progress": job.get("progress", 0),
        "message": job.get("message") or "",
        "error_message": job.get("error_message"),
        "original_filename": job.get("original_filename"),
        "created_at": job.get("created_at"),
        "started_at": job.get("started_at"),
        "finished_at": job.get("finished_at"),
        "worker_id": job.get("worker_id"),
    }


def _atomic_write_json(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(f"{path.suffix}.tmp")
    temp_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    temp_path.replace(path)


def _write_run_status(job: Dict[str, Any]) -> None:
    _atomic_write_json(_run_status_path(job["bom_id"]), _serialize_job(job))


def _write_job(job: Dict[str, Any]) -> None:
    _atomic_write_json(_job_path(job["job_id"]), job)
    _write_run_status(job)


def _load_job(job_id: str) -> Dict[str, Any]:
    path = _job_path(job_id)
    if not path.exists():
        raise FileNotFoundError(job_id)
    return json.loads(path.read_text(encoding="utf-8"))


def _update_job(job_id: str, **updates: Any) -> Dict[str, Any]:
    job = _load_job(job_id)
    job.update(updates)
    _write_job(job)
    return job


def get_job(job_id: str) -> Optional[Dict[str, Any]]:
    try:
        return _serialize_job(_load_job(job_id))
    except FileNotFoundError:
        return None


def get_bom_status(bom_id: str) -> Dict[str, Any]:
    status_path = _run_status_path(bom_id)
    if status_path.exists():
        status = json.loads(status_path.read_text(encoding="utf-8"))
        if status.get("status") == "queued" and not has_active_worker():
            status["message"] = "BOM worker가 아직 실행되지 않아 대기 중입니다."
        return status

    root = BOM_RUNS_DIR / bom_id
    if not root.exists():
        return {
            "job_id": None,
            "job_type": "bom_import",
            "bom_id": bom_id,
            "status": "not_found",
            "step": None,
            "progress": 0,
            "message": "해당 BOM 작업을 찾을 수 없습니다.",
            "error_message": None,
            "original_filename": None,
            "created_at": None,
            "started_at": None,
            "finished_at": None,
            "worker_id": None,
        }

    meta_spec_path = root / "meta_spec.json"
    bom_meta_path = root / "bom_meta.json"
    original_filename = None
    if bom_meta_path.exists():
        try:
            original_filename = json.loads(bom_meta_path.read_text(encoding="utf-8")).get("bom_filename")
        except Exception:
            original_filename = None

    if meta_spec_path.exists():
        return {
            "job_id": None,
            "job_type": "bom_import",
            "bom_id": bom_id,
            "status": "completed",
            "step": "completed",
            "progress": 100,
            "message": "BOM 분석이 완료되었습니다.",
            "error_message": None,
            "original_filename": original_filename,
            "created_at": None,
            "started_at": None,
            "finished_at": None,
            "worker_id": None,
        }

    worker_online = has_active_worker()
    return {
        "job_id": None,
        "job_type": "bom_import",
        "bom_id": bom_id,
        "status": "pending",
        "step": None,
        "progress": 0,
        "message": "BOM 분석 대기 중입니다." if worker_online else "BOM worker가 아직 실행되지 않아 대기 중입니다.",
        "error_message": None,
        "original_filename": original_filename,
        "created_at": None,
        "started_at": None,
        "finished_at": None,
        "worker_id": None,
    }


def get_active_workers() -> list[Dict[str, Any]]:
    active_workers: list[Dict[str, Any]] = []
    now = time.time()
    for path in sorted(WORKERS_DIR.glob("*.json")):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue

        heartbeat_ts = float(payload.get("heartbeat_ts") or 0)
        if now - heartbeat_ts <= WORKER_HEARTBEAT_TTL_SECONDS:
            active_workers.append(payload)
    return active_workers


def has_active_worker() -> bool:
    return bool(get_active_workers())


def enqueue_bom_import_job(binary_data: bytes, original_filename: str, owner_sid: Optional[str] = None) -> Dict[str, Any]:
    initial = build_initial_bom_run(original_filename, owner_sid=owner_sid)
    input_file_path = store_uploaded_file(initial["root"], original_filename, binary_data)
    job_id = str(uuid4())
    worker_online = has_active_worker()

    job = {
        "job_id": job_id,
        "job_type": "bom_import",
        "bom_id": initial["bom_id"],
        "root_dir": str(initial["root"]),
        "input_file_path": str(input_file_path),
        "original_filename": original_filename,
        "owner_sid": owner_sid,
        "status": "queued",
        "step": "queued",
        "progress": 0,
        "message": "BOM 분석 작업이 대기열에 등록되었습니다." if worker_online else "BOM 분석 작업이 등록되었습니다. worker 시작을 기다리는 중입니다.",
        "error_message": None,
        "created_at": _utc_now_iso(),
        "started_at": None,
        "finished_at": None,
        "worker_id": None,
    }
    _write_job(job)

    bom_meta = initial["bom_meta"]
    bom_meta.update(
        {
            "job_id": job_id,
            "status": "queued",
        }
    )
    write_bom_meta(initial["root"], bom_meta)
    return _serialize_job(job)


def _try_claim_lock(job_id: str, worker_id: str) -> bool:
    lock_path = _job_lock_path(job_id)
    try:
        fd = os.open(str(lock_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        return False

    try:
        os.write(fd, worker_id.encode("utf-8"))
    finally:
        os.close(fd)
    return True


def _release_lock(job_id: str) -> None:
    lock_path = _job_lock_path(job_id)
    try:
        lock_path.unlink()
    except FileNotFoundError:
        pass


def _job_sort_key(job: Dict[str, Any]) -> tuple[str, str]:
    return (
        str(job.get("created_at") or ""),
        str(job.get("job_id") or ""),
    )


def claim_next_job(worker_id: str) -> Optional[Dict[str, Any]]:
    candidates: list[Dict[str, Any]] = []
    for job_file in JOBS_DIR.glob("*.json"):
        try:
            payload = json.loads(job_file.read_text(encoding="utf-8"))
        except Exception:
            continue

        if payload.get("status") == "queued" and payload.get("job_type") == "bom_import":
            candidates.append(payload)

    candidates.sort(key=_job_sort_key)

    for candidate in candidates:
        job_id = str(candidate["job_id"])
        if not _try_claim_lock(job_id, worker_id):
            continue

        try:
            latest = _load_job(job_id)
            if latest.get("status") != "queued":
                _release_lock(job_id)
                continue

            latest.update(
                {
                    "status": "running",
                    "step": "starting",
                    "progress": 5,
                    "message": "BOM 분석 작업을 시작했습니다.",
                    "started_at": _utc_now_iso(),
                    "finished_at": None,
                    "error_message": None,
                    "worker_id": worker_id,
                }
            )
            _write_job(latest)
            return latest
        except Exception:
            _release_lock(job_id)
            raise

    return None


def requeue_unfinished_jobs() -> None:
    for job_file in sorted(JOBS_DIR.glob("*.json")):
        try:
            job = json.loads(job_file.read_text(encoding="utf-8"))
        except Exception:
            continue

        if job.get("status") in FINAL_STATUSES:
            continue

        job_id = str(job.get("job_id") or "")
        if not job_id:
            continue

        lock_path = _job_lock_path(job_id)
        if lock_path.exists():
            continue

        job.update(
            {
                "status": "queued",
                "step": "queued",
                "progress": 0,
                "message": "worker가 작업을 다시 대기열에 올렸습니다.",
                "error_message": None,
                "started_at": None,
                "finished_at": None,
                "worker_id": None,
            }
        )
        _write_job(job)


def _read_bom_meta(root: Path) -> Dict[str, Any]:
    bom_meta_path = root / "bom_meta.json"
    if not bom_meta_path.exists():
        return {}
    try:
        return json.loads(bom_meta_path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _write_worker_state(
    worker_id: str,
    *,
    status: str,
    current_job_id: Optional[str] = None,
    current_bom_id: Optional[str] = None,
    message: str = "",
) -> None:
    payload = {
        "worker_id": worker_id,
        "pid": os.getpid(),
        "hostname": socket.gethostname(),
        "status": status,
        "current_job_id": current_job_id,
        "current_bom_id": current_bom_id,
        "message": message,
        "heartbeat_at": _utc_now_iso(),
        "heartbeat_ts": time.time(),
    }
    _atomic_write_json(_worker_state_path(worker_id), payload)


def process_claimed_job(job: Dict[str, Any], worker_id: str) -> None:
    job_id = str(job["job_id"])
    root = Path(job["root_dir"])
    binary_data = Path(job["input_file_path"]).read_bytes()

    bom_meta = _read_bom_meta(root)
    bom_meta.update({"job_id": job_id, "status": "running"})
    write_bom_meta(root, bom_meta)

    def progress_callback(step: str, progress: int, message: str) -> None:
        _write_worker_state(
            worker_id,
            status="running",
            current_job_id=job_id,
            current_bom_id=job["bom_id"],
            message=message,
        )
        _update_job(
            job_id,
            status="running",
            step=step,
            progress=progress,
            message=message,
            worker_id=worker_id,
        )

    try:
        process_bom_run(
            bom_id=job["bom_id"],
            root=root,
            binary_data=binary_data,
            original_filename=job["original_filename"],
            progress_callback=progress_callback,
        )
    except Exception as error:
        _update_job(
            job_id,
            status="failed",
            step="failed",
            progress=100,
            message="BOM 분석에 실패했습니다.",
            error_message=str(error),
            finished_at=_utc_now_iso(),
            worker_id=worker_id,
        )
        bom_meta.update({"status": "failed"})
        write_bom_meta(root, bom_meta)
        raise
    finally:
        _release_lock(job_id)

    _update_job(
        job_id,
        status="completed",
        step="completed",
        progress=100,
        message="BOM 분석이 완료되었습니다.",
        finished_at=_utc_now_iso(),
        worker_id=worker_id,
    )
    bom_meta.update({"status": "completed"})
    write_bom_meta(root, bom_meta)


def run_worker_loop(
    *,
    poll_interval_seconds: float = DEFAULT_POLL_INTERVAL_SECONDS,
    once: bool = False,
    worker_id: Optional[str] = None,
) -> None:
    resolved_worker_id = worker_id or f"bom-worker-{uuid4()}"
    requeue_unfinished_jobs()

    while True:
        _write_worker_state(
            resolved_worker_id,
            status="idle",
            message="대기열에서 BOM 작업을 확인하는 중입니다.",
        )
        job = claim_next_job(resolved_worker_id)
        if not job:
            if once:
                break
            time.sleep(poll_interval_seconds)
            continue

        _write_worker_state(
            resolved_worker_id,
            status="running",
            current_job_id=job["job_id"],
            current_bom_id=job["bom_id"],
            message="BOM 분석 작업을 처리하는 중입니다.",
        )

        try:
            process_claimed_job(job, resolved_worker_id)
        except Exception as error:
            _write_worker_state(
                resolved_worker_id,
                status="error",
                current_job_id=job["job_id"],
                current_bom_id=job["bom_id"],
                message=f"작업 실패: {error}",
            )
        else:
            _write_worker_state(
                resolved_worker_id,
                status="idle",
                message="직전 BOM 작업 처리를 완료했습니다.",
            )

        if once:
            break


def create_inline_bom_job(
    binary_data: bytes,
    original_filename: str,
    owner_sid: Optional[str] = None,
):
    """worker_main.py 없이 FastAPI BackgroundTasks로 처리할 때 사용."""
    initial = build_initial_bom_run(original_filename, owner_sid=owner_sid)
    input_file_path = store_uploaded_file(initial["root"], original_filename, binary_data)
    job_id = str(uuid4())
    bom_id = initial["bom_id"]
    root = initial["root"]

    now = _utc_now_iso()
    job: Dict[str, Any] = {
        "job_id": job_id,
        "job_type": "bom_import",
        "bom_id": bom_id,
        "root_dir": str(root),
        "input_file_path": str(input_file_path),
        "original_filename": original_filename,
        "owner_sid": owner_sid,
        "status": "running",
        "step": "starting",
        "progress": 0,
        "message": "BOM 분석을 시작합니다.",
        "error_message": None,
        "created_at": now,
        "started_at": now,
        "finished_at": None,
        "worker_id": "inline",
    }
    _write_job(job)

    bom_meta = initial["bom_meta"]
    bom_meta.update({"job_id": job_id, "status": "running"})
    write_bom_meta(root, bom_meta)

    def _process() -> None:
        def progress_callback(step: str, progress: int, message: str) -> None:
            _update_job(job_id, status="running", step=step, progress=progress, message=message)

        try:
            process_bom_run(
                bom_id=bom_id,
                root=root,
                binary_data=binary_data,
                original_filename=original_filename,
                progress_callback=progress_callback,
            )
        except Exception as error:
            _update_job(
                job_id,
                status="failed",
                step="failed",
                progress=100,
                message="BOM 분석에 실패했습니다.",
                error_message=str(error),
                finished_at=_utc_now_iso(),
            )
            bom_meta.update({"status": "failed"})
            write_bom_meta(root, bom_meta)
            return

        _update_job(
            job_id,
            status="completed",
            step="completed",
            progress=100,
            message="BOM 분석이 완료되었습니다.",
            finished_at=_utc_now_iso(),
        )
        bom_meta.update({"status": "completed"})
        write_bom_meta(root, bom_meta)

    return _serialize_job(job), _process


def run_worker_once(worker_id: Optional[str] = None) -> bool:
    resolved_worker_id = worker_id or f"bom-worker-once-{uuid4()}"
    requeue_unfinished_jobs()
    _write_worker_state(
        resolved_worker_id,
        status="idle",
        message="대기열에서 1회 작업을 확인하는 중입니다.",
    )
    job = claim_next_job(resolved_worker_id)
    if not job:
        return False

    _write_worker_state(
        resolved_worker_id,
        status="running",
        current_job_id=job["job_id"],
        current_bom_id=job["bom_id"],
        message="BOM 분석 작업을 1회 처리하는 중입니다.",
    )
    try:
        process_claimed_job(job, resolved_worker_id)
    except Exception as error:
        _write_worker_state(
            resolved_worker_id,
            status="error",
            current_job_id=job["job_id"],
            current_bom_id=job["bom_id"],
            message=f"작업 실패: {error}",
        )
        return True

    _write_worker_state(
        resolved_worker_id,
        status="idle",
        message="1회 BOM 작업 처리를 완료했습니다.",
    )
    return True
