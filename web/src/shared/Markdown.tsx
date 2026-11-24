import { Fragment, type ReactNode } from "react";
import { parseMarkdown } from "faang-ui/markdown";

const INLINE = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|\[\[[^\]]+\]\])/g;

export function markdownHeadingId(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function inline(text: string): ReactNode[] {
  const parts = text.split(INLINE).filter((part) => part !== "");
  return parts.map((part, index) => {
    const key = `${index}:${part}`;
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return <em key={key}>{part.slice(1, -1)}</em>;
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return <code key={key}>{part.slice(1, -1)}</code>;
    }
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (link) {
      return (
        <a key={key} href={link[2]} target="_blank" rel="noreferrer">
          {link[1]}
        </a>
      );
    }
    const wiki = /^\[\[([^\]]+)\]\]$/.exec(part);
    if (wiki) {
      return (
        <span key={key} className="ws-md__wiki">
          {wiki[1]}
        </span>
      );
    }
    return <Fragment key={key}>{part}</Fragment>;
  });
}

/** The app's Markdown reading, for the wiki and for text files in the drive. */
export default function Markdown({ source }: { source: string }) {
  const blocks = parseMarkdown(source);
  return (
    <div className="ws-md">
      {blocks.map((block, index) => {
        switch (block.type) {
          case "heading": {
            const Tag = (block.level === 1 ? "h1" : block.level === 2 ? "h2" : "h3") as "h1" | "h2" | "h3";
            return <Tag key={index} id={markdownHeadingId(block.text)}>{inline(block.text)}</Tag>;
          }
          case "paragraph":
            return <p key={index}>{inline(block.text)}</p>;
          case "code":
            return (
              <pre key={index} className="ws-md__code">
                <code>{block.text}</code>
              </pre>
            );
          case "list": {
            const Tag = block.ordered ? "ol" : "ul";
            return (
              <Tag key={index}>
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>{inline(item)}</li>
                ))}
              </Tag>
            );
          }
          case "quote":
            return <blockquote key={index}>{block.lines.map((line) => inline(line))}</blockquote>;
          case "rule":
            return <hr key={index} />;
          case "table":
            return (
              <table key={index}>
                <thead>
                  <tr>
                    {block.header.map((cell, cellIndex) => (
                      <th key={cellIndex}>{inline(cell)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {row.map((cell, cellIndex) => (
                        <td key={cellIndex}>{inline(cell)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          case "details":
            return (
              <details key={index}>
                <summary>{block.summary}</summary>
                <Markdown source={block.body} />
              </details>
            );
          case "embed":
            return (
              <p key={index} className="ws-md__embed">
                {block.target}
              </p>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
