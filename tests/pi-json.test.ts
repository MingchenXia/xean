import { expect, test } from "bun:test";
import {
  parseJsonWithRepair,
  parseStreamingJson,
  repairJson,
} from "@earendil-works/pi-ai/utils/json-parse";

test("JSON repair preserves valid spans, escapes, controls, and partial arguments", () => {
  const unchanged = '{"proof":"quoted \\"text\\" and \\u03b1 and \\\\ path';
  expect(repairJson(unchanged)).toBe(unchanged);
  expect(parseStreamingJson<Record<string, string>>(unchanged)).toEqual({
    proof: 'quoted "text" and α and \\ path',
  });
  expect(
    parseJsonWithRepair<Record<string, string>>(
      '{"proof":"line\n\ttab \\q \\u1234 \\\\","nul":"a\u0000b"}',
    ),
  ).toEqual({ proof: "line\n\ttab \\q ሴ \\", nul: "a\u0000b" });
  expect(
    parseStreamingJson<Record<string, string>>('{"proof":"valid\\'),
  ).toEqual({ proof: "valid" });
  expect(
    parseStreamingJson<Record<string, string>>(
      '{"proof":"raw\ninvalid \\q then trailing\\',
    ),
  ).toEqual({});
});
