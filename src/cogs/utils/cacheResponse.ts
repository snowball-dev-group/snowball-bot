import { AES } from "crypto-js";
import { default as getDB, createTableBySchema } from "./db";
import * as knex from "knex";
import { getLogger } from "./utils";
import { currentTimestamp } from "./time";
import { randomString } from "./random";

const CACHE_TABLE_NAME = "cached_responses";
const CACHE_TABLE_ROW_SCHEME = {
    cache_owner: "string*",
    key: "string*",
    value: "string*",
    timestamp: "number*",
    code: "string!"
};

// it's can cost us time later
const CACHE_TABLE_ROW_KEYS = Object.keys(CACHE_TABLE_ROW_SCHEME);
const LOG = getLogger("OverwatchProfilePlugin");

let db:knex|undefined = undefined;
let initialized = false;

// you should perform initialization here!

LOG("info", "Loading...");

async function init() {
    try {
        db = getDB();
    } catch (err) {
        LOG("err", "Can't get database connection", err);
        return;
    }

    let status = false;
    try {
        status = await db.schema.hasTable(CACHE_TABLE_NAME);
    } catch (err) {
        LOG("err", "Can't check cache table status:", err);
        return;
    }

    if(!status) {
        try {
            await createTableBySchema(CACHE_TABLE_NAME, CACHE_TABLE_ROW_SCHEME);
            status = await db.schema.hasTable(CACHE_TABLE_NAME);
        } catch (err) {
            LOG("err", "Can't create table:", err);
            return;
        }
    }

    initialized = true;
}

export interface ICachedRow {
    cache_owner:String;
    key:string;
    value:string;
    timestamp:number;
    code:string;
}

export interface ICachingResponse {
    /**
     * Says if it's new recording in cache, because not throws 'putInCache' error if you not use argument called 'onlyNew'
     */
    new:boolean;
    /**
     * Cached row (or what you just did put in cache)
     */
    row:ICachedRow;
}

export async function getFromCache(cache_owner:string, key:string) : Promise<ICachedRow> {
    if(!initialized || !db) { 
        await init();
        if(!db) {
            throw new Error("Initialization not completed");
        }
    }
    return await db(CACHE_TABLE_NAME).where({
        cache_owner, key
    }).first.apply(this, CACHE_TABLE_ROW_KEYS);
}

// very unique!
function getCode() {
    return (currentTimestamp().toString(16) + randomString(5)).split("").reverse().join("");
}

// never wait!
export async function cache(cache_owner:string, key:string, value:string, onlyNew:boolean = false) : Promise<ICachingResponse> {
    if(!initialized || !db) {
        await init();
        if(!db) {
            throw new Error("Initialization not completed");
        }
    }
    let current:ICachedRow|undefined = await getFromCache(cache_owner, key);
    if(current) {
        if(onlyNew) {
            throw new Error("There's an already created cache for this key & owner");
        }
        return {
            new: false,
            row: current
        };
    }
    await db(CACHE_TABLE_NAME).insert({
        cache_owner, key, value,
        timestamp: currentTimestamp(),
        code: getCode()
    });
    current = await getFromCache(cache_owner, key);
    return {
        new: true,
        row: current
    };
}

export async function clearCache(cache_owner:string, key:string, notEmpty:boolean = false) {
    if(!initialized || !db) {
        await init();
        if(!db) {
            throw new Error("Initialization not completed");
        }
    }
    let current:ICachedRow|undefined = await getFromCache(cache_owner, key);
    if(!current) {
        if(notEmpty) {
            throw new Error("Row is already empty");
        }
        return false;
    } else {
        await db(CACHE_TABLE_NAME).where('code', current.code).delete();
        current = await getFromCache(cache_owner, key); // should be undefined
        if(!current) { 
            return true;
        } else {
            throw new Error("Can't delete element");
        }
    }
}