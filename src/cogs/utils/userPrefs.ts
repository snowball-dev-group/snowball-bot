import { getDB } from "./db";
import { GuildMember, User } from "discord.js";
import { getLogger } from "./utils";

interface IUserPreference {
	/**
	 * User ID
	 */
	uid: string;
	/**
	 * Guild ID
	 */
	gid: string | "global";
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

const LOG = getLogger("UsersPreferences");
const DB = getDB();
const TABLE_NAME = "users_prefs";

type userIndx = GuildMember | User;

/// ======================================
/// DB FUNCTIONS
/// ======================================

async function createPreference(member: userIndx, preference: string, value: string) {
	if(!initDone) { await init(); }
	return await DB(TABLE_NAME).insert({
		gid: member instanceof GuildMember ? member.guild.id : "global",
		uid: member.id,
		preference, value
	});
}

export async function getPreferenceRow(member: userIndx, preference: string): Promise<IUserPreference> {
	if(!initDone) { await init(); }
	return await DB(TABLE_NAME).where({
		gid: member instanceof GuildMember ? member.guild.id : "global",
		uid: member.id,
		preference
	}).first();
}

async function updatePreferenceRow(row: IUserPreference) {
	if(!initDone) { await init(); }
	return await DB(TABLE_NAME).where({
		gid: row.gid,
		uid: row.uid,
		preference: row.preference
	}).update(row);
}

/// ======================================
/// FOR GLOBAL USAGE
/// ======================================

export async function init(): Promise<boolean> {
	if(initDone) { return true; }
	try {
		if(!(await DB.schema.hasTable(TABLE_NAME))) {
			try {
				LOG("info", "Creating table");
				await DB.schema.createTable(TABLE_NAME, (tb) => {
					tb.string("gid").notNullable().defaultTo("global");
					tb.string("uid").notNullable();
					tb.string("preference").notNullable();
					tb.string("value").notNullable().defaultTo("{}");
				});
			} catch(err) {
				LOG("err", "Can't create table", err);
				return false;
			}
		} else {
			LOG("ok", "Table found");
		}
	} catch(err) {
		LOG("err", "Can't check table status", err);
		return false;
	}

	initDone = true;
	return true;
}

export async function removePreference(u: userIndx, preference: string) {
	if(!initDone) { await init(); }
	await DB(TABLE_NAME).where({
		gid: u instanceof GuildMember ? u.guild.id : "global",
		uid: u.id,
		preference
	}).delete();
}

export async function getPreferenceValue(u: userIndx, preference: string, json = false) {
	if(!initDone) { await init(); }
	const r = (await getPreferenceRow(u, preference));
	const v = r ? r.value : undefined;
	return json && v ? JSON.parse(v) : v;
}

export async function setPreferenceValue(u: userIndx, preference: string, value: any) {
	if(!initDone) { await init(); }
	const cr = await getPreferenceRow(u, preference);
	const twv = typeof value === "string" ? value : JSON.stringify(value);
	if(!cr) {
		await createPreference(u, preference, twv);
	} else {
		cr.value = twv;
		await updatePreferenceRow(cr);
	}
}