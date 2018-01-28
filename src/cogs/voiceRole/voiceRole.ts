import { generateLocalizedEmbed, localizeForGuild, localizeForUser } from "../utils/ez-i18n";
import { IModule } from "../../types/ModuleLoader";
import { Plugin } from "../plugin";
import { Message, Guild, Role, GuildMember, VoiceChannel } from "discord.js";
import { getDB } from "../utils/db";
import { getLogger, EmbedType, resolveGuildRole, resolveGuildChannel } from "../utils/utils";
import { isVerified, isInitializated as isVerifiedEnabled } from "../utils/verified";
import * as knex from "knex";
import { replaceAll } from "../utils/text";
import { messageToExtra } from "../utils/failToDetail";
import { command } from "../utils/help";
import { createConfirmationMessage } from "../utils/interactive";

const TABLE_NAME = "voice_role";
const SPECIFIC_TABLE_NAME = "specificvoicerole";
const PREFIX = "!voiceRole";
const MANAGE_PERMS = (member: GuildMember) => (member.permissions.has(["MANAGE_GUILD", "MANAGE_CHANNELS", "MANAGE_ROLES"]) || member.permissions.has("ADMINISTRATOR"));

const HELP_CHECKS = {
	default: (msg: Message) => msg.channel.type === "text" && MANAGE_PERMS(msg.member)
};
const HELP_CATEGORY = "VOICEROLE";

interface IGuildRow {
	/**
	 * Discord snowflake, guild ID
	 */
	guild_id: string;

	/**
	 * Discord snowflake, role ID
	 * or `-` if role not set
	 */
	voice_role: string | "-";
}

interface ISpecificRoleRow {
	guild_id: string;
	channel_id: string;
	voice_role: string;
}

@command(HELP_CATEGORY, `${PREFIX.slice(1)} set`, `loc:VOICEROLE_META_SET`, {
	[`loc:VOICEROLE_META_SET_ARG0`]: {
		description: `loc:VOICEROLE_META_SET_ARG0_DESC`,
		optional: false
	}
}, HELP_CHECKS.default)
@command(HELP_CATEGORY, `${PREFIX.slice(1)} delete`, `loc:VOICEROLE_META_DELETE`, undefined, HELP_CHECKS.default)
@command(HELP_CATEGORY, `${PREFIX.slice(1)} specific set`, `loc:VOICEROLE_META_SPECIFICSET`, {
	[`loc:VOICEROLE_META_SPECIFICSET_ARG0`]: {
		description: `loc:VOICEROLE_META_SPECIFICSET_ARG0_DESC`,
		optional: false
	},
	[`loc:VOICEROLE_META_SET_ARG0`]: {
		description: `loc:VOICEROLE_META_SET_ARG0_DESC`,
		optional: false
	}
}, HELP_CHECKS.default)
@command(HELP_CATEGORY, `${PREFIX.slice(1)} speficic delete`, `loc:VOICEROLE_META_SPECIFICDELETE`, {
	[`loc:VOICEROLE_META_SPECIFICDELETE_ARG0`]: {
		description: `loc:VOICEROLE_META_SPECIFICDELETE_ARG0_DESC`,
		optional: false
	}
}, HELP_CHECKS.default)
class VoiceRole extends Plugin implements IModule {
	public get signature() {
		return "snowball.features.voicerole";
	}

	db: knex;
	log = getLogger("VoiceRole");
	loaded = false;

	constructor() {
		super({
			"message": (msg: Message) => this.onMessage(msg),
			"voiceStateUpdate": (oldMember: GuildMember, newMember: GuildMember) => this.vcUpdated(oldMember, newMember)
		}, true);
		this.log("info", "Loading 'VoiceRole' plugin");
		// this.initialize();
	}

