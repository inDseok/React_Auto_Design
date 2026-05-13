# Sequence RAG Neo4j

`backend/sequence_rag` contains a graph-style retrieval index, JSON-based RAG helpers, and Neo4j export/query helpers.

## Files

- `cli.py`: builds `data/graph_index.json` from `backend/finetune_sequence/sequences`
- `neo4j_export.py`: converts `graph_index.json` into a Cypher import script
- `neo4j_to_index.py`: exports edited Neo4j graph data back into `data/neo4j_2_graph_index.json`
- `neo4j_retriever.py`: queries Neo4j for graph-backed RAG references
- `data/neo4j_browser_queries.cypher`: example Neo4j Browser queries

## Build the index

```powershell
python -m backend.sequence_rag.cli --output backend/sequence_rag/data/graph_index.json
```

## Export to Neo4j Cypher

```powershell
python -m backend.sequence_rag.neo4j_export --output backend/sequence_rag/data/neo4j_import.cypher
```

## Import into Neo4j

Open Neo4j Browser, then paste the generated Cypher from:

- `backend/sequence_rag/data/neo4j_import.cypher`

After import, try the sample queries in:

- `backend/sequence_rag/data/neo4j_browser_queries.cypher`

## Export Neo4j Back To JSON

Set the Neo4j environment variables first, then run:

```powershell
python backend/sequence_rag/neo4j_to_index.py --output backend/sequence_rag/data/neo4j_2_graph_index.json
```

The export is most accurate when Neo4j contains `Window` nodes and `IN_WINDOW {position}` relationships.
If those are missing, the script falls back to a coarse export from `NEXT_PROCESS` / `NEXT_PART` relationships.

## Use Neo4j For RAG

Install the Python driver first:

```powershell
pip install neo4j
```

Then set environment variables:

```powershell
$env:SEQUENCE_RAG_BACKEND="hybrid"
$env:SEQUENCE_NEO4J_URI="bolt://localhost:7687"
$env:SEQUENCE_NEO4J_USER="neo4j"
$env:SEQUENCE_NEO4J_PASSWORD="your-password"
$env:SEQUENCE_NEO4J_DATABASE="neo4j"
```

Modes:

- `json`: use only `graph_index.json`
- `neo4j`: query Neo4j first and fall back to JSON if no graph result is available
- `hybrid`: merge Neo4j graph results with JSON index results

To point JSON-backed recommendation paths at an edited export, set:

```powershell
$env:SEQUENCE_GRAPH_INDEX_PATH="backend/sequence_rag/data/neo4j_2_graph_index.json"
```

## Graph model

- `(:Part|:Process)` -> `(:Process)` via `NEXT_PROCESS {count}`
- `(:Process|:Part)` -> `(:Part)` via `NEXT_PART {count}`

Notes:

- Previous-step retrieval uses reverse-direction Cypher queries instead of separate `PREV_*` relationships.
- `neo4j_retriever.py` still reads legacy `NEXT` edges for backward compatibility with older imports.

Canonical keys:

- `Part.partId`
- `Process.key` using process `label`
