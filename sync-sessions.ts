import { iterLines } from "@node-ext/str"
import { spawn } from "child_process"
import { defaultOptions, validateMode } from "./config"
import { Mode, SyncConfig, SyncOptions } from "./types"
// use run ship with node_ext
import { run } from "@node-ext/cmd"
import { resolveShellPath } from "@node-ext/env"
import { locked } from "@node-ext/lock"
import { mkdir, readFile, writeFile, stat } from "fs/promises"
import { dirname } from "path"
import * as moment from "moment"

export const StatusWatching = 'Watching for changes'
export const StatusPaused = '[Paused]'
export const StatusNotExists = '[NotExists]' // fake by us
export type SyncStatus = 'Watching for changes' | 'Scanning files' | 'Connecting to beta' | '[Paused]' | '[NotExists]'

let syncConfigs: SyncConfig[]
export function setSyncConfigs(e: SyncConfig[]) {
  syncConfigs = e
}

export interface SyncInfo {
  name: string
  identifier: string
  status: SyncStatus
}

export interface CreateSyncOptions extends SyncOptions {
  debug?: boolean
  forceRecreate?: boolean
  cachedSyncInfo?: SyncInfo
  actualMode?: RecreateOptions["mode"]
}

// mutagen name cannot contain _
export function normalizeMutagenName(name: string): string {
  return name.replaceAll("_", "-")
}

export async function createSync(actualName: string, srcDir: string, dstDir: string, options?: CreateSyncOptions) {
  if (!actualName) {
    throw new Error("create sync requires name")
  }

  // console.log("createSync:", name, srcDir, dstDir, options)

  let needCreate = true
  let needTerminate = false
  let needResume = false
  let cmds: String[] = []
  if (options?.forceRecreate) {
    needTerminate = true
  } else {
    const syncInfo = options?.cachedSyncInfo || await getSyncInfo(actualName)
    // console.log("syncInfo:", syncInfo)
    if (syncInfo && syncInfo.status !== StatusNotExists) {
      needCreate = false
      if (syncInfo.status === StatusPaused) {
        needResume = true
      }
    }
  }

  const cmdPath = resolveShellPath(`~/.nx-sync/${actualName}/cmd`)
  const createCmd = formatCreateSyncCommand(actualName, srcDir, dstDir, options)

  let needWriteCmd = needCreate
  let dirMade = false
  if (!needCreate) {
    // if said not need create by previous, we check the command again
    await mkdir(dirname(cmdPath), { recursive: true })
    dirMade = true
    const prevCmd = await readFile(cmdPath, { encoding: 'utf-8' }).catch(e => { })
    // console.log("preCmd:", prevCmd !== createCmd, prevCmd, createCmd)
    if (prevCmd !== createCmd) {
      needWriteCmd = true
      needCreate = true
      needResume = false
    }
  }

  if (needTerminate) {
    const stopCmd = `mutagen sync terminate ${normalizeMutagenName(actualName)} &>/dev/null || true`
    cmds.push(stopCmd)
  }
  if (needResume) {
    // resumue
    cmds.push(`mutagen sync resume ${normalizeMutagenName(actualName)}`)
  }
  if (needCreate) {
    cmds.push(createCmd)
  }

  if (options?.debug) {
    // console.log("cmdPath:", cmdPath, "needWriteCmd:", needWriteCmd)
  }

  const cmdJoin = cmds.join("\n")
  // const debug = false
  await run(cmdJoin, { debug: options?.debug })
  // console.log("writeCmd:", needWriteCmd, createCmd)
  if (needWriteCmd) {
    if (options?.debug) {
      console.log("persist create cmd:", cmdPath, createCmd)
    }
    if (!dirMade) {
      await mkdir(dirname(cmdPath), { recursive: true })
    }
    await writeFile(cmdPath, createCmd)
  }
}

export async function flushSync(name: string) {
  await run(`mutagen sync flush ${normalizeMutagenName(name)}`)
}

export async function terminateSync(name: string) {
  await run(`mutagen sync terminate ${normalizeMutagenName(name)} || true`)
}
export async function pauseSync(name: string) {
  await run(`mutagen sync pause ${normalizeMutagenName(name)} || true`)
}
export async function resumeSync(name: string) {
  await run(`mutagen sync resume ${normalizeMutagenName(name)} || true`)
}

