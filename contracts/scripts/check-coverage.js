// CI gate: fail if contract branch coverage drops below the synopsis target.
const summary = require("../coverage/coverage-summary.json").total;
const MIN = Number(process.env.MIN_BRANCH_COVERAGE || 90);
console.log(`Lines ${summary.lines.pct}% · Branches ${summary.branches.pct}% (min ${MIN}%)`);
if (summary.branches.pct < MIN) process.exit(1);