	async init() {
		this.log("info", "Asking for DB...");
		// stage one: DB initialization
		try {
			this.db = getDB();
		} catch(err) {
			$snowball.captureException(err);
			this.log("err", "Asking for DB failed:", err);
			return;
		}
		this.log("ok", "Asking for DB has done");

		// stage two: checking table
		this.log("info", "Checking table");
		let dbStatus: boolean = false;
		try {
			dbStatus = await this.db.schema.hasTable(TABLE_NAME);
		} catch(err) {
			$snowball.captureException(err);
			this.log("err", "Error checking if table is created");
			return;
		}

		// stage three: create table if not exists
		if(!dbStatus) {
			this.log("warn", "Table in DB is not created. Going to create it right now");
			const creationStatus = await this.createTable();
			if(!creationStatus) {
				this.log("err", "Table creation failed.");
				return;
			}
		}

		// stage four: checking specific table
		this.log("info", "Checking specific table");
		let specificDBStatus = false;
		try {
			specificDBStatus = await this.db.schema.hasTable(SPECIFIC_TABLE_NAME);
		} catch(err) {
			$snowball.captureException(err);
			this.log("err", "Error checking if specific table is created");
			return;
		}

		// stage five: creating specific table if not exists
		if(!specificDBStatus) {
			this.log("warn", "Specific table not created in DB. Going to create it right meow");
			const creationStatus = await this.createSpecificTable();
			if(!creationStatus) {
				this.log("err", "Specific table creation failed.");
				return;
			}
		}

		// stage six: report successfull status
		this.loaded = true;

		// stage seven: handling events
		this.handleEvents();

		// stage eight: do cleanup for all guilds
		for(const guild of $discordBot.guilds.values()) {
			if(!guild.available) {
				this.log("warn", `Cleanup ignored at Guild: "${guild.name}" because it isnt' available at the moment`);
				return;
			}
			this.log("info", `Cleanup started at Guild: "${guild.name}"`);
			await this.VCR_Cleanup(guild);
		}

		// done
		this.log("ok", "'VoiceRole' plugin loaded and ready to work");
	}

	async createTable() {
		try {
			await this.db.schema.createTable(TABLE_NAME, (tb) => {
				tb.string("guild_id").notNullable();
				tb.string("voice_role").defaultTo("-");
			});
			this.log("ok", "Created table for 'voice roles'");
			return true;
		} catch(err) {
			$snowball.captureException(err);
			this.log("err", "Failed to create table. An error occured:", err);
			return false;
		}
	}

	async createSpecificTable() {
		try {
			await this.db.schema.createTable(SPECIFIC_TABLE_NAME, (tb) => {
				tb.string("guild_id").notNullable();
				tb.string("channel_id").notNullable();
				tb.string("voice_role").notNullable();
			});
			this.log("ok", "Created table for specific 'voice roles'");
			return true;
		} catch(err) {
			$snowball.captureException(err);
			this.log("err", "Failed to create table for specific 'voice roles'");
			return false;
		}
	}

	async onMessage(msg: Message) {
		if(msg.channel.type !== "text") { return; }
		if(!msg.content) { return; }
		if(msg.content.startsWith(PREFIX)) {
			await this.voiceRoleSetting(msg);
		}
	}

	async vcUpdated(oldMember: GuildMember, newMember: GuildMember) {
		if(isVerifiedEnabled() && !(await isVerified(newMember))) {
			// not going to do anything if user isn't verified
			return;
		}
		if(oldMember.voiceChannel && newMember.voiceChannel) {
			if(oldMember.voiceChannel.guild.id !== newMember.voiceChannel.guild.id) {
				// moved from one server to another (╯°□°）╯︵ ┻━┻
				// better not to wait this
				this.VCR_Remove(oldMember);
				this.VCR_Give(newMember);
			} else {
				// just moved from channel to channel on same server
				this.VCR_Remove(oldMember, newMember);
				this.VCR_Give(newMember);
			}
		} else if(oldMember.voiceChannel && !newMember.voiceChannel) {
			this.VCR_Remove(oldMember);
		} else if(!oldMember.voiceChannel && newMember.voiceChannel) {
			this.VCR_Give(newMember);
		}
	}

	async searchGuildRow(guild: Guild): Promise<IGuildRow | null> {
		return this.db(TABLE_NAME).where({
			guild_id: guild.id
		}).first();
	}

	async getGuildRow(guild: Guild) {
		const element: null | IGuildRow = await this.searchGuildRow(guild);

		if(element) {
			return element;
		}

		await this.db(TABLE_NAME).insert({
			guild_id: guild.id,
			voice_role: "-"
		});

		return this.searchGuildRow(guild);
	}

