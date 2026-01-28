import { willCreateCycle } from "./graphUtils";

export function validateConnection({
  nodes,
  edges,
  source,
  target,
}) {
  if (!source || !target) {
    return { ok: false, reason: "Invalid connection" };
  }

  // 1) 자기 자신 연결 금지
  if (source === target) {
    return { ok: false, reason: "자기 자신으로 연결할 수 없습니다." };
  }

  // 2) 중복 edge 금지
  const duplicated = edges.some(
    (e) => e.source === source && e.target === target
  );
  if (duplicated) {
    return { ok: false, reason: "이미 연결된 노드입니다." };
  }

  // 3) 순환 금지
  if (willCreateCycle(nodes, edges, source, target)) {
    return { ok: false, reason: "순환 구조는 허용되지 않습니다." };
  }

  return { ok: true };
}
