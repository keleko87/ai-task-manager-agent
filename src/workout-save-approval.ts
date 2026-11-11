import type { WorkoutExtraction } from "./workout-schema.js";
import type { WorkoutRunContext } from "./workout-context.js";

export interface WorkoutApprovalRequest {
  name: string | undefined;
}

export interface WorkoutApprovalState {
  approve(request: WorkoutApprovalRequest): void;
  reject(
    request: WorkoutApprovalRequest,
    options: { message: string },
  ): void;
}

export async function confirmAndResumeWorkoutSave<Result>(options: {
  workout: WorkoutExtraction;
  approval: WorkoutApprovalRequest;
  state: WorkoutApprovalState;
  context: WorkoutRunContext;
  confirm: () => Promise<boolean>;
  resume: () => Promise<Result>;
}): Promise<{ approved: false } | { approved: true; result: Result }> {
  if (!(await options.confirm())) {
    options.state.reject(options.approval, {
      message: "El usuario cancelo o rechazo el guardado.",
    });
    return { approved: false };
  }

  options.context.approvedWorkoutJson = JSON.stringify(options.workout);
  options.state.approve(options.approval);
  try {
    return { approved: true, result: await options.resume() };
  } finally {
    options.context.approvedWorkoutJson = null;
  }
}