#!/usr/bin/env node
/**
 * dsh-migrate CLI
 *   doctor   -c cfg        只读体检（配置、路径、node 能力、危险位置）
 *   plan     -c cfg        只读：列出将改动
 *   apply    -c cfg [--step s] [--write]
 *   verify   -c cfg [--step s] [--report out.json]
 *   rollback -m manifest.json
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig, sectionOf, KNOWN_STEPS } from '../lib/config.mjs'
import { loadStep, STEPS } from '../lib/steps/index.mjs'
import { createManifest, saveManifest, loadManifest, rollback } from '../lib/manifest.mjs'
import { makeLog, writeJson, nowStamp, isDangerousForSqlite } from '../lib/util.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

function parseArgs(argv) {
  const out = { _: [], write: false, json: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--write') out.write = true
    else if (a === '--json') out.json = true
    else if (a === '-c' || a === '--config') out.config = argv[++i]
    else if (a === '--step') out.step = argv[++i]
    else if (a === '--report') out.report = argv[++i]
    else if (a === '-m' || a === '--manifest') out.manifest = argv[++i]
    else if (a.startsWith('-')) { console.error(`未知参数：${a}`); process.exit(2) }
    else out._.push(a)
  }
  return out
}

function doctor(cfg, log) {
  const checks = []
  const push = (ok, name, detail) => { checks.push({ ok, name, detail }); log[ok ? 'info' : 'warn'](`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`) }
  push(Number(process.versions.node.split('.')[0]) >= 22 && Number(process.versions.node.split('.')[1]) >= 13,
    'node >= 22.13', process.versions.node)
  let zstd = false
  try { const z = require('node:zlib'); zstd = typeof z.zstdDecompressSync === 'function' } catch {}
  push(zstd, 'node:zlib zstd', zstd ? 'available' : 'missing')
  let sqlite = false
  try { const s = require('node:sqlite'); sqlite = typeof s.DatabaseSync === 'function' } catch {}
  push(sqlite, 'node:sqlite', sqlite ? 'available' : 'missing')
  for (const step of STEPS) {
    const sec = sectionOf(cfg, step)
    if (!sec) { push(true, `step ${step}`, '未配置，将跳过'); continue }
    const paths = []
    if (step === 'sessions') paths.push(sec.root)
    if (step === 'workspace') paths.push(sec.registry, sec.sessionsRoot).filter(Boolean)
    if (step === 'attachments') paths.push(sec.source, sec.target)
    if (step === 'usage') paths.push(...(sec.sources ?? []), sec.target)
    if (step === 'memory') paths.push(sec.source, sec.target)
    for (const p of paths.filter(Boolean)) {
      push(existsSync(p), `${step}: ${p}`, existsSync(p) ? '' : '不存在')
      if (step === 'memory' && isDangerousForSqlite(p)) {
        push(false, `${step}: ${p}`, 'SQLite 库位于 /mnt/*（drvfs/9p），WSL 侧访问会 I/O 报错，拒绝')
      }
    }
  }
  return checks
}

async function run() {
  const args = parseArgs(process.argv.slice(2))
  const cmd = args._[0]
  const log = makeLog({ json: args.json })

  if (!cmd || cmd === 'help' || cmd === '--help') {
    console.log(`dsh-migrate v${pkg.version}
用法：
  dsh-migrate doctor   -c migrate.json
  dsh-migrate plan     -c migrate.json
  dsh-migrate apply    -c migrate.json [--step sessions] [--write]
  dsh-migrate verify   -c migrate.json [--step sessions] [--report out.json]
  dsh-migrate rollback -m run-*/manifest.json`)
    return 0
  }

  if (cmd === 'rollback') {
    if (!args.manifest) { console.error('rollback 需要 -m <manifest.json>'); return 2 }
    const manifest = loadManifest(args.manifest)
    const r = rollback(manifest, { log })
    log.info(`rollback 完成：restored=${r.restored.length} skipped=${r.skipped.length} missingBackup=${r.missingBackup.length}`)
    if (r.missingBackup.length) log.warn(`缺少备份：${r.missingBackup.join(', ')}`)
    return r.missingBackup.length ? 1 : 0
  }

  if (!args.config) { console.error(`${cmd} 需要 -c <migrate.json>`); return 2 }
  const { config, errors } = loadConfig(args.config)
  if (errors.length) { errors.forEach((e) => log.error(`config: ${e}`)); return 2 }

  if (cmd === 'doctor') {
    const checks = doctor(config, log)
    const failed = checks.filter((c) => !c.ok).length
    log.info(`doctor: ${checks.length - failed}/${checks.length} 通过`)
    return failed ? 1 : 0
  }

  const steps = args.step ? [args.step] : STEPS
  const unknown = steps.filter((s) => !KNOWN_STEPS.includes(s))
  if (unknown.length) { log.error(`未知步骤：${unknown.join(', ')}`); return 2 }

  if (cmd === 'plan') {
    for (const name of steps) {
      const sec = sectionOf(config, name)
      if (!sec) { log.info(`${name}: 未配置，跳过`); continue }
      const mod = await loadStep(name)
      if (typeof mod.plan !== 'function') { log.warn(`${name}: 无 plan 实现`); continue }
      try {
        const r = await mod.plan(sec, { log })
        log.info(`${name}: ${JSON.stringify(r?.counts ?? r ?? {})}`)
      } catch (e) { log.error(`${name}: ${e.message}`); }
    }
    return 0
  }

  if (cmd === 'apply') {
    if (!args.write) { log.warn('dry-run（未给 --write）：只打印计划，不落盘') }
    const { dir, path, manifest } = createManifest(join(ROOT, 'run'), resolve(args.config))
    log.info(`manifest: ${path}`)
    for (const name of steps) {
      const sec = sectionOf(config, name)
      if (!sec) { log.info(`${name}: 未配置，跳过`); continue }
      const mod = await loadStep(name)
      try {
        const r = await mod.apply(sec, { log, manifest, write: args.write })
        log.info(`${name}: ${JSON.stringify(r)}`)
      } catch (e) { log.error(`${name}: ${e.message}`); if (args.write) { log.error('已停止后续步骤'); break } }
    }
    saveManifest(path, manifest)
    log.info(`manifest saved（备份 ${manifest.entries.length} 项）`)
    return 0
  }

  if (cmd === 'verify') {
    const report = { at: new Date().toISOString(), version: pkg.version, steps: {} }
    let bad = 0
    for (const name of steps) {
      const sec = sectionOf(config, name)
      if (!sec) continue
      const mod = await loadStep(name)
      try {
        report.steps[name] = await mod.verify(sec, { log })
      } catch (e) {
        report.steps[name] = { error: e.message }
        bad++
        log.error(`${name}: ${e.message}`)
      }
    }
    const out = args.report ?? join(ROOT, 'run', `${nowStamp()}-verify.json`)
    writeJson(out, report)
    log.info(`报告：${out}`)
    return bad ? 1 : 0
  }

  console.error(`未知命令：${cmd}`)
  return 2
}

run().then((code) => process.exit(code)).catch((e) => { console.error(e); process.exit(1) })