	async getAllSpecificRowsOfGuild(guild: Guild, method: "role" | "channel") {
		const rows = ((await this.db(SPECIFIC_TABLE_NAME).where({
			guild_id: guild.id
		})) || []) as ISpecificRoleRow[];
		const map = new Map<string, ISpecificRoleRow | ISpecificRoleRow[]>();
		for(const row of rows) {
			if(method === "channel") {
				map.set(row.channel_id, row);
			} else {
				const current = map.get(row.voice_role);
				if(current) {
					map.set(row.voice_role, ([] as ISpecificRoleRow[]).concat(current).concat(row));
				}
			}
		}
		return map;
	}

	async getSpecificRow(channel: VoiceChannel | string) {
		return await this.db(SPECIFIC_TABLE_NAME).where({
			channel_id: typeof channel === "string" ? channel : channel.id
		}).first() as ISpecificRoleRow;
	}

	async updateSpecificRole(row: ISpecificRoleRow) {
		const current = await this.getSpecificRow(row.channel_id);
		if(!current) {
			await this.db(SPECIFIC_TABLE_NAME).insert(row);
			return;
		}
		await this.db(SPECIFIC_TABLE_NAME).where({
			channel_id: row.channel_id
		}).update(row);
	}

	async deleteSpecificRow(row: ISpecificRoleRow) {
		return this.db(SPECIFIC_TABLE_NAME).where(row).delete().first();
	}

	async updateGuildRow(row: IGuildRow) {
		return this.db(TABLE_NAME).where({
			guild_id: row.guild_id
		}).update(row);
	}

	async VCR_Cleanup(guild: Guild, role?: Role) {
		if(!role) {
			const row = await this.getGuildRow(guild);

			if(row && row.voice_role !== "-") {
				if(!guild.roles.has(row.voice_role)) {
					row.voice_role = "-";
					await this.updateGuildRow(row);
				}
				role = guild.roles.get(row.voice_role);
			}
		}

		let allSpecificRows = await this.getAllSpecificRowsOfGuild(guild, "role");
		let changes = false; // to check if something changed

		// slight optimization
		const checkRow = async (s: ISpecificRoleRow) => {
			if(!guild.channels.has(s.channel_id)) {
				changes = true;
				await this.deleteSpecificRow(s);
			} else {
				if(!guild.roles.has(s.voice_role)) {
					changes = true;
					await this.deleteSpecificRow(s);
				}
			}
		};

		for(const specific of allSpecificRows.values()) {
			if(specific instanceof Array) {
				for(const s of specific) { await checkRow(s); }
			} else {
				checkRow(specific);
			}
		}

		if(changes) {
			// because we made a lot of changes before
			allSpecificRows = await this.getAllSpecificRowsOfGuild(guild, "role");
		}

		for(const member of guild.members.values()) {
			let voiceChannelOfMember: VoiceChannel | undefined = member.voiceChannel;
			if(voiceChannelOfMember && voiceChannelOfMember.guild.id !== guild.id) {
				voiceChannelOfMember = undefined;
			}

			if(role) {
				if(!voiceChannelOfMember && member.roles.has(role.id)) {
					member.removeRole(role);
				} else if(voiceChannelOfMember && !member.roles.has(role.id)) {
					member.addRole(role);
				}
			}

			// removing old specific roles
			for(const memberRole of member.roles.values()) {
				const specificRow = allSpecificRows.get(memberRole.id);
				if(!specificRow) { continue; }
				let ok = false;
				if(voiceChannelOfMember) {
					if(specificRow instanceof Array) {
						ok = !!specificRow.find((s) => voiceChannelOfMember ? voiceChannelOfMember.id === s.channel_id : false);
					} else {
						ok = voiceChannelOfMember.id === specificRow.channel_id;
					}
				}
				if(!ok) {
					member.removeRole(memberRole);
				} // else keeping role
			}

			// adding new specific role
			if(voiceChannelOfMember) {
				let specificRoleForChannel: ISpecificRoleRow | undefined = undefined;

				// because Map has no .find(), fuck
				for(const specific of allSpecificRows.values()) {
					if(specific instanceof Array) {
						for(const realSpecific of specific) {
							if(realSpecific.channel_id === voiceChannelOfMember.id) {
								specificRoleForChannel = realSpecific;
								break;
							}
						}
						if(specificRoleForChannel) { break; }
					} else {
						if(specific.channel_id === voiceChannelOfMember.id) {
							specificRoleForChannel = specific;
							break;
						}
					}
				}

				// that's finnaly all the code we need
				if(specificRoleForChannel) {
					if(guild.roles.has(specificRoleForChannel.voice_role)) {
						if(!member.roles.has(specificRoleForChannel.voice_role)) {
							member.addRole(specificRoleForChannel.voice_role);
						}
					} else {
						await this.deleteSpecificRow(specificRoleForChannel);
					}
				}
			}
		}

		return;
	}

