//!node-ext: install dateformat

import { recreateAndSync, RecreateOptions, setSyncConfigs, syncCmd } from "./sync-sessions"
import { run as runCmd, parseOptions } from "@node-ext/cmd"
import { resolveShellPath } from "@node-ext/env"
import path = require("path")
import dateFormat from 'dateformat'

import syncConfigs from "./list"
import privateSyncConfigs from "./list-private"
import { mkdir, readFile } from "fs/promises"

const help = `
Usage: nx-sync flush working
       nx-sync upload working      upload fully 
       nx-sync download working    download fully
       nx-sync edit
       nx-sync terminate <names>
       nx-sync pause <names>
       nx-sync resume <names>
       nx-sync list <names>
       nx-sync show <names>

Options:
  -h, --help               help
  -f, --force              force lock
  -a, --alpha-to-beta      sync alpha to beta, alpha wins all conflicts
  -A, --alpha-replica      full sync alpha to beta, alpha will be replicated by beta
  -b, --beta-to-alpha      sync beta to alpha, beta wins all conflicts
  -B, --beta-replica       full sync beta to alpha, beta will be replicated by alpha
  -s, --safe               safe mode, no data loss
`

export interface Config {
    use?: string
}

async function init() {
    // if (true) {
    //     console.log("private:", process.env["NX_SYNC_FILE"] === "private")
    //     process.exit(0)
    // }
    const cfgJSON = await readFile(resolveShellPath("~/.nx-sync.json"), { 'encoding': 'utf-8' }).catch(() => { })

    let cfg: Config
    try {
        cfg = cfgJSON ? JSON.parse(cfgJSON as string) : null
    } catch (e) {

    }

    const isPrivate = process.env["NX_SYNC_FILE"] === "private" || cfg?.use === "private"
    setSyncConfigs(isPrivate ? privateSyncConfigs : syncConfigs)

    // create ~/.nx-sync/
    await mkdir(resolveShellPath("~/.nx-sync"), { recursive: true })
}

export interface Options {
    help?: boolean
    debug?: boolean
    force?: boolean
    "pause"?: boolean
    "beta-to-alpha"?: boolean
    "alpha-to-beta"?: boolean
    "safe"?: boolean
    "mode"?: RecreateOptions["mode"]
}

async function run() {
    await init()

    // argv: [node, sync.js, ...]
    const { args: [cmd, ...args], options } = parseOptions<Options>(help, "h,help x,debug f,force pause a,alpha-to-beta=mode  A,alpha-replica=mode b,beta-to-alpha=mode B,beta-replica=mode s,safe=mode")
    const { debug, force, pause, mode } = options
    if (!cmd) {
        throw new Error("requires cmd")
    }
    const parseCmdArgs = () => {
        if (!(args.length > 0)) {
            throw new Error("requires groups")
        }
        let groups: (string[] | undefined) = args
        if (args?.[0] === 'all') {
            groups = undefined
        }
        let s: string = mode
        if (s === "s") {
            s = "safe"
        } else if (s === "a") {
            s = "alpha-to-beta"
        } else if (s === "A") {
            s = "alpha-replica"
        } else if (s === "b") {
            s = "beta-to-alpha"
        } else if (s === "B") {
            s = "beta-replica"
        }
        const actualMode = s as Options["mode"]
        return { groups, actualMode }
    }
    if (cmd === 'flush' || cmd === "upload" || cmd === "download") {
        let { groups, actualMode } = parseCmdArgs()
        if (cmd === "upload") {
            actualMode = "alpha-replica"
        } else if (cmd === "download") {
            actualMode = "beta-replica"
        } else {
            let useCmd = ""
            if (actualMode === "alpha-replica") {
                useCmd = "upload"
            } else if (actualMode === "beta-replica") {
                useCmd = "download"
            }
            if (useCmd) {
                throw new Error(`please use \`nx-sync ${useCmd} ${args.join(" ")}\` instead for ${actualMode}`)
            }
        }
        console.log(`[${dateFormat(new Date(), "yyyy-mm-dd h:MM:ss")}] sync begin`)
        await recreateAndSync(groups, { debug, forceUnlock: force, pause, mode: actualMode })
        console.log("done")
    } else if (["terminate", "resume", "list", "pause", "show"].includes(cmd)) {
        const { groups, actualMode } = parseCmdArgs()
        await syncCmd(cmd, groups, { debug, mode: actualMode })
    } else if (cmd === 'edit') {
        // __dirname is dir to sync.ts: ~/Scripts/sync.ts
        await runCmd(`nx --code ${path.resolve(__dirname, "list.ts")}`, { debug })
    } else {
        throw new Error(`unknown cmd: ${cmd}`)
    }
}

run().catch(e => {
    console.error(e.message)
    process.exit(1)
})