/*
example:
--------------------------------------------------------------------------------
Name: code-lens
Identifier: sync_OXV9ouDa8v5gaCmVkHC4wHgzp2QpXvVW5JOud6pQvBc
Labels: None
Alpha:
        URL: /Users/xhd2015/Projects/gopath/src/Y/X/Z
        Connection state: Connected
        Scan problems:
                support/admin/node_modules: invalid symbolic link: target is absolute
                support/login/node_modules: invalid symbolic link: target is absolute
Beta:
        URL: x@devhost:/home/X/Projects/gopath/src/Y/X/Z
        Connection state: Connected
Status: Watching for changes
*/
export async function listSync(): Promise<SyncInfo[]> {
  return new Promise((resolve, reject) => {
    const ps = spawn("mutagen", ["sync", "list"])
    ps.on('error', e => {
      reject(e)
    })
    let data = ''
    ps.stdout.on('data', str => {
      data += str
    })

    let res: SyncInfo[] = []
    ps.stdout.on('end', () => {
      let info: SyncInfo | null
      const endLast = () => {
        if (info) {
          res.push(info)
          info = null
        }
      }
      iterLines(data, (i, j) => {
        const line = data.slice(i, j)
        if (/^-+$/.test(line)) {
          endLast()
          return
        }
        const idx = line.indexOf(":")
        if (idx > 0) {
          const prop = line.slice(0, idx).trim()
          const val = line.slice(idx + 1)
          if (prop === 'Name' || prop === 'Identifier' || prop === 'Status') {
            if (!info) {
              info = {} as SyncInfo
            }
            info[prop.toLowerCase()] = val.trim()
          }
        }
      })
      endLast()
      resolve(res)
    })
  })
}


export async function listSyncMapping(): Promise<{ [name: string]: SyncInfo }> {
  const sync = await listSync()
  const mapping = {}
  sync?.forEach?.(e => {
    mapping[e.name] = e
  })
  return mapping
}
export async function getSyncInfo(name: string): Promise<SyncInfo | undefined> {
  const syncInfos = await listSync()
  for (const syncInfo of (syncInfos || [])) {
    if (syncInfo.name === normalizeMutagenName(name)) {
      return syncInfo
    }
  }
  return undefined
}

function resolveActualName(name: string, actualMode: CreateSyncOptions["actualMode"]): string {
  if (!actualMode) {
    return name
  }
  return name + "-" + actualMode
}
function formatCreateSyncCommand(actualName: string, srcDir: string, dstDir: string, options?: CreateSyncOptions): string {
  if (!actualName) {
    throw new Error("requries name")
  }
  if (!srcDir) {
    throw new Error("requries srcDir")
  }
  if (!dstDir) {
    throw new Error("requries dstDir")
  }

  const opts = { ...defaultOptions, ...options }

  let dirOpts: SyncOptions = { ...opts }
  let mode = opts.mode
  if (options?.actualMode) {
    if (options.actualMode === "alpha-to-beta") {
      mode = "two-way-resolved"
    } else if (options?.actualMode === "alpha-replica") {
      mode = "one-way-replica"
    } else if (options?.actualMode === "beta-to-alpha" || options?.actualMode === "beta-replica") {
      mode = "two-way-resolved";
      if (options?.actualMode === "beta-replica") {
        mode = "one-way-replica"
      }

      // exchange alpha and beta
      [
        dirOpts.defaultOwnerAlpha, dirOpts.defaultGroupAlpha,
        dirOpts.defaultOwnerBeta, dirOpts.defaultGroupBeta,
      ] = [
          dirOpts.defaultOwnerBeta, dirOpts.defaultGroupBeta,
          dirOpts.defaultOwnerAlpha, dirOpts.defaultGroupAlpha,
        ];
      // exchange watch polling
      [dirOpts.watchPollingIntervalAlpha, dirOpts.watchPollingIntervalBeta] = [dirOpts.watchPollingIntervalBeta, dirOpts.watchPollingIntervalAlpha];
      // exchange dir
      [srcDir, dstDir] = [dstDir, srcDir]
    } else if (options?.actualMode === "safe") {
      mode = "two-way-safe"
    }
  }
  // mutagen sync create --sync-mode=two-way-resolved \
  //     --name=sync-x-y \
  //     --default-owner-alpha=xhd2015 \
  //     --default-group-alpha=staff \
  //     --default-owner-beta=X \
  //     --default-group-beta=X \
  //     --ignore=.git/index.lock \
  //     --ignore=.git \
  //     --watch-polling-interval-alpha=120 \
  //     --watch-polling-interval-beta=1800 \
  //     ~/Projects/gopath/src/Y/X/Z \
  //     X@devhost:/home/X/Projects/gopath/src/Y/X/Z
  const ignoreOpts = opts.ignores?.map?.(e => `  --ignore="${e}" `)?.join("\\\n") || ""

  // mode: two-way-safe: no data loss
  //       two-way-resolved: alpha wins conflicts, may cause data loss
  return `mutagen sync create --sync-mode=${mode || "two-way-safe"} \\
  --name=${normalizeMutagenName(actualName)} \\
  --default-owner-alpha=${dirOpts.defaultOwnerAlpha} \\
  --default-group-alpha=${dirOpts.defaultGroupAlpha} \\
  --default-owner-beta=${dirOpts.defaultOwnerBeta} \\
  --default-group-beta=${dirOpts.defaultGroupBeta} \\
${ignoreOpts}  --watch-polling-interval-alpha=${opts.watchPollingIntervalAlpha} \\
  --watch-polling-interval-beta=${opts.watchPollingIntervalBeta} \\
  ${srcDir} \\
  ${dstDir}
  `
}

