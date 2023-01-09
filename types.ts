

export type Mode = "alpha-to-beta" | "alpha-replica" | "beta-to-alpha" | "beta-replica" | "safe"
export type MutagenMode = "two-way-safe" | "two-way-resolved" | "one-way-safe" | "one-way-replica"

export interface SyncConfig {
    name: string
    srcDir: string
    dstDir: string
    options?: SyncOptions
    groups?: string[]
    disableMode?: Mode[]
}

// safe: no data loss but data may be not synced
// resolved: no conflicts, alpha wins conflicts
// "one-way-safe" -> alpha to beta, but beta's new content does not gets deleted
// one-way-replica -> alpha to beta exactly
export interface SyncOptions {
    mode?: MutagenMode
    defaultOwnerAlpha?: string
    defaultGroupAlpha?: string
    defaultOwnerBeta?: string
    defaultGroupBeta?: string

    ignores?: string[]

    watchPollingIntervalAlpha?: number // second
    watchPollingIntervalBeta?: number
}

export function validateMode(mode: Mode) {
    if (!mode) {
        return
    }
    if (mode !== "alpha-to-beta" && mode !== "alpha-replica" && mode !== "beta-to-alpha" && mode !== "beta-replica" && mode !== "safe") {
        throw new Error(`invalid mode: ${mode}`)
    }
}