	async VCR_Give(member: GuildMember) {
		const row = await this.getGuildRow(member.guild);
		const specificRow = member.voiceChannel ? await this.getSpecificRow(member.voiceChannel) : undefined;
		if(!row && !specificRow) { return; }

		if(row && member.voiceChannel) {
			// we have row & user in voice channel
			// let's check everything
			if(row.voice_role !== "-") {
				if(member.guild.roles.has(row.voice_role)) {
					// guild has our voice role
					// let's give it to user if he has not it
					if(!member.roles.has(row.voice_role)) {
						// yep, take this role, my dear
						await member.addRole(row.voice_role, await localizeForGuild(member.guild, "VOICEROLE_JOINED_VC", {
							channelName: member.voiceChannel.name
						}));
					} // nop, you have this role, next time.. next time...
				} else {
					// guild has no our voice role
					// no surprises in bad admins
					// removing it
					row.voice_role = "-";
					await this.updateGuildRow(row);
				}
			}
		}

		if(specificRow) {
			// we found specific role for this voice channel
			if(!member.guild.roles.has(specificRow.voice_role)) {
				// but sadly bad admin removed it, can remove row
				await this.deleteSpecificRow(specificRow);
			} else {
				// dear, do you have this specific role already?
				if(!member.roles.has(specificRow.voice_role)) {
					// nope, take it
					await member.addRole(specificRow.voice_role, await localizeForGuild(member.guild, "VOICEROLE_SPECIFIC_ADDED", {
						channelName: member.voiceChannel.name
					}));
				}
			}
		}
	}

	async VCR_Remove(member: GuildMember, newMember?: GuildMember) {
		const row = await this.getGuildRow(member.guild);
		const specificRow = member.voiceChannel ? await this.getSpecificRow(member.voiceChannel) : undefined;

		if(!row && !specificRow) { return; }

		if(!newMember || !newMember.voiceChannel) {
			// checking IF user not in voice channel anymore
			// OR if we have no 'newMember' (means user left from any channel on guild)
			// THEN deleting role
			if(row && row.voice_role !== "-") {
				if(member.guild.roles.has(row.voice_role)) {
					// role's here, we can remove it
					// but let's check if user HAS this role
					if(member.roles.has(row.voice_role)) {
						// yes, he has it, can remove
						await member.removeRole(row.voice_role, await localizeForGuild(member.guild, "VOICEROLE_LEFT_VC", {
							channelName: member.voiceChannel.name
						}));
					} // else we doing nothin'
				} else {
					// wowee, role got deleted
					// so we deleting guild row too
					row.voice_role = "-";
					await this.updateGuildRow(row);
				}
			}
		}

		if(specificRow && member.voiceChannel) {
			// we had specific role for old channel
			// time to test if everything is OK
			if(!member.guild.roles.has(specificRow.voice_role)) {
				// sadly, but this means not everything is OK
				// we have no specific role no more on this guild
				// time to delete specific row
				await this.deleteSpecificRow(specificRow);
			} else {
				// there we got good answer means everything is OK
				// we can remove old specific role
				if(member.roles.has(specificRow.voice_role)) {
					await member.removeRole(specificRow.voice_role, await localizeForGuild(member.guild, "VOICEROLE_SPECIFIC_REMOVED", {
						channelName: member.voiceChannel.name
					}));
				}
			}
		}
	}

