import { getDB } from "@utils/db";
import { Guild } from "discord.js";
import * as getLogger from "loggy";

interface IGuildPreference {
	/**
	 * Guild ID
	 */
	guildId: string;
	/**
	 * Preference (key)
	 */
	preference: string;
	/**
	 * Value for preference, e.g. 'language'='ru'
	 */
	value: string;
}

let initDone = false;

const LOG = getLogger("GuildPreferences");
const DB = getDB();
const TABLE_NAME = "guild_prefs";

/// ======================================
/// DB FUNCTIONS
/// ======================================

async function createPreference(guild: Guild | string, preference: string, value: string) {
	if (!initDone) { await init(); }

	return DB(TABLE_NAME).insert({
		guildId: guild instanceof Guild ? guild.id : guild,
		preference, value
	});
}

export async function getPreferenceRow(guild: Guild | string, preference: string): Promise<IGuildPreference> {
	if (!initDone) { await init(); }

	return DB(TABLE_NAME).where({
		guildId: guild instanceof Guild ? guild.id : guild,
		preference
	}).first();
}

async function updatePreferenceRow(row: IGuildPreference) {
	if (!initDone) { await init(); }

	return DB(TABLE_NAME).where({
		guildId: row.guildId,
		preference: row.preference
	}).update(row);
}

/// ======================================
/// FOR GLOBAL USAGE
/// ======================================

export async function init(): Promise<boolean> {
	if (initDone) { return true; }
	try {
		if (!(await DB.schema.hasTable(TABLE_NAME))) {
			try {
				LOG("info", "Creating table");

				await DB.schema.createTable(TABLE_NAME, (tb) => {
					tb.string("guildId").notNullable();
					tb.string("preference").notNullable();
					tb.string("value").notNullable().defaultTo("{}");
				});
			} catch (err) {
				LOG("err", "Can't create table", err);

				return false;
			}
		} else {
			LOG("ok", "Table found");
		}
	} catch (err) {
		LOG("err", "Can't check table status", err);

		return false;
	}

	initDone = true;

	return true;
}

export async function removePreference(guild: Guild | string, preference: string) {
	if (!initDone) { await init(); }

	await DB(TABLE_NAME).where({
		guildId: guild instanceof Guild ? guild.id : guild,
		preference
	}).delete();
}

export async function getPreferenceValue(guild: Guild | string, preference: string, json = false) {
	if (!initDone) { await init(); }

	const prefRow = (await getPreferenceRow(guild, preference));
	const value = prefRow ? prefRow.value : undefined;

	return json && value ? JSON.parse(value) : value;
}

export async function setPreferenceValue(guild: Guild | string, preference: string, value: any) {
	if (!initDone) { await init(); }

	const prefRow = await getPreferenceRow(guild, preference);
	const valueToWrite = typeof value === "string" ? value : JSON.stringify(value);

	if (!prefRow) {
		await createPreference(guild, preference, valueToWrite);
	} else {
		prefRow.value = valueToWrite;
		await updatePreferenceRow(prefRow);
	}
}
