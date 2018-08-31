import { getDB } from "@utils/db";
import { Guild } from "discord.js";
import * as getLogger from "loggy";

// 100% copy-typing from "dbController" of archive :^)

const ERRORS = {
	INIT_NOT_COMPLETE: new Error("You haven't initialized the DB controller and attempted to call one of its members. You must call #init function before starting to use the controller. This will ensure that database is created and controller is able to manipulate required data")
};
const DEFAULT_TALBENAME = "prefixes";

let totalInstances = 0;

export class PrefixAllDBController {
	private readonly _tableName: string;
	private readonly _db = getDB();
	private _initComplete = false;
	private readonly _log = getLogger(`PrefixAllDBController:${++totalInstances}`);

	constructor(tableName: string = DEFAULT_TALBENAME) {
		this._tableName = tableName;
	}

	public async init() {
		const tableStatus = await this._db.schema.hasTable(this._tableName);
		if (!tableStatus) {
			this._log("info", "[init] Table not found, going to create it");

			await this._db.schema.createTable(this._tableName, (tb) => {
				tb.string("guildId").notNullable();
				tb.string("prefix", 2000).nullable(); // i still can't math kthx
			});

			this._log("info", `[init] Table '${this._tableName}' created`);
		}

		this._initComplete = true;
		this._log("info", "[init] Initialization complete");
	}

	/**
	 * Gets prefixes of selected guild
	 * @param guild Selected guild. ID or the discord.js' Guild object
	 * @returns Prefixes of the selected guild or, if not found, null
	 */
	public async getPrefixes(guild: Guild | string): Promise<string[] | null> {
		if (!this._initComplete) { throw ERRORS.INIT_NOT_COMPLETE; }
		const row = await this._getGuildRow(this._normalizeGuildId(guild));
		if (!row) { return null; }

		return row.prefix ? JSON.parse(row.prefix) : undefined;
	}

	/**
	 * Tries to get prefixes of the selected guild and if fails, creates new row with passed prefixes. Otherwise, if successed, modifies the current row and pushes edit to database.
	 * @param guild Selected guild. ID or the discord.js' Guild object
	 * @param prefixes Prefixes for the selected guild.
	 */
	public async setPrefixes(guild: Guild | string, prefixes: string[] | null) : Promise<void> {
		if (!this._initComplete) { throw ERRORS.INIT_NOT_COMPLETE; }
		const isDelete = prefixes === null;
		if (!Array.isArray(prefixes) && !isDelete) { throw new Error("The `prefixes` argument must be an array of strings or `null`"); }
		const currentRow = await this._getGuildRow(this._normalizeGuildId(guild));
		if (!currentRow) {
			await this._db(this._tableName).insert(<IGuildPrefixRawRow> {
				guildId: this._normalizeGuildId(guild),
				prefix: isDelete ? null : JSON.stringify(prefixes)
			});
		} else {
			await this._db(this._tableName).where({
				guildId: currentRow.guildId
			}).update({
				prefix: isDelete ? null : JSON.stringify(prefixes)
			});
		}
	}

	private async _getGuildRow(guildId: string) {
		return <IGuildPrefixRawRow | undefined> await this._db(this._tableName).first().where({ guildId });
	}

	private _normalizeGuildId(guild: Guild | string) {
		if (typeof guild === "string" && /[0-9]{17,18}/.test(guild)) {
			return guild;
		} else if (guild instanceof Guild) {
			return guild.id;
		}
		throw new Error("Invalid `guild` argument provided");
	}
}

interface IGuildPrefixRawRow {
	guildId: string;
	prefix?: string;
}
