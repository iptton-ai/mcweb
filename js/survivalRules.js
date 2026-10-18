import { isCreative, state } from "./state.js";
import { clearBuildQueue } from "./buildQueue.js";
export function canUseFreeBuild() {
  return (
    !state.levelRun &&
    (isCreative() || !!state.levelEdit || state.survivalRules === "experiment")
  );
}
export const FREE_BUILD_REASON =
  "标准生存中 AI 提供材料清单和步骤；免费建造与源码改写需要在设置 → 生存中明确选择「自由实验」。";
export function setSurvivalRules(value) {
  state.survivalRules = value === "experiment" ? "experiment" : "standard";
  if (!canUseFreeBuild()) clearBuildQueue({settleApplied:true});
}
