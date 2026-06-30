const fs=require("fs");
const path=require("path");

function fix(rel) {
  const p=path.join(process.cwd(), rel);
  let c=fs.readFileSync(p, "utf-8");
  c=c.replace(/"`nimport \{ SearchInput \} from "@\/components\/ui\/SearchInput"/g, "\nimport { SearchInput } from \"@/components/ui/SearchInput\"");
  c=c.replace(/"`n\s*<Table>/g, "\n      <Table>");
  c=c.replace(/ÃƒÂ©/g, "é");
  c=c.replace(/ÃƒÂ³/g, "ó");
  fs.writeFileSync(p, c, "utf-8");
  console.log("fixed: " + rel);
}

fix("src/app/(protected)/inventory-movements/page.tsx");
fix("src/app/(protected)/rentals/page.tsx");
fix("src/app/(protected)/stock-movements/page.tsx");
fix("src/app/(protected)/stock/page.tsx");
