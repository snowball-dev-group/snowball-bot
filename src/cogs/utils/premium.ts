import { getDB, createTableBySchema } from "./db";
import { User, GuildMember } from "discord.js";
import { getLogger } from "./utils";

const PREMIUM_TABLE = "premiums";
const LOG = getLogger("Premium");
const INTERNALCALLSIGN = (Math.floor(Math.random() * 50000000000)).toString(16) + (Math.floor(Math.random() * 50000000000)).toString(16) + (Math.floor(Math.random() * 50000000000)).toString(16) + (Math.floor(Math.random() * 50000000000)).toString(16);

let db = getDB(),
    complete = false,
    retry = true;

let cache = new Map<string, IPremiumRow | "nope">();

export interface IPremiumRow {
    id: string;
    subscribed_at: Date;
    due_to: Date;
}

interface IPremiumRawRow {
    id: string; subscribed_at: number; due_to: number;
}

export async function getAllSubs() {
    return ((await db(PREMIUM_TABLE).select()) as IPremiumRawRow[]).map(e => {
        return {
            due_to: new Date(e.due_to),
            subscribed_at: new Date(e.subscribed_at),
            id: e.id
        };
    });
}

export async function init(): Promise<boolean> {
    if(complete) { return true; }
    if(!retry) { return false; }

    let status = await db.schema.hasTable(PREMIUM_TABLE);
    if(!status) {
        LOG("info", "Table isn't created");
        try {
            LOG("info", "Creating table for premiums");
            await createTableBySchema(PREMIUM_TABLE, {
                "id": "string",
                "subscribed_at": "number",
                "due_to": "number"
            });
        } catch(err) {
            LOG("err", "Table creation failed", err);
            retry = false;
            return false;
        }
    }
    status = await db.schema.hasTable(PREMIUM_TABLE);
    if(!status) {
        LOG("err", "Table creation seems to be failed");
        return false;
    }
    LOG("ok", "Table found");
    complete = true;
    return status;
}

export async function isPremium(person: GuildMember | User): Promise<boolean> {
    return !!(await checkPremium(person));
}

export async function deletePremium(person: GuildMember | User): Promise<boolean> {
    if(!(await init())) { throw new Error("Initialization failed"); }

    LOG("info", "Premium deleting action registered", {
        person_id: person.id
    });

    let logPrefix = `deletePremium(${person.id})`;

    LOG("info", logPrefix, "Checking current premium");

    let currentPremium = await checkPremium(person, INTERNALCALLSIGN);

    if(!currentPremium) {
        let str = "Nothing to delete";
        LOG("info", logPrefix, str);
        let err = new Error(str);
        err.name = "PREMIUM_ALRDYNTSUB";
        throw err;
    }

    try {
        await db(PREMIUM_TABLE).where(toRaw(currentPremium)).delete();
        cache.set(person.id, "nope");
    } catch(err) {
        LOG("err", logPrefix, "DB calling failed", err);
        throw err;
    }

    return true;
}

export async function checkPremium(person: GuildMember | User, internalCallSign?: string): Promise<IPremiumRow | undefined> {
    if(!(await init())) { throw new Error("Initialization failed"); }

    let cached = cache.get(person.id);
    let premiumRow: IPremiumRawRow | undefined = undefined;
    if(cached !== "nope" && cached !== undefined) {
        premiumRow = toRaw(cached);
    } else {
        premiumRow = await db(PREMIUM_TABLE).where({
            "id": person.id
        }).first() as IPremiumRawRow;
    }

    if(!premiumRow) { return; }
    else if(premiumRow) {
        if(internalCallSign && internalCallSign !== INTERNALCALLSIGN) {
            LOG("err", "Security issue", `#checkPremium(${person.id})`, ":: trying call with sign", internalCallSign);
            throw new EvalError("You cannot call this function with `internalCallSign`");
        } else if(!internalCallSign) {
            if(premiumRow.due_to < Date.now()) {
                await deletePremium(person);
                return;
            }
        }
    }

    let standard = toStandard(premiumRow);

    cache.set(person.id, standard);

    return standard;
}

function toStandard(row: IPremiumRawRow): IPremiumRow {
    return {
        due_to: new Date(row.due_to),
        subscribed_at: new Date(row.subscribed_at),
        id: row.id
    };
}

function toRaw(row: IPremiumRow): IPremiumRawRow {
    return {
        id: row.id,
        due_to: row.due_to.getTime(),
        subscribed_at: row.subscribed_at.getTime()
    };
}

export async function givePremium(person: GuildMember | User, dueTo: Date, override = false): Promise<boolean> {
    if(!(await init())) { throw new Error("Initialization failed"); }

    LOG("info", "Premium giving action registered", {
        person_id: person.id, dueTo, override
    });

    let currentPremium = await checkPremium(person);

    let logPrefix = `#givePremium(${person.id}): `;

    if(currentPremium && override) {
        LOG("info", logPrefix, "Premium exists, override present, row deleting...");
        try {
            await db(PREMIUM_TABLE).where(toRaw(currentPremium)).delete();
        } catch(err) {
            LOG("err", logPrefix, "Row deletion failure");
            throw err;
        }
    } else if(currentPremium) {
        LOG("info", logPrefix, "Premium exists, override doesn't present");
        let diff = dueTo.getTime() - currentPremium.due_to.getTime();
        LOG("info", logPrefix, "Calculation of difference done");
        if(diff < 0) {
            LOG("err", logPrefix, "Seems override isn't present, but dueTo date is lower than current, error found");
            let err = new Error("Can't renew premium, use override");
            err.name = "ERR_PREMIUM_DIFFLOW";
            throw err;
        }
        let nDate = currentPremium.due_to.getTime() + diff;
        LOG("info", logPrefix, "Adding new premium subscription");
        try {
            let raw: IPremiumRawRow = {
                id: person.id,
                subscribed_at: Date.now(),
                due_to: nDate
            };
            await db(PREMIUM_TABLE).where(toRaw(currentPremium)).update(raw);
            cache.set(person.id, toStandard(raw));
        } catch(err) {
            LOG("err", logPrefix, "Updating failed", err);
            throw err;
        }
        return true;
    }

    try {
        let raw: IPremiumRawRow = {
            id: person.id,
            subscribed_at: Date.now(),
            due_to: dueTo.getTime()
        };
        await db(PREMIUM_TABLE).insert(raw);
        cache.set(person.id, toStandard(raw));
    } catch(err) {
        LOG("err", logPrefix, "Inserting failed", err);
        throw err;
    }

    return true;
}