// parse groups, if groups is undefined, all configs are returned
export function forEachSync<T>(groups: string[] | undefined, fn: (conf: SyncConfig) => T): T[] {
  const res: T[] = []
  for (const conf of syncConfigs) {
    let found = false
    for (let group of (groups || [])) {
      if (conf.groups?.includes?.(group) || conf.name === group) {
        found = true
        break
      }
    }
    if (found || !((groups as any)?.length > 0)) {
      res.push(fn(conf))
    }
  }
  return res
}
async function sleep(ms: number) {
  if (ms > 0) {
    await new Promise(resolve => setTimeout(resolve, ms))
  }
}

export interface CmdOptions {
  debug?: boolean
  mode?: Mode
}

export async function syncCmd(cmd: string, groups?: string[], opts?: CmdOptions) {
  if (!cmd) {
    throw new Error("requires sync cmd")
  }
  validateMode(opts?.mode)
  const names: string[] = []
  forEachSync(groups, conf => {
    if (checkModeDisabled(conf, opts?.mode)) {
      return
    }
    const actualConfName = resolveActualName(conf.name, opts?.mode)
    names.push(actualConfName)
  })
  if (!names?.length) {
    if (cmd === "show") {
      return
    }
    throw new Error(`no session to ${cmd}`)
  }
  const syncMapping = await listSyncMapping()
  if (cmd === "show") {
    console.log(names.map(e => {
      if (!syncMapping[e]) {
        return `${e} [MISSING]`
      }
      return e
    }).join("\n"))
    return
  }
  const liveNames = names.filter(e => syncMapping[e])
  if (!liveNames?.length) {
    throw new Error(`all sessions are missing`)
  }
  run(`mutagen sync ${cmd} ${liveNames.map(e => normalizeMutagenName(e)).join(" ")}`, { debug: opts?.debug })
}

function checkModeDisabled(conf: SyncConfig, mode: Mode): boolean {
  if (!mode) {
    return false
  }
  if (conf?.disableMode?.includes?.(mode)) {
    return true
  }
  return false
}

export interface RecreateOptions {
  // cmd: "flush" | "terminate" | "list"
  debug?: boolean
  forceUnlock?: boolean
  pause?: boolean // default true

  // if the target sync already exists, termiante it and recreate it
  forceRecreate?: boolean

  pauseAfterSync?: boolean // default true
  terminateAfterSync?: boolean
  mode?: Mode

  silentSyncError?: boolean
  onSyncStatusUpdate?: (name: string, stage: Stage, err: Error) => Promise<void>
}

