import { getRemoteDir } from "./config";
import { SyncConfig, SyncOptions } from "./types";

export function makeDir(srcPath: string): { srcDir: string, dstDir: string } {
    return { srcDir: srcPath, dstDir: getRemoteDir(srcPath) }
}

// let alpha wins conflicts
const defaultOptions: Partial<SyncOptions> = {
    // default mode
    mode: "two-way-resolved"
}

const remoteHome = getRemoteDir("~")

const syncConfigs: SyncConfig[] = [
    {
        name: "example",
        ...makeDir("~/Projects/gopath/src/example"),
        options: {

            ignores: ["/.git/index.lock", "/.git", "/log"],
        },
        groups: ["core", "working", "example"],
    },
    {
        name: "example-git",
        ...makeDir("~/Projects/gopath/src/example/.git"),
        options: {

        },
        groups: ["core", "working", "example"],
    },
    {
        name: "home",
        srcDir: `~/`,
        dstDir: `${remoteHome}/home_bak/`,
        options: {
            mode: "one-way-replica",
            ignores: ["*",
                ...[".bash_profile", ".bashrc", ".bash_history", ".bash_sessions", ".profile", ".bash_alias", ".vim", ".viminfo", ".vimrc", ".gitconfig", ".ssh"].map(e => `!/${e}`)
            ],
        },
        disableMode: ["beta-replica", "beta-to-alpha"],
        groups: ["core", "working", "home"],
    },
]

const working = [
    "example"
]

working.forEach(w => {
    const cfg = syncConfigs?.filter?.(e => e.name === w)?.[0]
    if (!cfg) {
        throw new Error(`working name not found: ${w}`)
    }
    if (!cfg?.groups?.includes?.("working")) {
        cfg.groups = cfg.groups || []
        cfg.groups.push("working")
    }
})

syncConfigs.forEach(e => e.options = { ...defaultOptions, ...e.options })

export default syncConfigs;
