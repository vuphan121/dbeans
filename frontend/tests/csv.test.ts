import assert from "node:assert/strict";
import { test } from "node:test";
import { CsvError, detectDelimiter, parseCsv } from "../src/lib/csv.ts";

const rowsOf = (text: string, delimiter?: string) => parseCsv(text, delimiter).rows;

test("parses plain rows regardless of line-ending style", () => {
  const expected = [["a", "b"], ["1", "2"]];
  assert.deepEqual(rowsOf("a,b\n1,2\n"), expected);
  assert.deepEqual(rowsOf("a,b\r\n1,2\r\n"), expected);
  assert.deepEqual(rowsOf("a,b\r1,2\r"), expected);
  assert.deepEqual(rowsOf("a,b\n1,2"), expected, "no trailing newline");
});

test("strips a UTF-8 byte order mark", () => {
  assert.deepEqual(rowsOf("﻿a,b\n1,2"), [["a", "b"], ["1", "2"]]);
});

test("handles quoted fields: delimiters, escaped quotes, embedded newlines", () => {
  assert.deepEqual(rowsOf('a,b\n"x, y","say ""hi"""\n'), [["a", "b"], ["x, y", 'say "hi"']]);
  assert.deepEqual(rowsOf('a\n"line1\nline2"\n'), [["a"], ["line1\nline2"]]);
  assert.deepEqual(rowsOf('a\n"line1\r\nline2"\n'), [["a"], ["line1\r\nline2"]]);
});

test("keeps empty cells but skips blank lines", () => {
  assert.deepEqual(rowsOf("a,b,c\n1,,3\n,,\n"), [["a", "b", "c"], ["1", "", "3"], ["", "", ""]]);
  assert.deepEqual(rowsOf("a,b\n\n1,2\n\n\n"), [["a", "b"], ["1", "2"]]);
});

test("a quoted empty value on its own line is a real one-cell row, not a blank line", () => {
  assert.deepEqual(rowsOf('a\n""\n'), [["a"], [""]]);
});

test("a quote in the middle of an unquoted field is literal", () => {
  assert.deepEqual(rowsOf('ab"c,d\n'), [['ab"c', "d"]]);
});

test("detects comma, semicolon, tab and pipe delimiters", () => {
  assert.deepEqual(rowsOf("a;b\n1;2\n"), [["a", "b"], ["1", "2"]]);
  assert.deepEqual(rowsOf("a\tb\n1\t2\n"), [["a", "b"], ["1", "2"]]);
  assert.deepEqual(rowsOf("a|b\n1|2\n"), [["a", "b"], ["1", "2"]]);
  assert.deepEqual(rowsOf("only\none\n"), [["only"], ["one"]], "single column");
  assert.equal(detectDelimiter('"a,b,c";d;e\n'), ";", "delimiters inside quotes are ignored");
  assert.equal(detectDelimiter("a,b;c\n"), ",", "ties go to comma");
  assert.equal(detectDelimiter(""), ",");
});

test("an explicit delimiter overrides detection", () => {
  assert.deepEqual(rowsOf("a,b\n1,2\n", ""), [["a,b"], ["1,2"]]);
});

test("preserves unicode", () => {
  assert.deepEqual(rowsOf("é,日本\nü,☃\n"), [["é", "日本"], ["ü", "☃"]]);
});

test("an empty file has no rows", () => {
  assert.deepEqual(rowsOf(""), []);
});

test("an unterminated quote is an error rather than silently swallowing the rest of the file", () => {
  assert.throws(() => parseCsv('a\n"oops\n'), CsvError);
});

test("parses a large file quickly", () => {
  const big = "id,name\n" + Array.from({ length: 100_000 }, (_, i) => `${i},"n ${i}"`).join("\n");
  const started = Date.now();
  const rows = parseCsv(big).rows;
  assert.equal(rows.length, 100_001);
  assert.deepEqual(rows[100_000], ["99999", "n 99999"]);
  assert.ok(Date.now() - started < 2000, "100k rows should parse well under 2s");
});
