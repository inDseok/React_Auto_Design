// src/pages/Sequence/zones/zoneUtils.js

export function buildAdjacency(nodes, edges) {
    const nodeIds = new Set(nodes.map((n) => n.id));
    const out = new Map();
    const inc = new Map();
  
    for (const id of nodeIds) {
      out.set(id, []);
      inc.set(id, []);
    }
  
    for (const e of edges) {
      if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue;
      out.get(e.source).push(e.target);
      inc.get(e.target).push(e.source);
    }
  
    return { out, inc };
  }
  
  export function bfsReachable(startId, outMap) {
    if (!outMap.has(startId)) return new Set();
    const q = [startId];
    const vis = new Set([startId]);
  
    while (q.length) {
      const cur = q.shift();
      const nexts = outMap.get(cur) || [];
      for (const nx of nexts) {
        if (!vis.has(nx)) {
          vis.add(nx);
          q.push(nx);
        }
      }
    }
    return vis;
  }
  
  export function reverseBfsReachable(endId, incMap) {
    if (!incMap.has(endId)) return new Set();
    const q = [endId];
    const vis = new Set([endId]);
  
    while (q.length) {
      const cur = q.shift();
      const prevs = incMap.get(cur) || [];
      for (const pv of prevs) {
        if (!vis.has(pv)) {
          vis.add(pv);
          q.push(pv);
        }
      }
    }
    return vis;
  }
  
  export function computeZoneNodeSet({ nodes, edges, startNodeId, endNodeId }) {
    const { out, inc } = buildAdjacency(nodes, edges);
  
    const forward = bfsReachable(startNodeId, out);
    const backward = reverseBfsReachable(endNodeId, inc);
  
    const zoneSet = new Set();
    for (const id of forward) {
      if (backward.has(id)) zoneSet.add(id);
    }
  
    // 유효성: start->end 경로가 없으면 교집합에 end가 안 들어갈 가능성이 큼
    // 가장 단순/명확한 판정: end가 zoneSet에 포함되어야 "도달 가능"으로 인정
    const hasPath = zoneSet.has(endNodeId) && zoneSet.has(startNodeId);
  
    return { zoneSet, hasPath };
  }
  
  export function detectZoneOverlap(newZoneSet, zones) {
    // zones: [{ zoneId, nodeIdsSet: Set }]
    for (const z of zones) {
      const s = z.nodeIdsSet;
      for (const id of newZoneSet) {
        if (s.has(id)) return z.zoneId;
      }
    }
    return null;
  }
  
  export function computeZoneBBox(nodes, nodeIdSet, padding = 24) {
    // React Flow node: {id, position, width, height}
    // width/height가 없을 수 있으니 fallback
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let count = 0;
  
    for (const n of nodes) {
      if (!nodeIdSet.has(n.id)) continue;
      const w = Number.isFinite(n.width) ? n.width : 180;
      const h = Number.isFinite(n.height) ? n.height : 60;
      const x1 = n.position.x;
      const y1 = n.position.y;
      const x2 = x1 + w;
      const y2 = y1 + h;
  
      minX = Math.min(minX, x1);
      minY = Math.min(minY, y1);
      maxX = Math.max(maxX, x2);
      maxY = Math.max(maxY, y2);
      count++;
    }
  
    if (count === 0) return null;
  
    return {
      x: minX - padding,
      y: minY - padding,
      width: (maxX - minX) + padding * 2,
      height: (maxY - minY) + padding * 2,
    };
  }
  