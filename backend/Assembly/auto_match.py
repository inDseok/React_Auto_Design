from typing import Dict, List, Optional, Any, Tuple
from pathlib import Path
import json
import re

import pandas as pd
from rapidfuzz import fuzz
import jellyfish

from fastapi import APIRouter, HTTPException

# 당신 프로젝트에 이미 존재하는 것들(경로/세션 유틸)
# - DATA_DIR
# - SESSION_STATE
# - get_or_create_sid
# - save_session_state
# 이 import 경로는 프로젝트에 맞게 조정하세요.
# from ...utils.session import get_or_create_sid, save_session_state, SESSION_STATE
# from ...config import DATA_DIR

router = APIRouter(prefix="/api/assembly", tags=["assembly"])

# =========================
# 설정
# =========================
EXCEL_HEADER_ROW = 1
ONLY_INHOUSE = True
TOPK = 5
JW_THRESHOLD = 90.0

STOP_TOKENS = {
    "LH", "RH", "STD", "ECE", "LHD", "RHD", "LD", "HD", "EC",
    "LEFT", "RIGHT",
    "TYPE", "TYP", "ASSY", "S/A",
}

SYN_MAP = {
    "BPR": "BUMPER",
    "BUMPER": "BUMPER",
    "BRKT": "BRACKET",
    "BRACKET": "BRACKET",
    "HSG": "HOUSING",
    "HOUSING": "HOUSING",
    "INR": "INNER",
    "INNER": "INNER",
    "OTR": "MAIN",
    "OUTER": "MAIN",
    "EXTN": "EXTENSION",
    "EXT": "EXTENSION",
    "EXTENSION": "EXTENSION",
    "WIRG": "WIRING",
    "WIRING": "WIRING",
    "WIRE": "WIRING",
    "TURN": "T/SIG",
    "SIGNAL": "",
}

ASSEMBLY_COLUMNS = [
    "부품 기준", "요소작업", "OPTION", "작업자", "no", "동작요소", "반복횟수", "SEC", "TOTAL"
]


