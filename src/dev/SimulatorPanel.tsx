import { useId, useRef } from "react";
import { usePublicationActions, usePublicationStore } from "../app/hooks";
import { ANNOUNCEMENT_SCENARIOS, type AnnouncementScenario } from "../mocks";
import { Button, ConfirmDialog, type ConfirmDialogHandle } from "../ui";

const SCENARIO_DESCRIPTIONS: Record<AnnouncementScenario, string> = {
  success: "Publishes after a short processing time.",
  "explicit-rejection": "The service rejects the announcement with a reason.",
  "lost-response": "The first publish response is lost; publication continues.",
  "status-check-failure": "The first response is lost and the first status read fails.",
  overlapping: "Each announcement has its own timing; replies arrive out of order.",
  "slow-response": "The publish response is slow; publication can finish first.",
};

function isScenario(value: string): value is AnnouncementScenario {
  return (ANNOUNCEMENT_SCENARIOS as readonly string[]).includes(value);
}

/**
 * Development tool to drive the mock service. Rendered in production builds too, so
 * reviewers can try every scenario. Not a product feature: it is styled apart on purpose.
 * Service calls go through store actions (`setScenario`, `resetSimulation`).
 */
export function SimulatorPanel() {
  const scenario = usePublicationStore((state) => state.scenario);
  const { setScenario, resetSimulation } = usePublicationActions();
  const selectId = useId();
  const descriptionId = useId();
  const noteId = useId();
  const dialogRef = useRef<ConfirmDialogHandle>(null);
  const resetRef = useRef<HTMLButtonElement>(null);

  return (
    <details className="rounded-md border border-dashed border-slate-400 bg-slate-50 text-sm text-slate-700 dark:border-slate-600 dark:bg-slate-900/50 dark:text-slate-300">
      <summary className="cursor-pointer rounded-md px-4 py-2 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
        Simulation controls (development tool, not a product feature)
      </summary>

      <div className="space-y-4 border-t border-dashed border-slate-400 px-4 py-3 dark:border-slate-600">
        <div className="space-y-1">
          <label htmlFor={selectId} className="block font-medium">
            Scenario
          </label>
          <select
            id={selectId}
            value={scenario}
            aria-describedby={`${descriptionId} ${noteId}`}
            onChange={(event) => {
              const { value } = event.target;
              if (isScenario(value)) setScenario(value);
            }}
            className="block w-full max-w-md rounded-md border border-slate-300 bg-white px-2 py-1.5 text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
          >
            {ANNOUNCEMENT_SCENARIOS.map((name) => (
              <option key={name} value={name}>
                {name} — {SCENARIO_DESCRIPTIONS[name]}
              </option>
            ))}
          </select>
          <p id={descriptionId} className="break-words">
            {SCENARIO_DESCRIPTIONS[scenario]}
          </p>
          <p id={noteId} className="text-xs text-slate-600 dark:text-slate-400">
            Applies to new attempts only.
          </p>
        </div>

        <Button
          ref={resetRef}
          variant="secondary"
          aria-haspopup="dialog"
          onClick={() => dialogRef.current?.open()}
        >
          Reset simulation
        </Button>
        <ConfirmDialog
          ref={dialogRef}
          title="Reset the simulation?"
          description="This clears every simulated service record and publication attempt, and restores the default scenario."
          confirmLabel="Reset simulation"
          returnFocusRef={resetRef}
          onConfirm={() => {
            void resetSimulation();
            resetRef.current?.focus();
          }}
        />
      </div>
    </details>
  );
}
