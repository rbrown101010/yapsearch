export function convertReasoningToMermaid(reasoning: string): string {
  // Split the reasoning into sentences
  const sentences = reasoning
    .split(/[.!?]/)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  // Create nodes and connections
  let mermaidCode = 'graph TD\n';
  let nodeId = 0;

  sentences.forEach((sentence, index) => {
    const currentNodeId = `N${nodeId}`;
    const nextNodeId = `N${nodeId + 1}`;

    // Add current node
    mermaidCode += `  ${currentNodeId}["${sentence}"]\n`;

    // Add connection to next node if not the last sentence
    if (index < sentences.length - 1) {
      mermaidCode += `  ${currentNodeId} --> ${nextNodeId}\n`;
    }

    nodeId++;
  });

  return mermaidCode;
} 