import { TemplateGrid } from "@/components/mdx/template-grid";
import { getAllItems } from "@/lib/templates";

export async function TemplatesGridServer() {
  const items = getAllItems();
  return <TemplateGrid items={items} />;
}