// no overhead
export async function recreateAndSync(groups?: string[], opts?: RecreateOptions) {
  validateMode(opts?.mode)
  const syncs = await listSync()

  // if there are multiple session for one name, we stop it
  const namesCount = {}
  syncs?.forEach?.(e => {
    namesCount[e.name] = (namesCount[e.name] || 0) + 1
  })

  const syncMapping = syncs?.reduce?.((prev, e) => ({ ...prev, [e.name]: e }), {})

  const stopActions: (() => Promise<void>)[] = []
  let names: string[] = []
  const namesToConf: { [name: string]: SyncConfig } = {}

  const doSyncLocked = async (conf: SyncConfig, actualConfName: string) => {
    const syncInfo = syncMapping[normalizeMutagenName(actualConfName)] || { name: normalizeMutagenName(actualConfName), status: StatusNotExists } as SyncInfo
    console.log(`flushing ${actualConfName}`)
    names.push(actualConfName)
    namesToConf[actualConfName] = conf

    // will resume or create
    await createSync(actualConfName, conf.srcDir, conf.dstDir, {
      ...conf.options,
      actualMode: opts?.mode,
      debug: opts?.debug,
      forceRecreate: namesCount[actualConfName] > 1 || opts?.forceRecreate, // if having multiple names, we stop all of them because its possibly duplicate
      cachedSyncInfo: syncInfo,
    })
    await flushSync(actualConfName)

    // at least wait for 5 minutes to let all sync done
    const endMode = opts?.terminateAfterSync ? "terminate" : (opts?.pauseAfterSync !== false ? "pause" : "")
    if (!endMode) {
      return
    }
    stopActions.push(async () => {
      // stop it so that does not affect normal work
      if (endMode === "terminate") {
        console.log(`cleanup ${actualConfName}`)
        await terminateSync(actualConfName)
      } else if (endMode === "pause") {
        console.log(`pausing ${actualConfName}`)
        await pauseSync(actualConfName)
      }
    })
  }

  // no more than 5 at the same time
  const liveLimit = 5
  let live = 0
  let count = 0
  const actions = forEachSync(groups, async conf => {
    const actualConfName = resolveActualName(conf.name, opts?.mode)
    if (checkModeDisabled(conf, opts?.mode)) {
      console.log(`${actualConfName} skipped because disabled`)
      return
    }

    // rate limiting live tasks
    if (live >= liveLimit) {
      let task
      await new Promise((resolve) => {
        task = setInterval(() => {
          if (live < liveLimit) {
            resolve(true)
          }
        }, 1 * 1000)
      })
      clearInterval(task)
    }

    live++

    try {
      count++
      // console.log("sync:", conf)
      const ok = await locked(resolveShellPath(`~/.nx-sync/${actualConfName}`), 5 * 60 * 1000, opts?.forceUnlock, async locker => {
        let err: Error
        await doSyncLocked(conf, actualConfName).catch(e => err = e)
        if (err) {
          if (opts?.onSyncStatusUpdate) {
            await opts.onSyncStatusUpdate(conf.name, "init", err)
          }
          if (!opts.silentSyncError) {
            throw err
          }
        } else {
          if (opts?.onSyncStatusUpdate) {
            await opts.onSyncStatusUpdate(conf.name, "flusing", undefined)
          }
        }
      })
      if (!ok) {
        console.log(`another sync session is running, skipped: ${actualConfName}`)
      }
    } finally {
      live--
    }
  })
  await Promise.all(actions)
  if (count === 0) {
    throw new Error("no session to sync.")
  }

  if (stopActions.length === 0) {
    return
  }

  if (opts.pause === false) {
    return
  }

  // wait until all becomes Watching
  let printWaitTimeTask
  let timeoutTask
  const printWaitTimePromise = new Promise(resolve => {
    const t = 5 * 60 * 1000
    console.log(`waiting for 5 minutes before sync pause or terminate`)
    const start = new Date().getTime()
    const end = start + t

    printWaitTimeTask = setInterval(() => {
      const now = new Date().getTime();
      const left = Math.floor((end - now) / 1000)
      const padLeft = String(left).padStart(3, " ")
      process.stdout.write(`\rleft ${padLeft}s`)
    }, 1 * 1000)

    timeoutTask = setTimeout(() => {
      resolve(true)
    }, t)
  })

  let checkTask
  const checkAllTaskDonePromise = new Promise(resolve => {
    const checkAllTaskDone = async (): Promise<boolean> => {
      const syncMapping = await listSyncMapping()
      // console.log("check syncMapping:", syncMapping)
      let allDone = true
      for (let name of names) {
        const status = syncMapping?.[normalizeMutagenName(name)]?.status
        if (syncMapping?.[normalizeMutagenName(name)]?.status !== StatusWatching) {
          console.log(`still working ${name}: ${status}`)
          allDone = false
          if (!opts?.onSyncStatusUpdate) {
            return false
          }
          continue
        }
        if (opts?.onSyncStatusUpdate) {
          const confName = namesToConf[name]?.name
          if (confName) {
            await opts.onSyncStatusUpdate(confName, "done", undefined)
          }
        }
      }
      return allDone
    }

    let i = 0
    checkTask = setInterval(() => {
      checkAllTaskDone().then(done => {
        if (done) {
          i++
          // at least 5 times
          if (i >= 5) {
            console.log("\nall task done")
            resolve(true)
          }
        }
      }).catch(e => {/*ignore*/ })
    }, 2 * 1000)
  })
  // wait anyone finsh to first
  await Promise.any([checkAllTaskDonePromise, printWaitTimePromise])

  clearInterval(checkTask)
  clearInterval(printWaitTimeTask)
  clearTimeout(timeoutTask)

  await Promise.all(stopActions.map(stop => stop()))
}

