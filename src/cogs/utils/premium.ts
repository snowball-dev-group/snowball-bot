import { getDB, createTableBySchema } from "./db";
import { User, GuildMember } from "discord.js";
import { getLogger } from "./utils";
import { INullableHashMap } from "../../types/Types";

const PREMIUM_TABLE = "premiums";
const LOG = getLogger("Utils:Premium");
const INTERNALCALLSIGN = (Math.floor(Math.random() * 50000000000)).toString(16) + (Math.floor(Math.random() * 50000000000)).toString(16) + (Math.floor(Math.random() * 50000000000)).toString(16) + (Math.floor(Math.random() * 50000000000)).toString(16);

const db = getDB();
let complete = false;
let retry = true;

const cache: INullableHashMap<IPremiumRow> = Object.create(null);

export interface IPremiumRow {
	id: string;
	subscribed_at: Date;
	due_to: Date;
}

interface IPremiumRawRow {
	id: string;
	subscribed_at: number;
	due_to: number;
}

export async function getAllPremiumSubscribers() {
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
			const BIG_INT = {
				type: "BIGINT",
				length: 20
			};
			await createTableBySchema(PREMIUM_TABLE, {
				"id": "string",
				"subscribed_at": BIG_INT,
				"due_to": BIG_INT
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

	const logPrefix = `deletePremium(${person.id}):`;

	LOG("info", logPrefix, "Checking current premium");

	const currentPremium = (await checkPremium(person, INTERNALCALLSIGN));

	if(!currentPremium) {
		const str = "Nothing to delete";
		LOG("info", logPrefix, str);
		const err = new Error(str);
		err.name = "PREMIUM_ALRDYNTSUB";
		throw err;
	}

	try {
		await db(PREMIUM_TABLE).where(toRaw(currentPremium)).delete();
		cache[person.id] = null;
	} catch(err) {
		LOG("err", logPrefix, "DB calling failed", err);
		throw err;
	}

	return true;
}

export async function getPremium(person: GuildMember | User, internalCallSign?: string): Promise<{ result: IPremiumRow | undefined, source: "db" | "cache" }> {
	if(!(await init())) { throw new Error("Initialization failed"); }

	const cached = cache[person.id];
	let premiumRow: IPremiumRawRow | undefined = undefined;
	let source: "db" | "cache" = "cache";

	if(cached != null) {
		// was cached
		premiumRow = toRaw(cached);
	} else if(cached === undefined) {
		source = "db";
		// wasn't cached, so fetching from db
		premiumRow = await db(PREMIUM_TABLE).where({
			"id": person.id
		}).first() as IPremiumRawRow;

		if(!premiumRow) {
			// at this moment if premium wasn't returned
			// we can assume, that user doesn't has premium
			// so we caching this for next uses
			cache[person.id] = null;

			return {
				result: undefined,
				source
			};
		}
	}

	if(!premiumRow) {
		return {
			result: undefined,
			source
		};
	}

	if(internalCallSign && internalCallSign !== INTERNALCALLSIGN) {
		LOG("err", "Security issue", `#checkPremium(${person.id})`, ":: trying call with sign", internalCallSign);
		throw new EvalError("You cannot call this function with `internalCallSign`");
	} else if(!internalCallSign) {
		if(premiumRow.due_to < Date.now()) {
			await deletePremium(person);
			return {
				result: undefined,
				source
			};
		}
	}

	return {
		result: cache[person.id] = toStandard(premiumRow),
		source
	};
}

export async function checkPremium(person: GuildMember | User, internalCallSign?: string): Promise<IPremiumRow | undefined> {
	return (await getPremium(person, internalCallSign)).result;
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

	const currentPremium = await checkPremium(person);

	const logPrefix = `#givePremium(${person.id}):`;

	if(currentPremium && override) {
		LOG("info", logPrefix, "Premium exists, override present, deleting the row...");
		try {
			await db(PREMIUM_TABLE).where(toRaw(currentPremium)).delete();
		} catch(err) {
			LOG("err", logPrefix, "Row deletion failure", err);
			throw err;
		}
	} else if(currentPremium) {
		LOG("info", logPrefix, "Premium exists, override doesn't present, is override possible?");
		const diff = dueTo.getTime() - currentPremium.due_to.getTime();
		if(diff < 0) {
			LOG("err", logPrefix, "Override is not possible, active premium is longer than new one");
			const err = new Error("Can't renew premium, use override");
			err.name = "ERR_PREMIUM_DIFFLOW";
			throw err;
		}
		const newDueTo = currentPremium.due_to.getTime() + diff;
		LOG("info", logPrefix, "Override is possible, working on it");
		try {
			const raw: IPremiumRawRow = {
				id: person.id,
				subscribed_at: Date.now(),
				due_to: newDueTo
			};
			await db(PREMIUM_TABLE).where(toRaw(currentPremium)).update(raw);
			cache[person.id] = toStandard(raw);
		} catch(err) {
			LOG("err", logPrefix, "Updating failed", err);
			throw err;
		}
		return true;
	}

	try {
		const raw: IPremiumRawRow = {
			id: person.id,
			subscribed_at: Date.now(),
			due_to: dueTo.getTime()
		};
		await db(PREMIUM_TABLE).insert(raw);
		cache[person.id] = toStandard(raw);
	} catch(err) {
		LOG("err", logPrefix, "Inserting failed", err);
		throw err;
	}

	return true;
}
