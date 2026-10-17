/** 步骤：workspace —— 对齐注册表与磁盘会话目录。契约见 docs/DESIGN.md。 */
export const step = 'workspace'
const later = () => { const e = new Error('workspace: 尚未实现（P2）'); e.code = 'ENOTIMPLEMENTED'; return e }
export async function plan() { throw later() }
export async function apply() { throw later() }
export async function verify() { throw later() }
