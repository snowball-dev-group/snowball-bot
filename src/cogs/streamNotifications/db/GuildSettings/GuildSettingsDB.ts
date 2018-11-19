import * as db from "@utils/db";
import BaseDBManager from "../BaseDBManager";
import { addGuildSettingsColumns, GuildSettingsData } from "./GuildSettingsData";

const INIT_MAP = new WeakMap<GuildSettingsDB, boolean>();

export class GuildSettingsDB {
	private readonly _tableName: string;
	private readonly _db = db.getDB();

	constructor(tableName: string) {
		if (!tableName) {
			throw new Error("No table name specified");
		}

		this._tableName = tableName;
	}

	/**
	 * Initializes and checks the database
	 */
	public async init() {
		await BaseDBManager.createTableIfNotExists(
			this._tableName,
			(tb) => {
				addGuildSettingsColumns(tb);
			}
		);

		INIT_MAP.set(this, true);
	}

	public async createSettings(data: GuildSettingsData) {
		GuildSettingsDB._checkInitDone(this);

		return this._db(this._tableName)
			.insert(data);
	}

	public async getSettings(guildId: string) : OptionalSettings {
		GuildSettingsDB._checkInitDone(this);

		return this._db(this._tableName)
			.where({ guildId })
			.first();
	}

	public async updateSettings(data: GuildSettingsData) {
		GuildSettingsDB._checkInitDone(this);

		return this._db(this._tableName)
			.where(
				GuildSettingsDB._getSelect(
					data
				)
			)
			.update(data);
	}

	public async deleteSettings(data: GuildSettingsData) {
		GuildSettingsDB._checkInitDone(this);

		return this._db(this._tableName)
			.where(
				GuildSettingsDB._getSelect(
					data
				)
			)
			.delete();
	}

	private static _getSelect(data: GuildSettingsData) {
		const { guildId } = data;

		return { guildId };
	}

	private static _checkInitDone(instance: GuildSettingsDB) {
		if (!INIT_MAP.has(instance)) {
			throw new Error("DB controller must be initlized first");
		}

		return true;
	}
}

type OptionalSettings = Promise<GuildSettingsData | undefined>;
