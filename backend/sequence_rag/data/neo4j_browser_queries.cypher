// 전체 노드 + 전체 관계
MATCH (n)-[r]->(m)
RETURN n, r, m;

// 백업 확인
MATCH (n:Part {label: 'WRAP'})
RETURN n.id AS id, n.label AS label, n.lastReason AS lastReason, n.partId AS partId, labels(n) AS labels
//라벨 변경
MATCH (n:Part {label: 'WRAP'})
SET n:Process
REMOVE n:Part

// 1) 전체 그래프 일부 보기
MATCH p=(a)-[:NEXT_PROCESS|NEXT_PART|NEXT]->(b)
RETURN p
LIMIT 200;

// 2) 특정 케이스 window 보기
MATCH (c:Case {name: 'AD FL'})-[:HAS_WINDOW]->(w:Window)-[r:IN_WINDOW]->(n)
RETURN c, w, r, n
ORDER BY w.windowIndex, r.position;

// 3) 특정 PART 주변 PROCESS 보기
MATCH p=(part:Part {partId: 'DESIPAC SUB'})-[:NEXT_PROCESS|NEXT_PART|NEXT*1..4]->(n)
RETURN p
LIMIT 100;

// 4) 많이 연결된 관계 보기
MATCH (a)-[r:NEXT_PROCESS|NEXT_PART|NEXT]->(b)
RETURN a, r, b
ORDER BY r.count DESC
LIMIT 100;

// 5) 특정 PROCESS의 이전 PART 보기
MATCH (part:Part)-[r:NEXT_PROCESS|NEXT]->(proc:Process {key: 'T/SCREW'})
RETURN part, r, proc
ORDER BY r.count DESC
LIMIT 50;

// 전체 노드, 관계 삭제
MATCH (n)
DETACH DELETE n