import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const directory = process.argv[2];
if (!directory) throw new Error("Pass the CodeQL SARIF output directory.");
const files = readdirSync(directory).filter(name => name.endsWith(".sarif"));
if (!files.length) throw new Error("CodeQL produced no SARIF files; refusing to pass the security gate.");
let blocked = 0;
for (const file of files) {
  const report = JSON.parse(readFileSync(join(directory, file), "utf8"));
  if (!Array.isArray(report.runs) || !report.runs.length) throw new Error(`${file}: missing SARIF runs.`);
  for (const run of report.runs) {
    if (!Array.isArray(run.results) || !Array.isArray(run.tool?.driver?.rules)) {
      throw new Error(`${file}: missing CodeQL results or rule metadata.`);
    }
    const rules = run.tool.driver.rules;
    for (const result of run.results) {
      const rule = rules.find(rule => rule.id === result.ruleId) ?? rules[result.ruleIndex];
      if (!rule) throw new Error(`${file}: result has no matching rule.`);
      const value = rule.properties?.["security-severity"];
      const severity = value === undefined ? undefined : Number(value);
      if (severity !== undefined && (!Number.isFinite(severity) || severity < 0 || severity > 10)) {
        throw new Error(`${file}: invalid security severity for ${rule.id}.`);
      }
      if ((severity !== undefined && severity >= 7) || (result.level ?? rule.defaultConfiguration?.level) === "error") {
        console.error(`Blocking CodeQL finding: ${rule.id} (security severity ${severity ?? "unspecified"}).`);
        blocked++;
      }
    }
  }
}
if (blocked) throw new Error(`CodeQL reported ${blocked} blocking finding(s). Review the code-scanning results.`);
console.log("CodeQL gate passed: no high/critical security findings or error-level results.");
