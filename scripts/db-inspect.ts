import "dotenv/config";
import { Client } from "pg";
// Salt-okunur keşif: sürüm, şemalar, tablolar. Hiçbir şey yazmaz.
async function main() {
  const c = new Client({ connectionString: process.env.DIRECT_URL });
  await c.connect();
  const v = await c.query("select version(), current_database(), current_user");
  console.log(v.rows[0]);
  const t = await c.query("select table_schema, table_name from information_schema.tables where table_schema not in ('pg_catalog','information_schema') order by 1,2");
  console.log("tables:", t.rows.length, t.rows.slice(0, 50));
  const e = await c.query("select extname from pg_extension");
  console.log("extensions:", e.rows.map((r) => r.extname));
  await c.end();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
