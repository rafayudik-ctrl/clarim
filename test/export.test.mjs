import test from "node:test";
import assert from "node:assert/strict";
import { formatCommentsExport } from "../assets/js/modules/export-format.js";

test("exporta com exatamente três linhas em branco entre comentários", () => {
  const out = formatCommentsExport(["A", "B", "C"]);

  assert.equal(out, "A\n\n\n\nB\n\n\n\nC");
  assert.equal(out.split("\n\n\n\n").length, 3);
  assert.equal((out.match(/\n\n\n\n/g) || []).length, 2);
});

test("sem comentários, exporta texto vazio", () => {
  assert.equal(formatCommentsExport([]), "");
});
