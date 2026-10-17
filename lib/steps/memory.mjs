/** 步骤：memory —— SQLite 记忆库离线并集合并（只读源）。契约见 docs/DESIGN.md。 */
export const step = 'memory'
const later = () => { const e = new Error('memory: 尚未实现（P2）'); e.code = 'ENOTIMPLEMENTED'; return e }
export async function plan() { throw later() }
export async function apply() { throw later() }
export async function verify() { throw later() }
