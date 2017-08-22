import { getDB, createTableBySchema } from "./db";
import * as knex from "knex";
import { getLogger } from "./utils";
import { currentTimestamp } from "./time";
import { randomString } from "./random";

const CACHE_TABLE_NAME = "cached_responses";
const CACHE_TABLE_ROW_SCHEME = {
    cacheOwner: "string*",
    key: "string*",
    value: "string*",
    timestamp: "number*",
    code: "string!"
};

// it's can cost us time later
// const CACHE_TABLE_ROW_KEYS = Object.keys(CACHE_TABLE_ROW_SCHEME);
const LOG = getLogger("CachingUtil");

let db: knex | undefined = undefined;
let initialized = false;

// you should perform initialization here!

LOG("info", "Loading...");

async function init() {
    try {
        db = getDB();
    } catch(err) {
        LOG("err", "Can't get database connection", err);
        return;
    }

    let status = false;
    try {
        status = await db.schema.hasTable(CACHE_TABLE_NAME);
    } catch(err) {
        LOG("err", "Can't check cache table status:", err);
        return;
    }

    if(!status) {
        try {
            await createTableBySchema(CACHE_TABLE_NAME, CACHE_TABLE_ROW_SCHEME);
            status = await db.schema.hasTable(CACHE_TABLE_NAME);
        } catch(err) {
            LOG("err", "Can't create table:", err);
            return;
        }
    }

    initialized = true;
}

export interface ICachedRow {
    cache_owner: String;
    key: string;
    value: string;
    timestamp: number;
    code: string;
}

export interface ICachingResponse {
    /**
     * Says if it's new recording in cache, because not throws 'putInCache' error if you not use argument called 'onlyNew'
     */
    new: boolean;
    /**
     * Cached row (or what you just did put in cache)
     */
    row: ICachedRow | null;
}

export async function getFromCache(cacheOwner: string, key: string): Promise<ICachedRow | undefined> {
    if(!initialized || !db) {
        await init();
        if(!db) {
            throw new Error("Initialization not completed");
        }
    }
    let logPrefix = `${cacheOwner}:${key} (getFromCache)|`;
    let elem: ICachedRow | undefined = undefined;
    try {
        elem = await db(CACHE_TABLE_NAME).where({
            cacheOwner, key
        }).first();
        LOG("ok", logPrefix, "Got element from cache");
    } catch(err) {
        LOG("err", logPrefix, "Failed to get element from cache", err);
        throw new Error("Failed to get element from cache");
    }
    return elem;
}

// very unique!
function getCode() {
    return (currentTimestamp().toString(16) + randomString(5)).split("").reverse().join("");
}

// never wait!
export async function cache(cacheOwner: string, key: string, value: string, noWait: boolean = true, onlyNew: boolean = false): Promise<ICachingResponse> {
    if(!initialized || !db) {
        await init();
        if(!db) {
            throw new Error("Initialization not completed");
        }
    }
    let current: ICachedRow | undefined = undefined;
    let logPrefix = `${cacheOwner}:${key} (cache)|`;
    try {
        current = await getFromCache(cacheOwner, key);
    } catch(err) {
        LOG("err", logPrefix, "Failed to get current version", err);
    }
    if(current) {
        if(onlyNew) {
            throw new Error("There's an already created cache for this key & owner");
        }
        LOG("ok", logPrefix, "There's already cached version.");
        return {
            new: false,
            row: current
        };
    }
    try {
        await db(CACHE_TABLE_NAME).insert({
            cacheOwner, key, value,
            timestamp: currentTimestamp(),
            code: getCode()
        });
        LOG("ok", logPrefix, "Inserting done");
    } catch(err) {
        LOG("err", logPrefix, "Caching failed", err);
        throw new Error("Failed to write in DB. Caching cancelled");
    }
    if(noWait) {
        LOG("ok", logPrefix, "No wait passed, skipping checking for current version");
        return {
            new: true,
            row: null
        };
    }
    try {
        current = await getFromCache(cacheOwner, key);
        LOG("ok", logPrefix, "Got current version from DB");
    } catch(err) {
        LOG("err", logPrefix, "Failed to check if element was inserted", err);
        throw new Error("Failed to get element from database");
    }
    if(!current) {
        throw new Error("Failed to cache element: something wrong with DB");
    }
    return {
        new: true,
        row: current
    };
}

export async function clearCache(cacheOwner: string, key: string, noWait: boolean = true, notEmpty: boolean = false): Promise<boolean> {
    if(!initialized || !db) {
        await init();
        if(!db) {
            throw new Error("Initialization not completed");
        }
    }
    let logPrefix = `${cacheOwner}:${key} (clearCache)|`;

    let current: ICachedRow | undefined = undefined;
    try {
        current = await getFromCache(cacheOwner, key);
        LOG("ok", logPrefix, "Got current element from DB");
    } catch(err) {
        LOG("err", logPrefix, "Can't get cache from DB");
    }

    if(!current) {
        if(notEmpty) {
            LOG("err", logPrefix, "notEmpty passed, but no value - throwing exception");
            throw new Error("Row is already empty");
        }
        return false;
    } else {
        await db(CACHE_TABLE_NAME).where({
            "code": current.code
        }).delete();
        if(noWait) {
            return true;
        }
        try {
            current = await getFromCache(cacheOwner, key);
            LOG("ok", logPrefix, "Got current element from DB");
        } catch(err) {
            LOG("err", logPrefix, "Failed to get current element from DB");
        }
        if(!current) {
            LOG("ok", logPrefix, "Element removed from DB");
            return true;
        } else {
            throw new Error("Can't delete element");
        }
    }
}