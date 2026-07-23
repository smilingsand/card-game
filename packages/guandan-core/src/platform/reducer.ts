// Shared Guandan core source.
export interface ValidationError {
  readonly code: string;
}

export type ValidationResult =
  { readonly valid: true } | { readonly valid: false; readonly code: string };

export interface ActionReducer<State, TAction> {
  validateAction(state: State, action: TAction): ValidationResult;
  applyAction(state: State, action: TAction): State;
}

export type ActionApplication<State> =
  | { readonly valid: true; readonly state: State }
  | {
      readonly valid: false;
      readonly state: State;
      readonly error: ValidationError;
    };

/** 仅在动作已通过校验时调用 reducer，非法动作返回原状态引用。 */
export function applyValidatedAction<State, TAction>(
  reducer: ActionReducer<State, TAction>,
  state: State,
  action: TAction,
): ActionApplication<State> {
  const validation = reducer.validateAction(state, action);
  if (!validation.valid) {
    return { valid: false, state, error: { code: validation.code } };
  }

  return { valid: true, state: reducer.applyAction(state, action) };
}
