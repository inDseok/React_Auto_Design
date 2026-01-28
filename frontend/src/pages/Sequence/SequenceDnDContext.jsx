import React, { createContext, useContext, useState } from "react";

const SequenceDnDContext = createContext(null);

export function SequenceDnDProvider({ children }) {
  const [dragItem, setDragItem] = useState(null);
  return (
    <SequenceDnDContext.Provider value={[dragItem, setDragItem]}>
      {children}
    </SequenceDnDContext.Provider>
  );
}

export function useSequenceDnD() {
  const ctx = useContext(SequenceDnDContext);
  if (!ctx) {
    throw new Error("useSequenceDnD must be used within SequenceDnDProvider");
  }
  return ctx;
}
