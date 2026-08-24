/**
 * AgentReportMarkdownBody — lazy-loaded inner for the AgentReport's markdown
 * body. Splits `react-markdown` + `remark-gfm` into the `vendor-markdown`
 * Vite chunk so the main /ml-studio bundle stays light.
 *
 * Tailwind prose-ish styling without the @tailwindcss/typography plugin —
 * minimal class overrides that match the rest of the panel (small text,
 * compact lists, monospaced code).
 */

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownBodyProps {
  content: string;
}

export default function AgentReportMarkdownBody({ content }: MarkdownBodyProps) {
  return (
    <div className="agent-markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="mt-3 mb-1 text-sm font-semibold text-foreground first:mt-0">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="mt-3 mb-1 text-xs font-semibold text-foreground first:mt-0">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="mt-2 mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground first:mt-0">
              {children}
            </h3>
          ),
          p: ({ children }) => (
            <p className="mb-2 text-xs text-foreground/85 last:mb-0">{children}</p>
          ),
          ul: ({ children }) => (
            <ul className="mb-2 ml-4 list-disc space-y-0.5 text-xs text-foreground/85 last:mb-0">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="mb-2 ml-4 list-decimal space-y-0.5 text-xs text-foreground/85 last:mb-0">
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          code: ({ children, className }) => {
            const isBlock = typeof className === "string" && className.startsWith("language-");
            if (isBlock) {
              return (
                <code className="font-mono text-[10.5px] leading-relaxed">
                  {children}
                </code>
              );
            }
            return (
              <code className="rounded bg-white/[0.05] px-1 py-0.5 font-mono text-[11px] text-foreground/90">
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="mb-2 overflow-x-auto rounded-md border border-white/10 bg-black/40 p-2 text-[10.5px] last:mb-0">
              {children}
            </pre>
          ),
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline underline-offset-2 hover:text-primary/80"
            >
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="mb-2 overflow-x-auto last:mb-0">
              <table className="w-full border-collapse text-[11px]">{children}</table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="border-b border-white/10 text-left text-muted-foreground">
              {children}
            </thead>
          ),
          th: ({ children }) => (
            <th className="px-2 py-1 font-medium text-[10px] uppercase tracking-wider">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-white/5 px-2 py-1">{children}</td>
          ),
          blockquote: ({ children }) => (
            <blockquote className="mb-2 border-l-2 border-primary/40 pl-2 text-xs italic text-muted-foreground last:mb-0">
              {children}
            </blockquote>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
