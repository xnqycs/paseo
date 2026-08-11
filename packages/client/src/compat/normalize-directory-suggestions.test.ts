import { describe, expect, it } from "vitest";
import { normalizeDirectorySuggestionsPayload } from "./normalize-directory-suggestions.js";

describe("normalizeDirectorySuggestionsPayload", () => {
  it("preserves typed entries and payload fields", () => {
    const payload = {
      directories: ["/tmp/src"],
      entries: [
        { path: "src/index.ts", kind: "file" as const },
        { path: "src", kind: "directory" as const },
      ],
      error: null,
      requestId: "req-typed",
      futureOptionalField: "preserved",
    };

    expect(normalizeDirectorySuggestionsPayload(payload)).toEqual(payload);
  });

  it("projects legacy directories only when entries are missing", () => {
    expect(
      normalizeDirectorySuggestionsPayload({
        directories: ["/Users/test", "/Users/test/projects"],
        error: null,
        requestId: "req-legacy",
      }),
    ).toEqual({
      directories: ["/Users/test", "/Users/test/projects"],
      entries: [
        { path: "/Users/test", kind: "directory" },
        { path: "/Users/test/projects", kind: "directory" },
      ],
      error: null,
      requestId: "req-legacy",
    });
  });
});
