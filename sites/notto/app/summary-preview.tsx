"use client";

import { memo } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins: NonNullable<Parameters<typeof Markdown>[0]["rehypePlugins"]> = [[rehypeKatex, { throwOnError: false, trust: false, strict: "ignore" }]];

export const SummaryPreview = memo(function SummaryPreview({ source }: { source: string }) {
  return <div className="summary-rendered"><Markdown skipHtml remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={{
    h1: ({ children }) => <h2>{children}</h2>,
    a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
    table: ({ children }) => <div className="table-scroll"><table>{children}</table></div>,
  }}>{source}</Markdown></div>;
});
