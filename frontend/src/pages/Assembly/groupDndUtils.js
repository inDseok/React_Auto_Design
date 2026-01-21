import { v4 as uuidv4 } from "uuid";

// rows -> groups
export function buildGroupsFromRows(rows) {
  const groups = [];
  const map = new Map();

  for (const r of rows) {
    const gk = r.__groupKey || "(no-group)";
    if (!map.has(gk)) {
      const g = {
        id: gk,             // DnD에서 쓰는 그룹 id
        groupKey: gk,       // 내부 groupKey
        headerText: r["부품 기준"] || "", // 표시용(변경하지 않음)
        rows: [],
      };
      map.set(gk, g);
      groups.push(g);
    }
    map.get(gk).rows.push(r);
  }

  return groups;
}

// groups -> rows (평탄화)
export function flattenGroupsToRows(groups) {
  const out = [];
  for (const g of groups) {
    for (const r of g.rows) out.push(r);
  }
  return out;
}

// 그룹을 옮긴 후: movedGroup의 __groupKey를 새로 발급(질문2: B)
export function rekeyMovedGroup(groups, movedGroupId) {
  const newKey = uuidv4();

  return groups.map((g) => {
    if (g.id !== movedGroupId) return g;

    const newRows = g.rows.map((r) => ({
      ...r,
      __groupKey: newKey,
    }));

    return {
      ...g,
      id: newKey,
      groupKey: newKey,
      rows: newRows,
    };
  });
}

// dnd-kit용 reorder
export function arrayMoveImmutable(array, fromIndex, toIndex) {
  const copy = [...array];
  const [moved] = copy.splice(fromIndex, 1);
  copy.splice(toIndex, 0, moved);
  return copy;
}
