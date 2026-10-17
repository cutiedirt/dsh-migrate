/**
 * projectKey(cwd) —— DSH 会话目录名的编码规则。
 *
 * 规则（0.2.0 实证）：
 *   - `/` `\` `:` 都算分隔符，**连续分隔符折成一个 `-`**；
 *   - 其余字符只保留 [A-Za-z0-9._-]，其它码位写成 `~XXXX`（4 位大写十六进制）；
 *   - 去掉开头 `-`，用 `--` 包裹，截到 251 字符；为空则用 `root`。
 *
 * 例：`D:\dshprograming` → `--D-dshprograming--`
 *     `/mnt/d/dshprograming` → `--mnt-d-dshprograming--`
 * 注意这两个是**不同**字符串，互不相等。
 *
 * @param {string} cwd
 * @returns {string}
 */
export function projectKey(cwd) {
  if (typeof cwd !== 'string' || cwd === '') return 'root'
  let out = ''
  let lastWasSep = false
  for (const ch of cwd) {
    const isSep = ch === '/' || ch === '\\' || ch === ':'
    if (isSep) {
      if (!lastWasSep) { out += '-'; lastWasSep = true }
      continue
    }
    lastWasSep = false
    if (/[A-Za-z0-9._-]/.test(ch)) out += ch
    else out += `~${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`
  }
  out = out.replace(/^-+/, '')
  out = `--${out}--`
  if (out.length > 251) out = out.slice(0, 251)
  return out === '----' ? 'root' : out
}

/** 会话目录名 → 规范化 sessionId（DSH 注册表里的形式：`session-<uuid>`）。 */
export function normalizeSessionId(dirName) {
  return dirName.startsWith('session-') ? dirName : `session-${dirName}`
}
