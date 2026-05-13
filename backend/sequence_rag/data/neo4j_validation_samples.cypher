// Small validation queries for quick spot checks after import.
// Focuses on a few known windows from graph_index.json so you do not need to inspect the full graph.

// 1) Confirm the sample Case and Window nodes exist.
MATCH (c:Case {name: 'AD FL'})-[:HAS_WINDOW]->(w:Window)
WHERE w.docId IN ['AD FL-w1', 'AD FL-w2']
RETURN c.name AS caseName, w.docId AS docId, w.windowIndex AS windowIndex
ORDER BY w.windowIndex;

// 2) Confirm IN_WINDOW order for AD FL-w1.
MATCH (w:Window {docId: 'AD FL-w1'})-[r:IN_WINDOW]->(n)
RETURN
  r.position AS position,
  CASE WHEN n:Process THEN 'PROCESS' ELSE 'PART' END AS nodeType,
  coalesce(n.key, n.partId) AS nodeKey,
  coalesce(n.label, n.key, n.partId) AS label
ORDER BY r.position;

// 3) Confirm the first sample transition chain for AD FL-w1.
MATCH p=
  (:Part {partId: 'DESIPAC SUB'})
  -[:NEXT_PROCESS]->
  (:Process {key: 'T/SCREW'})
  -[:NEXT_PROCESS]->
  (:Process {key: 'HOUSING (하우징류 지그 안착)'})
  -[:NEXT_PROCESS]->
  (:Process {key: 'DRL HEAT SINK'})
RETURN p;

// 4) Confirm process-to-part transition exists.
MATCH p=
  (:Process {key: 'T/SCREW'})
  -[:NEXT_PART]->
  (:Part {partId: 'DUST COVER'})
RETURN p;

// 5) Quick reverse lookup: which Parts lead into T/SCREW.
MATCH (part:Part)-[r:NEXT_PROCESS]->(proc:Process {key: 'T/SCREW'})
RETURN part.partId AS partId, r.count AS count
ORDER BY count DESC, partId
LIMIT 10;

// 6) Confirm AD FL-w2 starts from a Part and then several Process nodes.
MATCH (w:Window {docId: 'AD FL-w2'})-[r:IN_WINDOW]->(n)
WHERE r.position <= 6
RETURN
  r.position AS position,
  CASE WHEN n:Process THEN 'PROCESS' ELSE 'PART' END AS nodeType,
  coalesce(n.key, n.partId) AS nodeKey
ORDER BY r.position;

// 7) Find suspicious self-loops quickly.
MATCH (n)-[r:NEXT_PROCESS|NEXT_PART]->(n)
RETURN labels(n) AS labels, coalesce(n.key, n.partId) AS nodeKey, type(r) AS relType, r.count AS count
ORDER BY count DESC, nodeKey
LIMIT 20;

// 8) Count current node and relation volumes for a quick sanity check.
MATCH (n)
WITH
  sum(CASE WHEN n:Part THEN 1 ELSE 0 END) AS partCount,
  sum(CASE WHEN n:Process THEN 1 ELSE 0 END) AS processCount,
  sum(CASE WHEN n:Window THEN 1 ELSE 0 END) AS windowCount,
  sum(CASE WHEN n:Case THEN 1 ELSE 0 END) AS caseCount
MATCH ()-[r]->()
RETURN
  partCount,
  processCount,
  windowCount,
  caseCount,
  sum(CASE WHEN type(r) = 'NEXT_PROCESS' THEN 1 ELSE 0 END) AS nextProcessCount,
  sum(CASE WHEN type(r) = 'NEXT_PART' THEN 1 ELSE 0 END) AS nextPartCount,
  sum(CASE WHEN type(r) = 'IN_WINDOW' THEN 1 ELSE 0 END) AS inWindowCount,
  sum(CASE WHEN type(r) = 'HAS_WINDOW' THEN 1 ELSE 0 END) AS hasWindowCount;