# =========================
# 텍스트 정규화
# =========================
def normalize_text(s: Any) -> str:
    if s is None:
        return ""

    s = str(s).strip()
    if not s:
        return ""

    # [] 안 제거 (요구사항 반영)
    s = re.sub(r"\[[^\]]*\]", " ", s)

    s = s.replace("-", " ").replace("_", " ")
    s = s.upper()
    s = re.sub(r"[^A-Z0-9/ ]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()

    tokens = s.split(" ")
    out: List[str] = []

    for t in tokens:
        if not t:
            continue
        # STOP_TOKENS 만나면 이후 토큰은 버림 (당신 기존 로직)
        if t in STOP_TOKENS:
            break
        if t in SYN_MAP:
            t = SYN_MAP[t]
        if t:
            out.append(t)

    return " ".join(out).strip()


# =========================
# 점수 함수들
# =========================
def rf_score(a: str, b: str) -> float:
    # rapidfuzz는 0~100
    return float(fuzz.WRatio(a, b))


def jw_score(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    # jellyfish는 0~1
    return float(jellyfish.jaro_winkler_similarity(a, b) * 100.0)


# =========================
# 엑셀 컬럼 찾기
# =========================
def find_part_col(columns) -> Optional[str]:
    if "부품 기준" in columns:
        return "부품 기준"

    normalized = {re.sub(r"\s+", "", str(c)): str(c) for c in columns}
    if "부품기준" in normalized:
        return normalized["부품기준"]

    for c in columns:
        cs = str(c)
        if ("부품" in cs) and ("기준" in cs):
            return str(c)

    return None


# =========================
# DB(엑셀) 로딩
# =========================
def load_db_rows(excel_path: Path) -> Tuple[List[Dict[str, Any]], List[str]]:
    if not excel_path.exists():
        raise HTTPException(500, f"작업시간분석표DB.xlsx 파일이 없습니다: {excel_path}")

    xls = pd.ExcelFile(excel_path)
    db_rows: List[Dict[str, Any]] = []

    for sheet in xls.sheet_names:
        df = pd.read_excel(excel_path, sheet_name=sheet, header=EXCEL_HEADER_ROW)

        part_col = find_part_col(df.columns)
        if not part_col:
            continue

        for idx, val in df[part_col].items():
            if pd.isna(val):
                continue
            raw = str(val).strip()
            if not raw:
                continue

            db_rows.append({
                "db_part_raw": raw,
                "db_part_norm": normalize_text(raw),
                "sheet": sheet,
                "row_index": int(idx),
            })

    if not db_rows:
        raise HTTPException(500, "엑셀에서 '부품 기준' 컬럼을 찾지 못했습니다.")

    db_choices = [r["db_part_norm"] for r in db_rows]
    return db_rows, db_choices


# =========================
# 트리 JSON 로딩
# =========================
def load_tree_nodes_json(root_dir: Path, spec: str) -> List[Dict[str, Any]]:
    json_path = root_dir / f"{spec}.json"
    if not json_path.exists():
        raise HTTPException(404, f"트리 JSON이 없습니다: {json_path}")

    data = json.loads(json_path.read_text(encoding="utf-8"))
    nodes = data.get("nodes", [])
    if not isinstance(nodes, list):
        raise HTTPException(500, "트리 JSON의 nodes 형식이 올바르지 않습니다.")
    return nodes


def extract_json_ids(nodes: List[Dict[str, Any]]) -> List[str]:
    if ONLY_INHOUSE:
        nodes = [n for n in nodes if n.get("inhouse") is True]

    json_ids = [n.get("id") for n in nodes if n.get("id")]
    # 중복 제거(원래 순서 유지)
    json_ids = list(dict.fromkeys(json_ids))
    return json_ids


# =========================
# 매칭 (1등만)
# =========================
def match_one_best(
    query_raw: str,
    db_rows: List[Dict[str, Any]],
    db_choices: List[str],
    topk: int = TOPK
) -> Optional[Dict[str, Any]]:
    qn = normalize_text(query_raw)
    if not qn:
        return None

    # 1) rapidfuzz로 전체 스캔 → 상위 TopK 인덱스 추림
    scored = []
    for i, choice_norm in enumerate(db_choices):
        scored.append((i, rf_score(qn, choice_norm)))

    scored.sort(key=lambda x: x[1], reverse=True)
    top_candidates = scored[:topk]

    # 2) TopK에 대해서 JW 계산 → 1등 선택
    best = None
    best_jw = -1.0
    best_rf = -1.0

    for idx, rf in top_candidates:
        choice_norm = db_rows[idx]["db_part_norm"]
        jw = jw_score(qn, choice_norm)

        if jw > best_jw:
            best_jw = jw
            best_rf = rf
            best = {
                "json_id_raw": query_raw,
                "json_id_norm": qn,
                "db_part_raw": db_rows[idx]["db_part_raw"],
                "db_part_norm": db_rows[idx]["db_part_norm"],
                "score_rapidfuzz": best_rf,
                "score_jw": best_jw,
                # 참고용으로만 유지(지금 단계에서는 반환/저장 안 함)
                "sheet": db_rows[idx]["sheet"],
                "row_index": db_rows[idx]["row_index"],
            }

    return best


def make_empty_assembly_row(db_part_raw: str) -> Dict[str, Any]:
    # 지정하신 9개 컬럼만 생성
    row = {k: "" for k in ASSEMBLY_COLUMNS}
    row["부품 기준"] = db_part_raw
    return row

def get_db_meta_rows_for_part(db_rows, part_raw):
    return [
        r for r in db_rows
        if r["db_part_raw"] == part_raw
    ]

import pandas as pd

def load_excel_rows_for_matches(excel_path, matched_meta_rows):
    xls = pd.ExcelFile(excel_path)
    sheet_cache = {}
    out = []

    # sheet별로 묶기
    by_sheet = {}
    for m in matched_meta_rows:
        by_sheet.setdefault(m["sheet"], []).append(m)

    for sheet, metas in by_sheet.items():
        metas = sorted(metas, key=lambda x: x["row_index"])

        if sheet not in sheet_cache:
            df = pd.read_excel(excel_path, sheet_name=sheet, header=EXCEL_HEADER_ROW)
            sheet_cache[sheet] = df
        else:
            df = sheet_cache[sheet]

        part_col = find_part_col(df.columns)
        if not part_col:
            continue

        part_rows = [
            i for i, v in df[part_col].items()
            if not pd.isna(v) and str(v).strip()
        ]

        for m in metas:
            start = m["row_index"]

            # 다음 part 시작 전까지
            next_part_rows = [r for r in part_rows if r > start]
            end = next_part_rows[0] if next_part_rows else len(df)

            for i in range(start, end):
                row = df.iloc[i]

                out.append({
                    "부품 기준": str(row.get("부품 기준", "")).strip(),
                    "요소작업": str(row.get("요소작업", "")).strip(),
                    "OPTION": str(row.get("OPTION", "")).strip(),
                    "작업자": str(row.get("작업자", "")).strip(),
                    "no": str(row.get("no", "")).strip(),
                    "동작요소": str(row.get("동작요소", "")).strip(),
                    "반복횟수": str(row.get("반복횟수", "")).strip(),
                    "SEC": str(row.get("SEC", "")).strip(),
                    "TOTAL": str(row.get("TOTAL", "")).strip(),
                })

    return out

def normalize_merged_rows(rows):
    last_part = None
    last_task = None
    last_option = None

    out = []

    for r in rows:
        part = r.get("부품 기준", "").strip()
        task = r.get("요소작업", "").strip()
        option = r.get("OPTION", "").strip()

        if not part or part.lower() == "nan":
            part = last_part
        else:
            last_part = part

        if not task or task.lower() == "nan":
            task = last_task
        else:
            last_task = task

        if not option or option.lower() == "nan":
            option = last_option
        else:
            last_option = option

        nr = dict(r)
        nr["부품 기준"] = part or ""
        nr["요소작업"] = task or ""
        nr["OPTION"] = option or ""

        out.append(nr)

    return out


def make_assembly_row_from_db(db_row):
    return {
        "부품 기준": db_row["부품 기준"],
        "요소작업": db_row["요소작업"],
        "OPTION": db_row["OPTION"],
        "작업자": db_row["작업자"],
        "no": db_row["no"],
        "동작요소": db_row["동작요소"],
        "반복횟수": db_row["반복횟수"],
        "SEC": db_row["SEC"],
        "TOTAL": db_row["TOTAL"],
    }