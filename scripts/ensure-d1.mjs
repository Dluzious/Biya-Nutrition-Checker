// Membuat database D1 "biya-nutrition" bila belum ada, lalu menulis
// database_id-nya ke wrangler.toml. Dipakai oleh workflow deploy GitHub.
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const NAME = "biya-nutrition";
const wrangler = (args) =>
  execFileSync("npx", ["wrangler", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });

function list() {
  const out = wrangler(["d1", "list", "--json"]);
  return JSON.parse(out.slice(out.indexOf("[")));
}

let db = list().find((d) => d.name === NAME);
if (!db) {
  console.log(`Membuat database D1 ${NAME}…`);
  wrangler(["d1", "create", NAME]);
  db = list().find((d) => d.name === NAME);
}
const id = db?.uuid ?? db?.database_id ?? db?.id;
if (!id) throw new Error(`Database ${NAME} tidak ditemukan setelah dibuat.`);

const toml = fs.readFileSync("wrangler.toml", "utf8");
fs.writeFileSync("wrangler.toml", toml.replace(/database_id = "[^"]*"/, `database_id = "${id}"`));
console.log(`Database ${NAME}: ${id}`);
