/** 步骤：usage —— 按天并集合并用量账本。契约见 docs/DESIGN.md。 */
export const step = 'usage'
const later = () => { const e = new Error('usage: 尚未实现（P2）'); e.code = 'ENOTIMPLEMENTED'; return e }
export async function plan() { throw later() }
export async function apply() { throw later() }
export async function verify() { throw later() }
