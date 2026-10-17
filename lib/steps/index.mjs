/** 步骤注册表。顺序即默认执行顺序。 */
export const STEPS = ['sessions', 'workspace', 'attachments', 'usage', 'memory']

export async function loadStep(name) {
  switch (name) {
    case 'sessions': return import('./sessions.mjs')
    case 'workspace': return import('./workspace.mjs')
    case 'attachments': return import('./attachments.mjs')
    case 'usage': return import('./usage.mjs')
    case 'memory': return import('./memory.mjs')
    default: {
      const e = new Error(`未知步骤：${name}（可用：${STEPS.join(', ')}）`)
      e.code = 'EUNKNOWN_STEP'
      throw e
    }
  }
}
