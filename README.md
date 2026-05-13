# React Auto Design

공정설계 자동화를 위한 웹 워크벤치입니다.  
BOM 업로드부터 서브 부품 트리 구성, 시퀀스 설계, 조립 공수 계산, 작업시간 분석, LOB 분석까지 하나의 흐름으로 연결합니다.

## What It Does

- `SUB`
  BOM을 업로드하고 부품 트리를 정리합니다.
- `SEQUENCE`
  조립 시퀀스를 시각적으로 편집하고 AI 추천을 받을 수 있습니다.
- `ASSEMBLY`
  조립 구성과 공정 연결을 바탕으로 총공수를 정리합니다.
- `TIME`
  작업시간 분석표를 조회하고 공정 단위 데이터를 검토합니다.
- `LOB`
  라인 밸런싱 관점에서 인원, 공정, tact 흐름을 분석합니다.

## Product Flow

```text
BOM Upload
  -> SUB Tree Modeling
  -> Sequence Design + Recommendation
  -> Assembly Summary
  -> Time Analysis
  -> LOB Analysis
```

## Stack

- Frontend: `React`, `Vite`, `React Router`, `Ant Design`, `React Flow`
- Backend: `FastAPI`
- Data/Excel: `openpyxl`, `pandas`
- Search/AI: embedding search, graph-style RAG, sequence recommendation pipeline

## Project Structure

```text
backend/
  main.py                 FastAPI entrypoint
  Sub/                    BOM import, tree/session logic
  sequence/               sequence AI, embedding, schema
  sequence_rag/           graph RAG + Neo4j helpers
  Assembly_router.py      assembly API
  Seuqence_router.py      sequence API
  Lob_router.py           LOB API

frontend/
  src/pages/Sub/          SUB page
  src/pages/Sequence/     sequence editor + chat UI
  src/pages/Assembly/     assembly workspace
  src/pages/Time/         time analysis pages
  src/pages/Lob/          LOB analysis pages
```

## Getting Started

### 1. Backend

```powershell
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

### 2. Frontend

```powershell
cd frontend
npm install
npm run dev
```

- Frontend default: `http://localhost:5173`
- Backend default: `http://localhost:8000`

## Environment

Optional `.env` values:

```env
FRONTEND_ORIGIN=http://localhost:5173

SEQUENCE_AI_OPENAI_BASE_URL=https://api.openai.com/v1
SEQUENCE_AI_OPENAI_MODEL=gpt-4o-mini
OPENAI_API_KEY=

SEQUENCE_RAG_BACKEND=hybrid
SEQUENCE_GRAPH_INDEX_PATH=backend/sequence_rag/data/graph_index.json
SEQUENCE_SOURCE_SEQUENCE_DIR=backend/sequence_rag/source_sequences
```

## Notes

- 루트 `package.json`은 최소 의존성만 가지고 있고, 실제 프론트 실행은 `frontend/`에서 진행합니다.
- 시퀀스 추천은 규칙 기반 로직, 임베딩 검색, RAG 문맥, AI provider를 함께 사용합니다.
- 현재 파인튜닝 관련 코드는 제거되어 있습니다.

## Why This Repo Exists

엑셀 중심으로 흩어져 있던 공정설계 작업을  
더 빠르고, 더 추적 가능하고, 더 반복 가능한 워크플로로 바꾸기 위해 만들었습니다.

단순히 화면만 있는 도구가 아니라,  
설계 데이터와 공정 판단 흐름을 연결하는 실무형 작업 환경을 목표로 합니다.
