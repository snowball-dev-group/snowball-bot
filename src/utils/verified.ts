import { getDB } from "@utils/db";
import { GuildMember, Message } from "discord.js";
import * as getLogger from "loggy";
import { INullableHashMap } from "@sb-types/Types";
import { getMessageMember } from "@utils/utils";

interface IVerificationData {
	guildId: string;
	memberId: string;
	level: number;
}

let _isInitializated = false;

const LOG = getLogger("Utils:VerifiedStatus");
const DB = getDB();
const TABLE_NAME = "verified_status";

let localStorage: INullableHashMap<number> = Object.create(null);

/// ======================================
/// DB FUNCTIONS
/// ======================================

function getLocalStorageKey(member: GuildMember) {
	return getLocalStorageKeyBy(member.guild.id, member.id); // pretty simple, huh?
}

function getLocalStorageKeyBy(guildId: string, memberId: string) {
	return `${guildId}:${memberId}`;
}

export async function flushLocalStorage() {
	localStorage = Object.create(null); // don't change anything, perfo reasons

	return true;
}

async function storeNewVerification(member: GuildMember) {
	const res = DB(TABLE_NAME).insert({
		guildId: member.guild.id,
		memberId: member.id,
		level: 0
	});

	localStorage[getLocalStorageKey(member)] = 0;

	return res;
}

async function getStoredVerification(member: GuildMember): Promise<IVerificationData | undefined> {
	const localStorageKey = getLocalStorageKey(member);
	const localStored = localStorage[localStorageKey];
	if (typeof localStored === "number") {
		return {
			guildId: member.guild.id,
			memberId: member.id,
			level: localStored
		};
	}

	const res = <IVerificationData | undefined> await DB(TABLE_NAME).where({
		guildId: member.guild.id,
		memberId: member.id
	}).first();

	if (res != null) { localStorage[localStorageKey] = res.level; }

	return res;
}

async function updateStoredVerification(verificationData: IVerificationData) {
	const res = DB(TABLE_NAME).where({
		guildId: verificationData.guildId,
		memberId: verificationData.memberId
	}).update(verificationData);

	const localStorageKey = getLocalStorageKeyBy(verificationData.guildId, verificationData.memberId);

	localStorage[localStorageKey] = verificationData.level;

	return res;
}

async function deleteStoredVerification(verificationData: IVerificationData) {
	const localStorageKey = getLocalStorageKeyBy(verificationData.guildId, verificationData.memberId);

	localStorage[localStorageKey] = undefined; // nullying, improves perfo

	return DB(TABLE_NAME).where(verificationData).first().delete();
}

/// ======================================
/// EVENTS
/// ======================================

export async function guildMemberAddEvent(member: GuildMember) {
	if (member.guild.verificationLevel === 0) { return; }
	await storeNewVerification(member);
}

export async function guildMemberRemoveEvent(member: GuildMember) {
	const dbRow = await getStoredVerification(member);
	if (dbRow) { await deleteStoredVerification(dbRow); }
}

export async function messageEvent(msg: Message) {
	if (msg.channel.type !== "text" || msg.guild.verificationLevel === 0) { return; }

	const member = await getMessageMember(msg);

	if (!member) { return; }

	if (member.roles.size > 0) { return; }

	try {
		let storedVerification = await getStoredVerification(member);
		if (!storedVerification) {
			await storeNewVerification(member);
			storedVerification = await getStoredVerification(member);
			if (!storedVerification) {
				LOG("err", "Bad times, row not found after creation");

				return;
			}
		}

		if (storedVerification.level >= msg.guild.verificationLevel) {
			// this means that user is verified at guild verification level

			return;
		}

		storedVerification.level = msg.guild.verificationLevel;
		await updateStoredVerification(storedVerification);
	} catch (err) {
		LOG("err", "Verification failed", err);
	}
}

/// ======================================
/// FOR GLOBAL USAGE
/// ======================================

export async function init(): Promise<boolean> {
	if (_isInitializated) { return true; }
	try {
		if (!(await DB.schema.hasTable(TABLE_NAME))) {
			try {
				LOG("info", "Creating table");
				await DB.schema.createTable(TABLE_NAME, (tb) => {
					tb.string("guildId").notNullable();
					tb.string("memberId").notNullable();
					tb.boolean("verified").notNullable().defaultTo(false);
					tb.integer("level").notNullable().defaultTo(0);
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

	return _isInitializated = true;
}

/**
 * Returns a value that indicates if verified was init'ed
 */
export const isInitializated = () => _isInitializated;

/**
 * Returns a value that indicates member corresponds to server verification level
 * @param member Member of guild
 */
export async function isVerified(member: GuildMember) {
	if (!_isInitializated) {
		throw new Error("Initialization wasn't complete. You should enable `verifiedHandler` in order to use this util");
	}

	if (member.guild.verificationLevel === 0) { return true; }
	if (member.roles.filter(r => r.id !== member.guild.id).size > 0) { return true; } // members with roles (except '@everyone') bypass verification anyway

	const storedVerification = await getStoredVerification(member);

	if (!storedVerification) { return false; }

	return storedVerification.level >= member.guild.verificationLevel;
}
