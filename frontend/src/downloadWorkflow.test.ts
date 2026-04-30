import { describe, expect, it } from "vitest";
import { isJobReadyForModel } from "./downloadWorkflow";
import type { DownloadJob } from "./types";

describe("download workflow helpers", () => {
  it("only marks completed jobs with a primary GGUF as ready for model creation", () => {
    expect(isJobReadyForModel(jobWithFiles(["/models/chat/tiny/tiny.gguf"]), [])).toBe(true);
    expect(isJobReadyForModel(jobWithFiles(["/models/chat/tiny/mmproj-F16.gguf"]), [])).toBe(false);
    expect(isJobReadyForModel(jobWithFiles(["/models/chat/tiny/chat_template.jinja"]), [])).toBe(false);
  });
});

function jobWithFiles(paths: string[]): DownloadJob {
  return {
    id: "job",
    status: "completed",
    repo_id: "org/repo",
    revision: "main",
    files: [],
    destination_dir: "/models/chat/tiny",
    container_dir: "/models/chat/tiny",
    written_files: paths,
    container_files: paths,
    progress: 100,
    bytes_downloaded: 0,
    bytes_total: 0,
    active_file: "",
    logs: [],
    error: "",
  };
}
