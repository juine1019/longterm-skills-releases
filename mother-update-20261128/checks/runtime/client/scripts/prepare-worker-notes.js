// AI 호출 없이 기존 RFID 수집 파일을 업무데스크 가져오기 파일로 바꾼다.
// node scripts/prepare-worker-notes.js <rfid.json> <YYYY-MM> <기관명> <출력.json> [작성자대응표.json]
const fs = require("node:fs");
const path = require("node:path");
const { fromRfid } = require("../lib/workerNotes");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
function main(args) {
  const [input, month, orgName, output, mapping] = args;
  if (!input || !month || !orgName || !output) throw new Error("사용법: prepare-worker-notes.js <rfid.json> <YYYY-MM> <기관명> <출력.json> [작성자대응표.json]");
  if (fs.existsSync(output)) throw new Error("출력 파일이 이미 있습니다. 새 파일 이름을 지정해 주세요");
  const stat = fs.statSync(input);
  const result = fromRfid(read(input), { month, orgName, collectedAt: stat.mtime.toISOString(), workerMap: mapping ? read(mapping) : [] });
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(result), { encoding: "utf8", flag: "wx" });
  console.log(JSON.stringify({ month, records: result.records.length, identityUnverified: result.records.filter(r => !r.identityVerified).length }));
}
if (require.main === module) { try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exitCode = 1; } }
module.exports = { main };
