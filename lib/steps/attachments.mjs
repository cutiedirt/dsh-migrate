/** 步骤：attachments —— 补齐内容寻址对象。契约见 docs/DESIGN.md。 */
export const step = 'attachments'
const later = () => { const e = new Error('attachments: 尚未实现（P2）'); e.code = 'ENOTIMPLEMENTED'; return e }
export async function plan() { throw later() }
export async function apply() { throw later() }
export async function verify() { throw later() }
