import { Mode, SyncOptions } from "./types"
import { remoteGroup, remoteHome, remoteHost, remoteUser } from "./vars"

const defaultOptions: Partial<SyncOptions> = {
    defaultOwnerAlpha: "xhd2015",
    defaultGroupAlpha: "staff",
    defaultOwnerBeta: remoteUser,
    defaultGroupBeta: remoteGroup,
    watchPollingIntervalAlpha: 120, // second
    watchPollingIntervalBeta: 1800, // second
}

export function getRemoteDir(srcPath: string): string {
    if (srcPath.startsWith("~/")) {
        return `${remoteUser}@${remoteHost}:${remoteHome}/${srcPath.slice("~/".length)}`
    } else if (srcPath === '~') {
        return `${remoteUser}@${remoteHost}:${remoteHome}`
    }
    throw new Error(`unrecognized ${srcPath}`)
}

export function validateMode(mode: Mode) {
    if (!mode) {
        return
    }
    if (mode !== "alpha-to-beta" && mode !== "alpha-replica" && mode !== "beta-to-alpha" && mode !== "beta-replica" && mode !== "safe") {
        throw new Error(`invalid mode: ${mode}`)
    }
}

export { defaultOptions };