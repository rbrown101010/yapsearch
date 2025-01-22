'use client';

import { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

interface MermaidDiagramProps {
  content: string;
}

export default function MermaidDiagram({ content }: MermaidDiagramProps) {
  const diagramRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const renderDiagram = async () => {
      try {
        if (!diagramRef.current) return;

        // Initialize mermaid
        mermaid.initialize({
          startOnLoad: true,
          theme: 'default',
          securityLevel: 'loose',
          flowchart: {
            useMaxWidth: true,
            htmlLabels: true,
            curve: 'basis',
          },
        });

        console.log('Attempting to render diagram with content:', content);

        // Clear previous content and error
        diagramRef.current.innerHTML = '';
        setError(null);

        // Generate unique ID for this render
        const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`;

        const { svg } = await mermaid.render(id, content);
        if (diagramRef.current) {
          diagramRef.current.innerHTML = svg;
        }
      } catch (err) {
        console.error('Error rendering Mermaid diagram:', err);
        setError(err instanceof Error ? err.message : 'Failed to render diagram');
      }
    };

    renderDiagram();
  }, [content]);

  return (
    <div className="mermaid-wrapper">
      <div ref={diagramRef} className="mermaid-diagram my-4" />
      {error && (
        <div className="text-red-500 text-sm mt-2">
          Error rendering diagram: {error}
        </div>
      )}
    </div>
  );
} 