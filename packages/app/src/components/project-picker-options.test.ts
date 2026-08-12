import { describe, expect, it } from "vitest";
import {
  buildProjectPickerOptions,
  getProjectPickerDirectorySearchQuery,
  isOpenableProjectPath,
  shouldFetchAddProjectDirectories,
} from "./project-picker-options";

describe("getProjectPickerDirectorySearchQuery", () => {
  it("searches a single-segment POSIX path as a directory name", () => {
    expect(getProjectPickerDirectorySearchQuery("/docker")).toBe("docker");
    expect(getProjectPickerDirectorySearchQuery("/docker/")).toBe("docker");
  });

  it("preserves directory names and unambiguous paths", () => {
    expect(getProjectPickerDirectorySearchQuery("docker")).toBe("docker");
    expect(getProjectPickerDirectorySearchQuery("~/docker")).toBe("~/docker");
    expect(getProjectPickerDirectorySearchQuery("/home/ubuntu/docker")).toBe("/home/ubuntu/docker");
    expect(getProjectPickerDirectorySearchQuery("/")).toBe("/");
  });
});

describe("isOpenableProjectPath", () => {
  it("accepts POSIX, tilde, Windows drive-letter, and UNC paths", () => {
    expect(isOpenableProjectPath("/repo")).toBe(true);
    expect(isOpenableProjectPath("~/src")).toBe(true);
    expect(isOpenableProjectPath("C:\\Users\\mo")).toBe(true);
    expect(isOpenableProjectPath("c:/users/mo")).toBe(true);
    expect(isOpenableProjectPath("\\\\server\\share")).toBe(true);
  });

  it("rejects relative input", () => {
    expect(isOpenableProjectPath("repo")).toBe(false);
    expect(isOpenableProjectPath("repo/sub")).toBe(false);
    expect(isOpenableProjectPath("c:repo")).toBe(false);
    expect(isOpenableProjectPath("")).toBe(false);
  });
});

describe("buildProjectPickerOptions", () => {
  it("does not create an open-path row for word queries", () => {
    const options = buildProjectPickerOptions({
      recommendedPaths: ["/repo/api"],
      serverPaths: ["/repo/app"],
      query: "repo",
    });

    expect(options).toEqual([
      { kind: "suggestion", path: "/repo/api" },
      { kind: "suggestion", path: "/repo/app" },
    ]);
  });

  it("puts an absolute path row first", () => {
    const options = buildProjectPickerOptions({
      recommendedPaths: ["/repo/api"],
      serverPaths: ["/repo/api"],
      query: "/repo",
    });

    expect(options).toEqual([
      { kind: "path", path: "/repo" },
      { kind: "suggestion", path: "/repo/api" },
    ]);
  });

  it("puts directory-name matches before an ambiguous literal POSIX path", () => {
    const options = buildProjectPickerOptions({
      recommendedPaths: [],
      serverPaths: ["/home/ubuntu/docker"],
      query: "/docker",
      searchQuery: "docker",
    });

    expect(options).toEqual([
      { kind: "suggestion", path: "/home/ubuntu/docker" },
      { kind: "path", path: "/docker" },
    ]);
  });

  it("puts a home-relative path row first", () => {
    const options = buildProjectPickerOptions({
      recommendedPaths: ["/Users/mo/src/api"],
      serverPaths: ["/Users/mo/src/api"],
      query: "~/src",
    });

    expect(options).toEqual([
      { kind: "path", path: "~/src" },
      { kind: "suggestion", path: "/Users/mo/src/api" },
    ]);
  });

  it("creates an open-path row for Windows paths", () => {
    const options = buildProjectPickerOptions({
      recommendedPaths: [],
      serverPaths: [],
      query: "C:\\Users\\mo\\src",
    });

    expect(options).toEqual([{ kind: "path", path: "C:\\Users\\mo\\src" }]);
  });

  it("does not duplicate an existing suggestion", () => {
    const options = buildProjectPickerOptions({
      recommendedPaths: ["/repo/api"],
      serverPaths: ["/repo/app"],
      query: "/repo/app",
    });

    expect(options).toEqual([{ kind: "suggestion", path: "/repo/app" }]);
  });

  it("merges recommended and daemon directories once with stable order", () => {
    expect(
      buildProjectPickerOptions({
        recommendedPaths: ["/Users/me/projects/paseo", "/Users/me/archive/old"],
        serverPaths: ["/Users/me/projects/paseo", "/Users/me/projects/playground"],
        query: "pso",
      }),
    ).toEqual([
      { kind: "suggestion", path: "/Users/me/projects/paseo" },
      { kind: "suggestion", path: "/Users/me/projects/playground" },
    ]);
  });

  it("does not locally reinterpret a daemon result for a correlated query", () => {
    expect(
      buildProjectPickerOptions({
        recommendedPaths: [],
        serverPaths: ["/Users/me/projects/ranked-by-daemon"],
        query: "a-query-owned-by-the-daemon",
      }),
    ).toEqual([{ kind: "suggestion", path: "/Users/me/projects/ranked-by-daemon" }]);
  });
});

describe("shouldFetchAddProjectDirectories", () => {
  it("skips blank home searches so recommendations do not trigger a full-home scan", () => {
    expect(shouldFetchAddProjectDirectories("")).toBe(false);
    expect(shouldFetchAddProjectDirectories("   ")).toBe(false);
  });

  it("fetches once the user has a non-empty query", () => {
    expect(shouldFetchAddProjectDirectories("paseo")).toBe(true);
    expect(shouldFetchAddProjectDirectories("~/projects")).toBe(true);
  });
});
