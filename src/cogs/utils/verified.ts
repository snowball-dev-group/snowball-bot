import { getDB } from "./db";
import { GuildMember, Message } from "discord.js";
import { getLogger } from "./utils";
import { INullableHashMap } from "../../types/Types";

interface IVerificationData {
	guildId: string;
	memberId: string;
	level: number;
}

let _isInitializated = false;

const LOG = getLogger("VerifiedStatus");
const DB = getDB();
const TABLE_NAME = "verified_status";

let localStorage: INullableHashMap<number> = Object.create(null);

/// ======================================
/// DB FUNCTIONS
/// ======================================

function getLocalStorageKey(member: GuildMember) {
	return `${member.guild.id}:${member.id}`; // pretty simple, huh?
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

async function getStoredVerification(member: GuildMember): Promise<IVerificationData|undefined> {
	const localStorageKey = getLocalStorageKey(member);
	const localStored = localStorage[localStorageKey];
	if(typeof localStored === "number") {
		return {
			guildId: member.guild.id,
			memberId: member.id,
			level: localStored
		};
	}

	const res = <IVerificationData|undefined> await DB(TABLE_NAME).where({
		guildId: member.guild.id,
		memberId: member.id
	}).first();

	if(res != null) { localStorage[localStorageKey] = res.level; }

	return res;
}

async function updateStoredVerification(verificationData: IVerificationData) {
	const res = DB(TABLE_NAME).where({
		guildId: verificationData.guildId,
		memberId: verificationData.memberId
	}).update(verificationData);
	
	localStorage[verificationData.memberId] = verificationData.level;

	return res;
}

async function deleteStoredVerification(verificationData: IVerificationData) {
	localStorage[verificationData.memberId] = undefined; // nullying, improves perfo

	return DB(TABLE_NAME).where(verificationData).delete().first();
}

/// ======================================
/// EVENTS
/// ======================================

export async function guildMemberAddEvent(member: GuildMember) {
	if(member.guild.verificationLevel === 0) { return; }
	await storeNewVerification(member);
}

export async function guildMemberRemoveEvent(member: GuildMember) {
	const dbRow = await getStoredVerification(member);
	if(dbRow) { await deleteStoredVerification(dbRow); }
}

export async function messageEvent(msg: Message) {
	if(msg.channel.type !== "text" || !msg.member || msg.guild.verificationLevel === 0 || msg.member.roles.size > 0) {
		return; // all the cases in one if
	}

	try {
		let storedVerification = await getStoredVerification(msg.member);
		if(!storedVerification) {
			await storeNewVerification(msg.member);
			storedVerification = await getStoredVerification(msg.member);
			if(!storedVerification) {
				LOG("err", "Bad times, row not found after creation");
				return;
			}
		}

		if(storedVerification.level >= msg.guild.verificationLevel) {
			// this means that user is verified at guild verification level
			return;
		}

		storedVerification.level = msg.guild.verificationLevel;
		await updateStoredVerification(storedVerification);
	} catch(err) {
		LOG("err", "Verification failed", err);
	}
}

/// ======================================
/// FOR GLOBAL USAGE
/// ======================================

export async function init(): Promise<boolean> {
	if(_isInitializated) { return true; }
	try {
		if(!(await DB.schema.hasTable(TABLE_NAME))) {
			try {
				LOG("info", "Creating table");
				await DB.schema.createTable(TABLE_NAME, (tb) => {
					tb.string("guildId").notNullable();
					tb.string("memberId").notNullable();
					tb.boolean("verified").notNullable().defaultTo(false);
					tb.integer("level").notNullable().defaultTo(0);
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
	if(!_isInitializated) {
		throw new Error("Initialization wasn't complete. You should enable `verifiedHandler` in order to use this util");
	}

	if(member.roles.size > 0) { return true; } // members with roles bypass verification anyway
	if(member.guild.verificationLevel === 0) { return true; }

	const storedVerification = await getStoredVerification(member);

	if(!storedVerification) { return false; }

	return storedVerification.level >= member.guild.verificationLevel;
}
