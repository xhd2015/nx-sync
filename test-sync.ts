//!node-ext: install sqlite3

import { listSync } from "./sync-sessions"
import { Database } from "sqlite3"
import { resolveShellPath } from "@node-ext/env"
import { mkdir } from "fs/promises"
import { promisify } from "util"

export async function testList() {
    const data = await listSync()
    console.log("syncs:", data)
}

// NOTE: wepback does not work with sqlite2
export async function testDB() {
    await mkdir("~/.nx-sync", { recursive: true })
    const db = new Database(resolveShellPath("~/.nx-sync/db"))

    const get = promisify(db.get.bind(db))
    const run = promisify(db.run.bind(db))
    // const insert =promisify(db.)

    await run("CREATE TABLE user(id INTEGER PRIMARY KEY,name TEXT)")
    await run("INSERT INTO user(id,name) VALUES(?,?)", [1, "hello"])

    const row = await get("SELECT * FROM user")
    console.log("row:", row)
}

// testList()
testDB()