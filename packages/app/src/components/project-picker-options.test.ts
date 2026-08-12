import { describe, expect, it } from "vitest";
import {
  buildDirectoryBrowseOptions,
  buildProjectPickerOptions,
  getDirectoryBrowseTarget,
  isOpenableProjectPath,
  resolveDirectoryBrowseEntries,
  shouldFetchAddProjectDirectories,
} from "./project-picker-options";

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

  it("keeps daemon-ranked directory matches after an absolute path", () => {
    const options = buildProjectPickerOptions({
      recommendedPaths: [],
      serverPaths: ["/home/ubuntu/docker"],
      query: "/docker",
    });

    expect(options).toEqual([
      { kind: "path", path: "/docker" },
      { kind: "suggestion", path: "/home/ubuntu/docker" },
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

describe("buildDirectoryBrowseOptions", () => {
  it("returns the requested directory followed only by direct child directories", () => {
    expect(
      buildDirectoryBrowseOptions({
        path: "/docker",
        pathExists: true,
        childPaths: ["/docker/compose", "/docker/data", "/docker/compose"],
      }),
    ).toEqual([
      { kind: "path", path: "/docker" },
      { kind: "suggestion", path: "/docker/compose" },
      { kind: "suggestion", path: "/docker/data" },
    ]);
  });

  it("does not create rows for blank paths or blank children", () => {
    expect(
      buildDirectoryBrowseOptions({
        path: "  ",
        pathExists: false,
        childPaths: ["/docker/data"],
      }),
    ).toEqual([]);
    expect(
      buildDirectoryBrowseOptions({
        path: "/docker",
        pathExists: true,
        childPaths: ["", " /docker "],
      }),
    ).toEqual([{ kind: "path", path: "/docker" }]);
  });

  it("does not offer a nonexistent typed path as openable", () => {
    expect(
      buildDirectoryBrowseOptions({
        path: "/docker",
        pathExists: false,
        childPaths: ["/docker_data"],
      }),
    ).toEqual([{ kind: "suggestion", path: "/docker_data" }]);
  });

  it("keeps a nonexistent path selectable when there are no fuzzy matches", () => {
    expect(
      buildDirectoryBrowseOptions({
        path: "/missing",
        pathExists: false,
        childPaths: [],
      }),
    ).toEqual([{ kind: "path", path: "/missing" }]);
  });
});

describe("directory path completion", () => {
  it("splits an entered path into its parent and fuzzy name query", () => {
    expect(getDirectoryBrowseTarget("/docker")).toEqual({
      requestedPath: "/docker",
      parentPath: "/",
      nameQuery: "docker",
    });
    expect(getDirectoryBrowseTarget("~/projects/pas")).toEqual({
      requestedPath: "~/projects/pas",
      parentPath: "~/projects",
      nameQuery: "pas",
    });
  });

  it("treats a trailing separator as an explicit directory listing", () => {
    expect(getDirectoryBrowseTarget("/docker_data/")).toEqual({
      requestedPath: "/docker_data",
      parentPath: "/docker_data",
      nameQuery: "",
    });
  });

  it("matches /docker to real siblings such as /docker_data without a global search", () => {
    expect(
      resolveDirectoryBrowseEntries({
        target: getDirectoryBrowseTarget("/docker")!,
        directoryNames: ["root", "docker_data", "root-docker-migrate"],
        limit: 30,
      }),
    ).toEqual({ exactPath: null, matchingPaths: ["/docker_data", "/root-docker-migrate"] });
  });

  it("supports typo-tolerant path segment matching", () => {
    expect(
      resolveDirectoryBrowseEntries({
        target: getDirectoryBrowseTarget("/dokcer")!,
        directoryNames: ["docker_data", "documents"],
        limit: 30,
      }).matchingPaths,
    ).toEqual(["/docker_data"]);
  });

  it("marks an exact directory so its children can be listed", () => {
    expect(
      resolveDirectoryBrowseEntries({
        target: getDirectoryBrowseTarget("/docker_data")!,
        directoryNames: ["docker", "docker_data"],
        limit: 30,
      }),
    ).toEqual({
      exactPath: "/docker_data",
      matchingPaths: ["/docker_data"],
    });
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
