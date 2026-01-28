export function willCreateCycle(nodes, edges, sourceId, targetId) {
    const adj = {};
  
    edges.forEach((e) => {
      if (!adj[e.source]) adj[e.source] = [];
      adj[e.source].push(e.target);
    });
  
    // 새 edge 가상 추가
    if (!adj[sourceId]) adj[sourceId] = [];
    adj[sourceId].push(targetId);
  
    const visited = new Set();
    const stack = new Set();
  
    function dfs(nodeId) {
      if (stack.has(nodeId)) return true;
      if (visited.has(nodeId)) return false;
  
      visited.add(nodeId);
      stack.add(nodeId);
  
      const next = adj[nodeId] || [];
      for (const n of next) {
        if (dfs(n)) return true;
      }
  
      stack.delete(nodeId);
      return false;
    }
  
    return dfs(sourceId);
  }
  