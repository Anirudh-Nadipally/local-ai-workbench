import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import { toHtml } from "hast-util-to-html";
import type { Root } from "hast";
import { escapeHtml } from "@/domain/import";
export function renderExport(title: string, markdown: string) {
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype);
  const tree = processor.runSync(processor.parse(markdown)) as Root;
  function clean(node: Root | Root["children"][number]) {
    if (node.type === "element") {
      if (node.tagName === "img") {
        node.tagName = "span";
        node.children = [
          {
            type: "text",
            value: String(
              node.properties.alt || "Image omitted from print export",
            ),
          },
        ];
        node.properties = {};
      }
      if (node.tagName === "a") {
        const href = String(node.properties.href || "");
        if (!/^(https?:|mailto:|#)/i.test(href)) delete node.properties.href;
        node.properties.rel = "noopener noreferrer";
      }
      for (const child of node.children) clean(child);
    } else if (node.type === "root")
      for (const child of node.children) clean(child);
  }
  clean(tree);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title><style>:root{color-scheme:light}body{max-width:800px;margin:64px auto;padding:0 28px;font:16px/1.75 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#263246}h1,h2,h3{line-height:1.25;letter-spacing:-.03em}h1{font-size:34px;margin:0 0 32px}h2{font-size:23px;margin-top:34px}h3{font-size:18px;margin-top:25px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f5f8;padding:18px;border-radius:8px;font:12px/1.7 monospace}code{background:#f3f5f8;font-size:.86em;padding:2px 4px}pre code{padding:0}table{border-collapse:collapse;width:100%;font-size:14px}td,th{padding:10px;border-bottom:1px solid #dfe5ee;text-align:left}blockquote{border-left:3px solid #3d64dd;padding-left:18px;color:#647086}a{color:#345aca}hr{border:0;border-top:1px solid #dfe5ee;margin:30px 0}footer{color:#7b8495;font-size:11px;margin-top:50px}@media print{body{margin:0;max-width:none}pre,blockquote,tr{break-inside:avoid}a{color:inherit}}</style></head><body>${toHtml(tree)}<footer>Prepared with Workbench</footer></body></html>`;
}
