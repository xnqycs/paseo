import { describe, expect, it } from "vitest";
import { describeFileEntries, describeWorkspaceFilePath } from "./workspace-file-search-model";

describe("describeWorkspaceFilePath", () => {
  it("separates a workspace-relative file into its row labels", () => {
    expect(describeWorkspaceFilePath("src/components/message.tsx")).toEqual({
      path: "src/components/message.tsx",
      name: "message.tsx",
      directory: "src/components",
    });
  });

  it("normalizes Windows separators before opening or presenting a file", () => {
    expect(describeWorkspaceFilePath("src\\components\\message.tsx")).toEqual({
      path: "src/components/message.tsx",
      name: "message.tsx",
      directory: "src/components",
    });
  });

  it("keeps root files free of a redundant directory label", () => {
    expect(describeWorkspaceFilePath("package.json")).toEqual({
      path: "package.json",
      name: "package.json",
      directory: "",
    });
  });
});

describe("describeFileEntries", () => {
  it("excludes directory entries projected from a legacy directories-only response", () => {
    const legacyDirectories = ["/Users/test", "/Users/test/projects"];
    const normalizedEntries = legacyDirectories.map((path) => ({
      path,
      kind: "directory" as const,
    }));

    expect(describeFileEntries(normalizedEntries)).toEqual([]);
  });

  it("preserves file order while excluding directory entries", () => {
    expect(
      describeFileEntries([
        { path: "src", kind: "directory" },
        { path: "src/index.ts", kind: "file" },
        { path: "README.md", kind: "file" },
      ]),
    ).toEqual([
      { path: "src/index.ts", name: "index.ts", directory: "src" },
      { path: "README.md", name: "README.md", directory: "" },
    ]);
  });
});