export type Stage = "init" | "flusing" | "done" | "error"

export type SyncStatusMapping = { [name: string]: Stage }
export interface SessionConfig {
  cmd: "upload" | "download"
  groups: string[] | undefined
  createTime: string
  updateTime: string
  syncStatus: SyncStatusMapping
}

function formatTime(d: Date): string {
  return moment(d).format(`${moment.HTML5_FMT.DATE} ${moment.HTML5_FMT.TIME_SECONDS}`)
}
const modes: { [cmd: string]: Mode } = {
  "upload": "alpha-replica",
  "download": "beta-replica",
}
export interface SessionOpts {
  cmd: SessionCommand
  groups: string[] | undefined
  renewAll?: boolean
}

export type SessionCommand = "upload" | "download"

export function getSessionConfigFile(): string {
  return resolveShellPath(`~/.nx-sync/session.json`)
}

export async function readJSONOptional<T>(file: string): Promise<T> {
  const content = await readFile(file, { encoding: 'utf-8' }).catch(e => { })
  if (content) {
    try {
      return JSON.parse(content)
    } catch (e) { }
  }
}
export async function sessionOperation(opts: SessionOpts) {
  if (opts.cmd !== 'upload' && opts?.cmd !== 'download') {
    throw new Error(`invalid session cmd: ${opts.cmd}`)
  }
  const mode = modes[opts.cmd]
  if (!mode) {
    throw new Error(`invalid session cmd: ${opts.cmd}`)
  }
  const ok = await locked(resolveShellPath(`~/.nx-sync/session.lock`), 5 * 60 * 1000, false, async locker => {
    const sessionConfFile = getSessionConfigFile()
    let config = await readJSONOptional<SessionConfig>(sessionConfFile)
    let shouldRenew = false
    if (!config || !config.cmd) {
      shouldRenew = true
    } else if (config.cmd !== opts.cmd) {
      const keys = Object.keys(config?.syncStatus || {})
      const notDoneKeys = []
      for (const key of keys) {
        if (config.syncStatus[key] !== 'done') {
          notDoneKeys.push(key)
        }
      }
      if (notDoneKeys.length) {
        throw new Error(`previous session ${config.cmd} not complete:${notDoneKeys.join(",")}`)
      }
      console.log(`session command changed: ${config.cmd} -> ${opts.cmd}`)
      shouldRenew = true
    } else if (opts?.renewAll) {
      shouldRenew = true
    } else {
      const prev = JSON.stringify(config.groups)
      const cur = JSON.stringify(opts?.groups)
      if (prev !== cur) {
        shouldRenew = true
      }
    }
    if (shouldRenew) {
      const statusMapping: SyncStatusMapping = {}
      forEachSync(opts?.groups, conf => {
        const actualConfName = resolveActualName(conf.name, mode)
        if (checkModeDisabled(conf, mode)) {
          console.log(`${actualConfName} skipped because disabled`)
          return
        }
        statusMapping[conf.name] = "init"
      })
      // create new config
      const createTime = formatTime(new Date())
      config = {
        cmd: opts.cmd,
        createTime,
        updateTime: createTime,
        groups: opts?.groups,
        syncStatus: statusMapping,
      }
      await writeFile(sessionConfFile, JSON.stringify(config, null, "    "), { encoding: 'utf-8' })
    }

    // for all status not done, refresh them step by step
    const keys = Object.keys(config.syncStatus || {})
    if (keys?.length === 0) {
      console.log("NOTE: no groups found")
    }
    const todoKeys = []
    for (const key of keys) {
      if (config.syncStatus[key] === 'done') {
        continue
      }
      todoKeys.push(key)
    }
    if (!todoKeys.length) {
      console.log(`session ${opts.cmd} all done, add --renew if you want to restart all`)
      return
    }
    await recreateAndSync(todoKeys, {
      mode: mode,
      forceUnlock: true,
      pause: true,
      silentSyncError: true,
      async onSyncStatusUpdate(name, stage, err) {
        if (!(name in config.syncStatus)) {
          throw new Error(`unexpected config name: ${name}`)
        }
        if (err) {
          stage = "error"
        }
        config.syncStatus[name] = stage
        config.updateTime = formatTime(new Date())
        await writeFile(sessionConfFile, JSON.stringify(config, null, "    "), { encoding: 'utf-8' })
      },
    })
  })
  if (!ok) {
    console.log(`another session command is running, skip`)
  }
}

export async function sessionStatus() {
  const file = getSessionConfigFile()
  let config = await readJSONOptional<SessionConfig>(file)
  console.log(JSON.stringify(config, undefined, "    "))
}