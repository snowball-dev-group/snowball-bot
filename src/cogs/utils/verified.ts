import { getDB } from "./db";
import { GuildMember, Message } from "discord.js";
import { getLogger } from "./utils";

interface IVerifiedRow {
	guildId: string;
	memberId: string;
	level: number;
}

let initDone = false;

const LOG = getLogger("VerifiedStatus");
const DB = getDB();
const TABLE_NAME = "verified_status";

/// ======================================
/// DB FUNCTIONS
/// ======================================

async function insertNew(member: GuildMember) {
	return await DB(TABLE_NAME).insert({
		guildId: member.guild.id,
		memberId: member.id,
		level: 0
	});
}

async function getVerificationRow(member: GuildMember): Promise<IVerifiedRow> {
	return await DB(TABLE_NAME).where({
		guildId: member.guild.id,
		memberId: member.id
	}).first();
}

async function updateRow(row: IVerifiedRow) {
	return await DB(TABLE_NAME).where({
		guildId: row.guildId,
		memberId: row.memberId
	}).update(row);
}

async function deleteRow(row: IVerifiedRow) {
	return await DB(TABLE_NAME).where(row).delete().first();
}

/// ======================================
/// EVENTS
/// ======================================

export async function guildMemberAddEvent(member: GuildMember) {
	if(member.guild.verificationLevel === 0) { return; }
	await insertNew(member);
}

export async function guildMemberRemoveEvent(member: GuildMember) {
	let dbRow = await getVerificationRow(member);
	if(dbRow) { await deleteRow(dbRow); }
}

export async function messageEvent(msg: Message) {
	if(msg.channel.type !== "text") {
		// direct messages, nope
		return;
	}
	if(!msg.member) {
		return;
	}
	if(msg.guild.verificationLevel === 0) {
		// skipping guilds with no verification level
		return;
	}
	try {
		let row = await getVerificationRow(msg.member);
		if(!row) {
			await insertNew(msg.member);
			row = await getVerificationRow(msg.member);
			if(!row) {
				LOG("err", "Bad times, row not found after creation");
				return;
			}
		}
		if(row.level >= msg.guild.verificationLevel) {
			// this means that user is verified at guild verification level
			return;
		}
		row.level = msg.guild.verificationLevel;
		await updateRow(row);
	} catch(err) {
		LOG("err", "Verification failed", err);
	}
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

	initDone = true;
	return true;
}

/**
 * Returns an value that indicates member corresponds to server verification level
 * @param member {GuildMember} Member of guild
 */
export async function isVerified(member: GuildMember) {
	if(member.guild.verificationLevel === 0) {
		// of course member is verified
		return true;
	}
	let dbElem = await getVerificationRow(member);
	if(!dbElem) { return false; }
	return dbElem.level >= member.guild.verificationLevel;
}