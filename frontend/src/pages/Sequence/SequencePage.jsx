import React from "react";
import { ReactFlowProvider } from "@xyflow/react";

import SequenceEditor from "./SequenceEditor";
import { SequenceDnDProvider } from "./SequenceDnDContext";

export default function SequencePage() {
  return (
    <ReactFlowProvider>
        <SequenceEditor />
    </ReactFlowProvider>
  );
}
