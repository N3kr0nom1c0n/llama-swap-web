import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { TargetRig } from "./types";

interface TargetRigContextValue {
  targetRigId: string;
  setTargetRigId: (id: string) => void;
  targetRigs: TargetRig[];
  selectedRig: TargetRig | null;
}

const STORAGE_KEY = "llama-swap-manager.targetRigId";
const TargetRigContext = createContext<TargetRigContextValue | null>(null);

export function TargetRigProvider({ children, targetRigs }: { children: ReactNode; targetRigs: TargetRig[] }) {
  const selectableRigs = useMemo(() => {
    const enabled = targetRigs.filter((rig) => rig.enabled);
    return enabled.length ? enabled : targetRigs;
  }, [targetRigs]);
  const defaultRig = selectableRigs.find((rig) => rig.is_default) ?? selectableRigs[0] ?? null;
  const [targetRigId, setTargetRigIdState] = useState(() => readStoredRigId() || defaultRig?.id || "default");
  const selectedRig = selectableRigs.find((rig) => rig.id === targetRigId) ?? defaultRig;

  useEffect(() => {
    if (defaultRig && selectedRig?.id !== targetRigId) {
      setTargetRigIdState(defaultRig.id);
      storeRigId(defaultRig.id);
    }
  }, [defaultRig, selectedRig, targetRigId]);

  const value = useMemo<TargetRigContextValue>(
    () => ({
      targetRigId: selectedRig?.id ?? targetRigId,
      targetRigs: selectableRigs,
      selectedRig: selectedRig ?? null,
      setTargetRigId: (id: string) => {
        setTargetRigIdState(id);
        storeRigId(id);
      },
    }),
    [selectedRig, selectableRigs, targetRigId],
  );

  return <TargetRigContext.Provider value={value}>{children}</TargetRigContext.Provider>;
}

function readStoredRigId(): string {
  try {
    const storage = globalThis.localStorage;
    return typeof storage?.getItem === "function" ? storage.getItem(STORAGE_KEY) || "" : "";
  } catch {
    return "";
  }
}

function storeRigId(id: string): void {
  try {
    const storage = globalThis.localStorage;
    if (typeof storage?.setItem === "function") storage.setItem(STORAGE_KEY, id);
  } catch {
    // Storage can be unavailable in tests or locked-down browser contexts.
  }
}

export function useTargetRig() {
  const context = useContext(TargetRigContext);
  if (!context) {
    throw new Error("useTargetRig must be used inside TargetRigProvider");
  }
  return context;
}
