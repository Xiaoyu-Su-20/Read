type AutoFitCycleSnapshot = {
  fitCycleId: string;
  normalizationToken: string | null;
  pageNumber: number | null;
  proposedMinDocumentWidth: number | null;
};

let currentAutoFitCycle: AutoFitCycleSnapshot | null = null;
let autoFitCycleSequence = 0;

export function beginAutoFitCycle(snapshot: Omit<AutoFitCycleSnapshot, "fitCycleId">) {
  autoFitCycleSequence += 1;
  currentAutoFitCycle = {
    fitCycleId: `fit-${autoFitCycleSequence}`,
    ...snapshot
  };
  return currentAutoFitCycle;
}

export function getCurrentAutoFitCycle() {
  return currentAutoFitCycle;
}
