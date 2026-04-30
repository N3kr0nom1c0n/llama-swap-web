import { CheckCircle2, CircleAlert, Clock3, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import type { JobStatus } from "../types";
import { classNames } from "../utils";

type Tone = "ok" | "warn" | "bad" | "idle" | "run";

interface StatusPillProps {
  tone?: Tone;
  children: ReactNode;
}

export function StatusPill({ tone = "idle", children }: StatusPillProps) {
  const Icon = tone === "ok" ? CheckCircle2 : tone === "bad" ? CircleAlert : tone === "run" ? LoaderCircle : Clock3;
  return (
    <span className={classNames("status-pill", `status-${tone}`)}>
      <Icon size={14} aria-hidden="true" />
      {children}
    </span>
  );
}

export function JobStatusPill({ status }: { status: JobStatus }) {
  const tone: Tone = status === "completed" ? "ok" : status === "failed" || status === "cancelled" ? "bad" : status === "running" ? "run" : "idle";
  return <StatusPill tone={tone}>{status}</StatusPill>;
}
