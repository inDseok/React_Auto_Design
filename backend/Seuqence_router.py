from fastapi import APIRouter, HTTPException
from pathlib import Path
import json
from openpyxl import load_workbook

router = APIRouter(
    prefix="/sequence",
    tags=["sequence"]
)

DATA_DIR = Path("backend/data/bom_runs")


@router.get("/inhouse-parts")
def get_inhouse_parts(bomId: str, spec: str):
    """
    Sequence 구성용 inhouse PART 목록 반환
    source: SUB 트리
    """
    json_path = DATA_DIR / bomId / f"{spec}.json"

    if not json_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"SUB 트리 JSON 없음: {json_path}"
        )

    try:
        with open(json_path, "r", encoding="utf-8") as f:
            tree = json.load(f)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"JSON 로드 실패: {str(e)}"
        )

    nodes = tree.get("nodes", [])

    parts = []
    for n in nodes:
        if n.get("type") != "PART":
            continue
        if n.get("inhouse") is not True:
            continue

        parts.append({
            "partId": n.get("id"),
            "partName": n.get("name"),
            "inhouse": True,

            # 확장 대비
            "parentId": n.get("parent_id"),
            "order": n.get("order"),
        })

    return {
        "bomId": bomId,
        "spec": spec,
        "source": "sub-tree",
        "parts": parts,
        "count": len(parts),
    }


EXCEL_DB_PATH = Path("backend/작업시간분석표DB.xlsx")

@router.get("/process-templates")
def get_process_templates():
    """
    Sequence 구성용 PROCESS 템플릿
    - 공통 DB, 표준 동작 시트
    - 2행에 '부품 기준' 컬럼 존재
    """

    if not EXCEL_DB_PATH.exists():
        raise HTTPException(
            status_code=404,
            detail="작업시간 분석표 DB 엑셀 파일 없음"
        )

    wb = load_workbook(EXCEL_DB_PATH, data_only=True)

    TARGET_SHEETS = ["공통 DB", "표준 동작","부품 결합 DB"]
    processes = []
    seen = set()

    for sheet_name in TARGET_SHEETS:
        if sheet_name not in wb.sheetnames:
            continue

        ws = wb[sheet_name]

        header_row = 2  # ⭐ 핵심 수정
        headers = {}

        # 1️⃣ 헤더 파싱 (2행)
        for col in range(1, ws.max_column + 1):
            v = ws.cell(row=header_row, column=col).value
            if v:
                headers[str(v).strip()] = col

        # 2️⃣ 부품 기준 컬럼 찾기
        part_col = None
        for k, c in headers.items():
            if "부품" in k.replace(" ", ""):
                part_col = c
                break

        if not part_col:
            continue

        # 3️⃣ 데이터 행 순회 (3행부터)
        for row in range(header_row + 1, ws.max_row + 1):
            val = ws.cell(row=row, column=part_col).value
            if not val:
                continue

            part_base = str(val).strip()
            key = (sheet_name, part_base)

            if key in seen:
                continue
            seen.add(key)

            processes.append({
                "processKey": f"{sheet_name}:{part_base}",
                "processType": "STANDARD",
                "label": part_base,
                "sourceSheet": sheet_name,
                "partBase": part_base,
            })

    return {
        "source": "assembly-db",
        "processes": processes,
        "count": len(processes),
    }
