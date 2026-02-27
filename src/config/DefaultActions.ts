import { ActionHandler } from "../types/ActionTypes";
import defaultActions from "./default-actions.json";

export const DEFAULT_ACTIONS: ActionHandler[] = defaultActions as ActionHandler[];

export function getDefaultActionsConfig() {
  return { actions: DEFAULT_ACTIONS };
}
