import { Copy } from "lucide-react";
import { redactToken } from "../utils";

interface CodeBlockProps {
  label: string;
  value: string;
  minRows?: number;
}

export function CodeBlock({ label, value, minRows = 8 }: CodeBlockProps) {
  const safeValue = redactToken(value || "");
  return (
    <section className="code-panel">
      <div className="code-panel-header">
        <h3>{label}</h3>
        <button className="icon-button" type="button" onClick={() => void navigator.clipboard?.writeText(safeValue)} title={`Copy ${label}`}>
          <Copy size={16} aria-hidden="true" />
          <span className="sr-only">Copy {label}</span>
        </button>
      </div>
      <pre style={{ minHeight: `${minRows * 1.45}rem` }}>{safeValue || "No output yet."}</pre>
    </section>
  );
}
