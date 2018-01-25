import { isPremium } from "../utils/premium";
import { Plugin } from "../plugin";
import { IModule } from "../../types/ModuleLoader";
import { GuildMember, Message, Role, TextChannel } from "discord.js";
import * as Random from "random-js";
import { getLogger, EmbedType, resolveGuildRole, escapeDiscordMarkdown } from "../utils/utils";
import { generateLocalizedEmbed, localizeForUser } from "../utils/ez-i18n";
import { randomPick } from "../utils/random";

const SYNC_INTERVAL_MIN = 1800000;

interface ISubText {
	roleId: string;
	text: string;
}

interface IOptions {
	/**
	 * ID of FS guild
	 */
	fsGuildId: string;

	/**
	 * Subscribers roles
	 */
	subRoles: string[];
	/**
	 * One role for subscribers
	 */
	oneSubRole: string;

	/**
	 * Texts for subscrib
	 */
	texts: ISubText[];

	subAncChannel: string;

	/**
	 * Admins roles
	 */
	adminRoles: string[];
	/**
	 * Moderators roles
	 */
	modRoles: string[];

	nickRegexp: string;

	nickSkipped: string[];

	wrongNickFallback: string;

	syncInterval: number;
}

const acceptedCommands = ["choose", "pick"];

/**
 * Fan Server of BlackSilverUFA & DariyaWillis
 * Partnered until 01.01.2019
 */
class FanServerThings extends Plugin implements IModule {
	public get signature() {
		return "snowball.partners.fsofbsadw";
	}

	options: IOptions;
	nickRegexp: RegExp;
	log = getLogger("FSofBSaDW");

	constructor(options: IOptions) {
		super({
			"guildMemberUpdate": (oldMember: GuildMember, newMember: GuildMember) => this.onUpdate(oldMember, newMember),
			"guildMemberAdd": (member: GuildMember) => this.newMember(member),
			"message": (msg: Message) => this.onMessage(msg)
		}, true);
		
		this.nickRegexp = new RegExp(options.nickRegexp, "i");
		const fsGuild = $discordBot.guilds.get(options.fsGuildId);
		if(!fsGuild) {
			this.log("err", "Fan Server's guild not found");
			return;
		}

		for(const roleId of options.subRoles) {
			const subRole = fsGuild.roles.get(roleId);
			if(!subRole) {
				this.log("err", "One of the subroles is not found:", roleId);
				throw new Error(`Invalid subscriber role reference: ${roleId}`);
			}
			this.log("ok", `Found subscriber role: ${subRole.id} - ${subRole.name}`);
		}

		const oneSubRole = fsGuild.roles.get(options.oneSubRole);
		if(!oneSubRole) {
			this.log("err", `Could not find general subscribers role: ${options.oneSubRole}`);
			throw new Error(`Invalid general role reference: ${options.oneSubRole}`);
		}

		this.log("ok", `Found general subscriber role: ${oneSubRole.id} - ${oneSubRole.name}`);

		if(typeof options.syncInterval !== "number") {
			this.log("info", `Sync interval set to minimal value - ${SYNC_INTERVAL_MIN}`);
			options.syncInterval = SYNC_INTERVAL_MIN;
		} else {
			options.syncInterval = Math.max(SYNC_INTERVAL_MIN, options.syncInterval);
			this.log("info", `Sync interval set to the value - ${options.syncInterval}`);
		}

		this.options = options;

		this.handleEvents();
	}

	syncInterval: NodeJS.Timer;

	async init() {
		await this.sync();
		if(!this.syncInterval) {
			this.syncInterval = setInterval(async () => this.sync(false), this.options.syncInterval);
		}
	}

	async sync(log = true) {
		const fsGuild = $discordBot.guilds.get(this.options.fsGuildId);
		if(!fsGuild) {
			this.log("err", "Fan Server's guild not found, skipping init cycle");
			return;
		}
		log && this.log("info", "Synchronization started");
		const startedAt = Date.now();
		for(const member of fsGuild.members.values()) {
			await this.onUpdate(member, member);
		}
		log && this.log("ok", `Synchronization done in ${(Date.now() - startedAt)}ms!`);
	}

	async onUpdate(oldMember: GuildMember, newMember: GuildMember) {
		if(oldMember.guild.id === this.options.fsGuildId) {
			await this.onFSUpdate(oldMember, newMember);
		}
	}

	async onMessage(msg: Message) {
		if(!msg.member || msg.channel.type !== "text") { return; }
		if(msg.guild.id !== this.options.fsGuildId && msg.author.id !== $botConfig.botOwner) { return; }
		const cmd = acceptedCommands.find(c => msg.content.startsWith(`!${c}`));
		if(!cmd) { return; }
		switch(cmd) {
			case "choose": case "pick": return this.cmd_choose(msg, cmd);
		}
	}

