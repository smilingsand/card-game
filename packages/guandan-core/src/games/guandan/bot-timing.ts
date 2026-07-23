// Shared Guandan core source.
/**
 * 机器人仅在界面层等待；该等待不参与规则状态、事件流或存档。
 * 使用公开动作数量生成稳定的短暂变化，避免同类动作每次都显得瞬间完成。
 */
export function botThinkDelayMs(publicActionCount: number): number {
  return 800 + (publicActionCount % 4) * 180;
}
