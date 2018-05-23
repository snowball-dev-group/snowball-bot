import { isPremium } from "../utils/premium";
import { Plugin } from "../plugin";
import { IModule } from "../../types/ModuleLoader";
import { GuildMember, Message, Role, TextChannel } from "discord.js";
import { EmbedType, resolveGuildRole, escapeDiscordMarkdown } from "../utils/utils";
import { generateLocalizedEmbed, localizeForUser } from "../utils/ez-i18n";
import { randomPick } from "../utils/random";
import * as Random from "random-js";
import * as getLogger from "loggy";

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

	private readonly _options: IOptions;
	private readonly _nickRegexp: RegExp;
	private readonly _log = getLogger("FSofBSaDW");

	constructor(options: IOptions) {
		super({
			"guildMemberUpdate": (oldMember: GuildMember, newMember: GuildMember) => this._onUpdate(oldMember, newMember),
			"guildMemberAdd": (member: GuildMember) => this._onNewMember(member),
			"message": (msg: Message) => this._onMessage(msg)
		}, true);
		
		this._nickRegexp = new RegExp(options.nickRegexp, "i");
		const fsGuild = $discordBot.guilds.get(options.fsGuildId);
		if (!fsGuild) {
			this._log("err", "Fan Server's guild not found");
			return;
		}

		for (const roleId of options.subRoles) {
			const subRole = fsGuild.roles.get(roleId);
			if (!subRole) {
				this._log("err", "One of the subroles is not found:", roleId);
				throw new Error(`Invalid subscriber role reference: ${roleId}`);
			}
			this._log("ok", `Found subscriber role: ${subRole.id} - ${subRole.name}`);
		}

		const oneSubRole = fsGuild.roles.get(options.oneSubRole);
		if (!oneSubRole) {
			this._log("err", `Could not find general subscribers role: ${options.oneSubRole}`);
			throw new Error(`Invalid general role reference: ${options.oneSubRole}`);
		}

		this._log("ok", `Found general subscriber role: ${oneSubRole.id} - ${oneSubRole.name}`);

		if (typeof options.syncInterval !== "number") {
			this._log("info", `Sync interval set to minimal value - ${SYNC_INTERVAL_MIN}`);
			options.syncInterval = SYNC_INTERVAL_MIN;
		} else {
			options.syncInterval = Math.max(SYNC_INTERVAL_MIN, options.syncInterval);
			this._log("info", `Sync interval set to the value - ${options.syncInterval}`);
		}

		this._options = options;

		this.handleEvents();
	}

	private _syncInterval: NodeJS.Timer;

	public async init() {
		await this._sync();
		if (!this._syncInterval) {
			this._syncInterval = setInterval(async () => this._sync(false), this._options.syncInterval);
		}
	}

	private async _sync(log = true) {
		const fsGuild = $discordBot.guilds.get(this._options.fsGuildId);
		if (!fsGuild) {
			this._log("err", "Fan Server's guild not found, skipping init cycle");
			return;
		}
		log && this._log("info", "Synchronization started");
		const startedAt = Date.now();
		for (const member of fsGuild.members.values()) {
			await this._onUpdate(member, member);
		}
		log && this._log("ok", `Synchronization done in ${(Date.now() - startedAt)}ms!`);
	}

	private async _onUpdate(oldMember: GuildMember, newMember: GuildMember) {
		if (oldMember.guild.id === this._options.fsGuildId) {
			await this._onFSUpdate(oldMember, newMember);
		}
	}

	private async _onMessage(msg: Message) {
		if (!msg.member || msg.channel.type !== "text") { return undefined; }
		if (msg.guild.id !== this._options.fsGuildId && msg.author.id !== $botConfig.botOwner) { return undefined; }
		const cmd = acceptedCommands.find(c => msg.content.startsWith(`!${c}`));
		if (!cmd) { return undefined; }
		switch (cmd) {
			case "choose": case "pick": return this._chooseCmd(msg, cmd);
			default: { return undefined; }
		}
	}

	private async _chooseCmd(msg: Message, cmd: string) {
		// limited only to admins?
		if (!msg.member.permissions.has("ADMINISTRATOR")) { return; }

		let role: Role | undefined = msg.mentions.roles.first();
		const roleName = msg.content.slice(`!${cmd} `.length);
		if (roleName.length === 0 && !role) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "FSTHINGS_CHOOSE_NOROLENAME")
			});
		} else if (!role) {
			role = resolveGuildRole(roleName, msg.guild, false);
		}

		if (!role) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "FSTHINGS_CHOOSE_ROLENOTFOUND")
			});
		}

		let members = role.members.array();
		// filtering bots out
		members = members.filter(m => !m.user.bot);
		if (members.length === 0) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Warning, msg.member, "FSTHINGS_CHOOSE_EMPTYROLE")
			});
		}

		const pickedMember = randomPick(members);
		if (!pickedMember) {
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

	private async _onNewMember(member: GuildMember) {
		if (member.guild.id !== this._options.fsGuildId) { return; }
		await this._nickCheck(member);
	}

	private async _nickCheck(member: GuildMember, oldMember?: GuildMember) {
		if (member.permissions.has(["ADMINISTRATOR"]) || member.permissions.has(["MANAGE_MESSAGES", "BAN_MEMBERS", "KICK_MEMBERS"])) {
			// admin / moderator
			return;
		}

		if (this._options.nickSkipped) {
			for (const skipArgument of this._options.nickSkipped) {
				switch (skipArgument.toLowerCase()) {
					case "$snowball_premium": {
						if (await isPremium(member)) {
							return;
						} else { continue; }
					}
					case "$sub_role": {
						if (member.roles.has(this._options.oneSubRole)) {
							return;
						} else { continue; }
					}
					default: {
						if (skipArgument.startsWith("@")) {
							if (member.id === skipArgument.slice(1)) {
								return;
							} else { continue; }
						} else if (skipArgument.startsWith("&")) {
							if (member.roles.has(skipArgument.slice(1))) {
								return;
							} else { continue; }
						}
						this._log("err", "Invalid skip argument provided", skipArgument);
					} break;
				}
			}
		}

		if (this._nickRegexp.test(member.displayName) || member.displayName === this._options.wrongNickFallback) {
			return;
		}

		if (!oldMember) {
			member.setNickname(this._options.wrongNickFallback);
			return;
		}

		if (!this._nickRegexp.test(oldMember.displayName) && oldMember.displayName !== this._options.wrongNickFallback) {
			member.setNickname(this._options.wrongNickFallback);
		} else {
			member.setNickname(oldMember.displayName);
		}
	}

	private async _onFSUpdate(oldMember: GuildMember, newMember: GuildMember) {
		await this._nickCheck(newMember, oldMember);

		// finding subscription roles
		const subRole = newMember.roles.filter((r) => this._options.subRoles.includes(r.id));
		// checking if member has general subscribers role
		const oneSubRole = newMember.roles.find((r) => this._options.oneSubRole === r.id);

		// let removedRoles = oldMember.roles.filter((r) => !newMember.roles.has(r.id));
		const newRoles = newMember.roles.filter((r) => !oldMember.roles.has(r.id));

		if (subRole.size > 0 && !oneSubRole) {
			const newSubRoles = newRoles.filter((r) => this._options.subRoles.includes(r.id));

			this._log("info", `${newMember.displayName} (ID: ${newMember.id}) - found subscriber role(s): ${subRole.map(r => r.name).join(", ")}`);

			// has subrole but not onesub role
			await newMember.roles.add(this._options.oneSubRole);

			const random = new Random(Random.engines.mt19937().autoSeed());

			// not going to search channel if none of the subscriber roles is NEW
			if (newSubRoles.size > 0) {
				const announceChannel = newMember.guild.channels.find("id", this._options.subAncChannel);
				if (announceChannel) {
					for (const newSubscriberRole of newSubRoles.keys()) {
						const texts = this._options.texts.filter(r => r.roleId === newSubscriberRole);
						if (texts.length === 0) { continue; }
						const randText: ISubText = random.pick(texts);
						// as we already know - announceChannel has TextChannel type
						(<TextChannel> announceChannel).send(randText.text.replace("++", newMember.toString()));
					}
				}
			}
		} else if (subRole.size === 0 && oneSubRole) {
			this._log("info", `${newMember.displayName} (ID: ${newMember.id}) - has no subscriber role(s), but has general one, removing`);

			// doesn't has sub role but has onesub role
			await newMember.roles.remove(this._options.oneSubRole);
		}
	}

	public async unload() {
		if (this._syncInterval) {
			clearInterval(this._syncInterval);
		}
		this.unhandleEvents();
		return true;
	}
}

module.exports = FanServerThings;