	async cmd_choose(msg: Message, cmd: string) {
		// limited only to admins?
		if(!msg.member.permissions.has("ADMINISTRATOR")) { return; }

		let role: Role | undefined = msg.mentions.roles.first();
		const roleName = msg.content.slice(`!${cmd} `.length);
		if(roleName.length === 0 && !role) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "FSTHINGS_CHOOSE_NOROLENAME")
			});
		} else if(!role) {
			role = resolveGuildRole(roleName, msg.guild, false);
		}

		if(!role) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "FSTHINGS_CHOOSE_ROLENOTFOUND")
			});
		}

		let members = role.members.array();
		// filtering bots out
		members = members.filter(m => !m.user.bot);
		if(members.length === 0) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Warning, msg.member, "FSTHINGS_CHOOSE_EMPTYROLE")
			});
		}

		const pickedMember = randomPick(members);
		if(!pickedMember) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, {
					key: "FSTHINGS_CHOOSE_INTERNALERROR001",
					formatOptions: {
						found_members: members.length
					}
				})
			});
		}

		return msg.channel.send({
			embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "FSTHINGS_CHOOSE_FOUND", {
				fields: [{
					inline: false,
					name: await localizeForUser(msg.member, "FSTHINGS_CHOOSE_EMBED_ROLE"),
					value: `${role}\n**${escapeDiscordMarkdown(role.name, true)}** (ID: ${role.id})`
				}, {
					inline: false,
					name: await localizeForUser(msg.member, "FSTHINGS_CHOOSE_EMBED_MEMBER"),
					value: `${pickedMember}\n**${escapeDiscordMarkdown(pickedMember.displayName, true)}** (@${escapeDiscordMarkdown(pickedMember.user.tag, true)})\nID: ${pickedMember.id}`
				}],
				thumbUrl: pickedMember.user.avatar ? pickedMember.user.displayAvatarURL(pickedMember.user.avatar.startsWith("a_") ? { format: "gif" } : { format: "png", size: 512 }) : undefined
			})
		});
	}

	async newMember(member: GuildMember) {
		if(member.guild.id !== this.options.fsGuildId) { return; }
		await this.nickCheck(member);
	}

	async nickCheck(member: GuildMember, oldMember?: GuildMember) {
		if(member.permissions.has(["ADMINISTRATOR"]) || member.permissions.has(["MANAGE_MESSAGES", "BAN_MEMBERS", "KICK_MEMBERS"])) {
			// admin / moderator
			return;
		}

		if(this.options.nickSkipped) {
			for(const skipArgument of this.options.nickSkipped) {
				switch(skipArgument.toLowerCase()) {
					case "$snowball_premium": {
						if(await isPremium(member)) {
							return;
						} else { continue; }
					}
					case "$sub_role": {
						if(member.roles.has(this.options.oneSubRole)) {
							return;
						} else { continue; }
					}
					default: {
						if(skipArgument.startsWith("@")) {
							if(member.id === skipArgument.slice(1)) {
								return;
							} else { continue; }
						} else if(skipArgument.startsWith("&")) {
							if(member.roles.has(skipArgument.slice(1))) {
								return;
							} else { continue; }
						}
						this.log("err", "Invalid skip argument provided", skipArgument);
					} break;
				}
			}
		}

		if(!this.nickRegexp.test(member.displayName) && member.displayName !== this.options.wrongNickFallback) {
			if(oldMember) {
				if(!this.nickRegexp.test(oldMember.displayName) && oldMember.displayName !== this.options.wrongNickFallback) {
					member.setNickname(this.options.wrongNickFallback);
				} else {
					member.setNickname(oldMember.displayName);
				}
			} else {
				member.setNickname(this.options.wrongNickFallback);
			}
		}
	}

	async onFSUpdate(oldMember: GuildMember, newMember: GuildMember) {
		await this.nickCheck(newMember, oldMember);

		// finding subscription roles
		const subRole = newMember.roles.filter((r) => this.options.subRoles.includes(r.id));
		// checking if member has general subscribers role
		const oneSubRole = newMember.roles.find((r) => this.options.oneSubRole === r.id);

		// let removedRoles = oldMember.roles.filter((r) => !newMember.roles.has(r.id));
		const newRoles = newMember.roles.filter((r) => !oldMember.roles.has(r.id));

		if(subRole.size > 0 && !oneSubRole) {
			const newSubRoles = newRoles.filter((r) => this.options.subRoles.includes(r.id));

			this.log("info", `${newMember.displayName} (ID: ${newMember.id}) - found subscriber role(s): ${subRole.map(r => r.name).join(", ")}`);

			// has subrole but not onesub role
			await newMember.addRole(this.options.oneSubRole);

			const random = new Random(Random.engines.mt19937().autoSeed());

			// not going to search channel if none of the subscriber roles is NEW
			if(newSubRoles.size > 0) {
				const announceChannel = newMember.guild.channels.find("id", this.options.subAncChannel);
				if(announceChannel) {
					for(const newSubscriberRole of newSubRoles.keys()) {
						const texts = this.options.texts.filter(r => r.roleId === newSubscriberRole);
						if(texts.length === 0) { continue; }
						const randText: ISubText = random.pick(texts);
						// as we already know - announceChannel has TextChannel type
						(announceChannel as TextChannel).send(randText.text.replace("++", newMember.toString()));
					}
				}
			}
		} else if(subRole.size === 0 && oneSubRole) {
			this.log("info", `${newMember.displayName} (ID: ${newMember.id}) - has no subscriber role(s), but has general one, removing`);

			// doesn't has sub role but has onesub role
			await newMember.removeRole(this.options.oneSubRole);
		}
	}

	async unload() {
		if(this.syncInterval) {
			clearInterval(this.syncInterval);
		}
		this.unhandleEvents();
		return true;
	}
}

module.exports = FanServerThings;