	async voiceRoleSetting(msg: Message) {
		const hasPermissionToChange = MANAGE_PERMS(msg.member);

		if(!hasPermissionToChange) {
			msg.channel.send(await localizeForUser(msg.member, "VOICEROLE_NOPERMS"));
			return;
		}

		const subCommand = msg.content.slice(PREFIX.length + 1);
		if(subCommand === "" || subCommand === "help") {
			msg.channel.send(`${await localizeForUser(msg.member,
				"VOICEROLE_SETTING_HELP_TITLE")}\n${await localizeForUser(msg.member, "VOICEROLE_SETTING_HELP")}\n${await localizeForUser(msg.member, "VOICEROLE_SETTING_HELP_SPECIFIC")}`);
			return;
		}

		if(subCommand.startsWith("set ")) {
			// #SetGuildVoiceRole
			const resolvedRole = resolveGuildRole(subCommand.slice("set ".length), msg.guild, false);
			if(!resolvedRole) {
				msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "VOICEROLE_SETTING_FAULT_ROLENOTFOUND")
				});
				return;
			}

			const row = await this.getGuildRow(msg.guild);

			if(!row) {
				msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "VOICEROLE_SETTING_FAULT_DBGUILDNOTFOUND")
				});
				return;
			}

			const cleanupFault = async (err) => {
				$snowball.captureException(err, {
					extra: {
						row, newRole: resolvedRole,
						...messageToExtra(msg)
					}
				});
				msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "VOICEROLE_SETTING_FAULT_ROLECLEANUP")
				});
			};

			const confirmation = await createConfirmationMessage(await generateLocalizedEmbed(EmbedType.Progress, msg.member, {
				key: "VOICEROLE_SETTING_CONFIRMATION_SET",
				formatOptions: {
					role: replaceAll(resolvedRole.name, "`", "'")
				}
			}), msg);

			if(!confirmation) {
				await msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "VOICEROLE_SETTING_FAULT_CANCELED")
				});
				return;
			}

			if(row.voice_role !== "-") {
				try {
					for(const member of msg.guild.members.values()) {
						if(!row) { continue; }
						if(member.roles.has(row.voice_role)) {
							await member.removeRole(row.voice_role);
						}
					}
				} catch(err) {
					return cleanupFault(err);
				}
			}

			row.voice_role = resolvedRole.id;

			try {
				await this.updateGuildRow(row);
			} catch(err) {
				$snowball.captureException(err, {
					extra: { row, newRole: resolvedRole, ...messageToExtra(msg) }
				});
				msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "VOICEROLE_SETTING_FAULT_SAVING")
				});
				return;
			}

			try {
				await this.VCR_Cleanup(msg.guild);
			} catch(err) {
				return cleanupFault(err);
			}

			msg.react("👍");

			return;
		} else if(subCommand === "set") {
			// #HelpSetGuildVoiceRole

			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, {
					custom: true,
					string: replaceAll(await localizeForUser(msg.member, "VOICEROLE_SETTING_HELP_SET"), "\n", "\n\t")
				})
			});
			return;
		}

		if(subCommand.startsWith("delete")) {
			const row = await this.getGuildRow(msg.guild);

			if(!row) {
				msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "VOICEROLE_SETTING_FAULT_DBGUILDNOTFOUND")
				});
				return;
			}

			const cleanupFault = async (err) => {
				$snowball.captureException(err, {
					extra: {
						row,
						...messageToExtra(msg)
					}
				});
				msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "VOICEROLE_SETTING_FAULT_ROLECLEANUP")
				});
			};

			if(row.voice_role === "-") {
				msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Warning, msg.member, "VOICEROLE_SETTING_FAULT_VRNOTSET")
				});
				return;
			}

			const updateRow = async () => {
				try {
					await this.updateGuildRow(row);
				} catch(err) {
					$snowball.captureException(err, {
						extra: { ...messageToExtra(msg), row, voiceRoleDeleted: true }
					});
					msg.channel.send("", {
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "VOICEROLE_SETTING_FAULT_DBSAVING")
					});
					return false;
				}
				return true;
			};

			const resolvedRole = msg.guild.roles.get(row.voice_role);

			if(!resolvedRole) {
				row.voice_role = "-";
				if(await updateRow()) {
					msg.channel.send("", {
						embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "VOICEROLE_SETTING_FASTDELETE")
					});
				}
				return;
			}

			const confirmation = await createConfirmationMessage(await generateLocalizedEmbed(EmbedType.Progress, msg.member, {
				key: "VOICEROLE_SETTING_CONFIRMATION_DELETE",
				formatOptions: {
					role: replaceAll(resolvedRole.name, "`", "'"),
					notice: await localizeForUser(msg.member, "VOICEROLE_SETTING_CONFIRMATIONS_NOTICE")
				}
			}), msg);

			if(!confirmation) {
				await msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "VOICEROLE_SETTING_FAULT_CANCELED")
				});
				return;
			}

			try {
				for(const member of msg.guild.members.values()) {
					if(member.roles.has(row.voice_role)) {
						await member.removeRole(row.voice_role);
					}
				}
			} catch(err) {
				return cleanupFault(err);
			}

			row.voice_role = "-";

			await updateRow();

			try {
				await this.VCR_Cleanup(msg.guild);
			} catch(err) {
				return cleanupFault(err);
			}

			msg.react("👍");

			return;
		} else if(subCommand === "delete") {
			// #HelpDeleteGuildVoiceRole

			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, {
					custom: true,
					string: replaceAll(await localizeForUser(msg.member, "VOICEROLE_SETTING_HELP_DELETE"), "\n", "\n\t")
				})
			});
			return;
		}

		if(subCommand.startsWith("specific set ")) {
			const args = subCommand.slice("specific set".length).split(",").map(arg => arg.trim());
			if(args.length > 2) {
				msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "VOICEROLE_SETTING_FAULT_ARGERR")
				});
				return;
			}

			const resolvedChannel = resolveGuildChannel(args[0], msg.guild, false);
			if(!resolvedChannel) {
				msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "VOICEROLE_SETTING_FAULT_CHANNELERR")
				});
				return;
			} else if(resolvedChannel.type !== "voice") {
				msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "VOICEROLE_SETTING_FAULT_CHANNELTYPEERR")
				});
				return;
			}

			const resolvedRole = resolveGuildRole(args[1], msg.guild, false);
			if(!resolvedRole) {
				msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "VOICEROLE_SETTING_FAULT_ROLENOTFOUND")
				});
				return;
			}

			const confirmation = await createConfirmationMessage(await generateLocalizedEmbed(EmbedType.Progress, msg.member, {
				key: "VOICEROLE_SETTING_SPECIFIC_CONFIRMATION",
				formatOptions: {
					role: replaceAll(resolvedRole.name, "`", "'"),
					voiceChannel: replaceAll(resolvedChannel.name, "`", "'")
				}
			}), msg);

			if(!confirmation) {
				await msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "VOICEROLE_SETTING_FAULT_CANCELED")
				});
				return;
			}

			const current = await this.getSpecificRow(resolvedChannel as VoiceChannel);

			if(current) {
				const oldRole = current.voice_role;
				current.voice_role = resolvedRole.id;

				const progMsg = (await msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Progress, msg.member, "VOICEROLE_SETTING_SAVING")
				})) as Message;

				const cleanupFault = async (err) => {
					$snowball.captureException(err, {
						extra: {
							current, oldRole, newRole: resolvedRole,
							...messageToExtra(msg)
						}
					});
					msg.channel.send("", {
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "VOICEROLE_SETTING_FAULT_ROLECLEANUP")
					});
				};

				try {
					for(const member of msg.guild.members.values()) {
						if(member.roles.has(oldRole)) {
							await member.removeRole(oldRole);
						}
					}
				} catch(err) {
					await cleanupFault(err);
					return;
				}

				try {
					await this.updateSpecificRole(current);
				} catch(err) {
					$snowball.captureException(err, {
						extra: {
							current, oldRole, newRole: resolvedRole,
							...messageToExtra(msg)
						}
					});
					msg.channel.send("", {
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "VOICEROLE_SETTING_FAULT_DBSAVING")
					});
					return;
				}

				try {
					await this.VCR_Cleanup(msg.guild);
				} catch(err) {
					return cleanupFault(err);
				}

				progMsg.edit("", {
					embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, "VOICEROLE_SETTING_SAVING_DONE")
				});
				msg.react("👍");

				return;
			}

			const newRow: ISpecificRoleRow = {
				channel_id: resolvedChannel.id,
				guild_id: msg.guild.id,
				voice_role: resolvedRole.id
			};

			const progMsg = (await msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "VOICEROLE_SETTING_SAVING")
			})) as Message;
			try {
				await this.updateSpecificRole(newRow);
				await this.VCR_Cleanup(msg.guild);
			} catch(err) {
				$snowball.captureException(err, {
					extra: {
						current, new: newRow,
						...messageToExtra(msg)
					}
				});
				progMsg.edit("", {
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "VOICEROLE_SETTING_FAULT_DBSAVING")
				});
			}

			progMsg.edit("", {
				embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, "VOICEROLE_SETTING_SETTINGDONE")
			});
			msg.react("👍");

			return;
		} else if(subCommand === "specific set") {
			// #HelpSpecificSetGuildVoiceRole
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, {
					key: "VOICEROLE_SETTING_HELP_SPECIFIC_SET",
					formatOptions: {
						argInfo: replaceAll(await localizeForUser(msg.member, "VOICEROLE_SETTING_ARGINFO_SPECIFIC"), "\n", "\n\t")
					}
				})
			});
			return;
		}

		if(subCommand.startsWith("specific delete ")) {
			const resolvedChannel = resolveGuildChannel(subCommand.slice("specific delete ".length), msg.guild, false);
			if(!resolvedChannel) {
				msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "VOICEROLE_SETTING_FAULT_CHANNELERR")
				});
				return;
			}

			if(resolvedChannel.type !== "voice") {
				msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "VOICEROLE_SETTING_FAULT_CHANNELTYPEERR")
				});
				return;
			}

			const current = await this.getSpecificRow(resolvedChannel as VoiceChannel);

			if(!current) {
				msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "VOICEROLE_SETTING_FAULT_NOSPECIFICROLE")
				});
				return;
			}

			const resolvedRole = msg.guild.roles.get(current.voice_role);
			if(!resolvedRole) {
				// removing faster!
				try {
					await this.deleteSpecificRow(current);
				} catch(err) {
					$snowball.captureException(err, {
						extra: {
							specificDeleted: false, current,
							...messageToExtra(msg)
						}
					});
					msg.channel.send("", {
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "VOICEROLE_SETTING_FAULT_DBSAVING")
					});
					return;
				}
				msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "VOICEROLE_SETTING_SPECIFIC_FASTDELETE")
				});
				return;
			}

			const confirmation = await createConfirmationMessage(await generateLocalizedEmbed(EmbedType.Progress, msg.member, {
				key: "VOICEROLE_SETTING_SPECIFIC_DELETECONFIRMATION",
				formatOptions: {
					role: replaceAll(resolvedRole.name, "`", "'"),
					voiceChannel: replaceAll(resolvedChannel.name, "`", "'"),
					notice: await localizeForUser(msg.member, "VOICEROLE_SETTING_CONFIRMATIONS_NOTICE")
				}
			}), msg);

			if(!confirmation) {
				await msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "VOICEROLE_SETTING_FAULT_CANCELED")
				});
				return;
			}

			const progMsg = (await msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Progress, msg.member, "VOICEROLE_SETTING_SAVING")
			})) as Message;

			try {
				await this.deleteSpecificRow(current);
			} catch(err) {
				$snowball.captureException(err, {
					extra: {
						specificDeleted: false, current,
						...messageToExtra(msg)
					}
				});
				msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "VOICEROLE_SETTING_FAULT_DBSAVING")
				});
				return;
			}

			try {
				for(const member of msg.guild.members.values()) {
					if(member.roles.has(current.voice_role)) {
						await member.removeRole(current.voice_role);
					}
				}
				await this.VCR_Cleanup(msg.guild);
			} catch(err) {
				$snowball.captureException(err, {
					extra: {
						specificDeleted: true, current,
						...messageToExtra(msg)
					}
				});
				msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "VOICEROLE_SETTING_FAULT_ROLECLEANUP")
				});
				return;
			}

			progMsg.edit("", {
				embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, "VOICEROLE_SETTING_SPEFIC_DELETED")
			});
			msg.react("👍");

			return;
		} else if(subCommand === "specific delete") {
			// #HelpSpecificDeleteGuildVoiceRole
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, {
					key: "VOICEROLE_SETTING_HELP_SPECIFIC_DELETE",
					formatOptions: {
						argInfo: replaceAll(await localizeForUser(msg.member, "VOICEROLE_SETTING_ARGINFO_SPECIFIC"), "\n", "\n\t")
					}
				})
			});
		}
	}

	async unload() {
		this.unhandleEvents();
		return true;
	}
}

module.exports = VoiceRole;
