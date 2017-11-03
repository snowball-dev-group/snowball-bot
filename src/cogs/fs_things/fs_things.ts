import { Plugin } from "../plugin";
import { IModule } from "../../types/ModuleLoader";
import { GuildMember, TextChannel } from "discord.js";
import * as Random from "random-js";
import { getLogger } from "../utils/utils";

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

	wrongNickFallback: string;
}

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
			"guildMemberAdd": (member: GuildMember) => this.newMember(member)
		}, true);

		this.options = options;
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

		this.handleEvents();
	}

	async init() {
		const fsGuild = $discordBot.guilds.get(this.options.fsGuildId);
		if(!fsGuild) {
			this.log("err", "Fan Server's guild not found, skipping init cycle");
			return;
		}
		this.log("info", "Synchronization started");
		const startedAt = Date.now();
		for(const member of fsGuild.members.values()) {
			await this.onUpdate(member, member);
		}
		this.log("ok", `Synchronization done in ${(Date.now() - startedAt)}ms!`);
	}

	async onUpdate(oldMember: GuildMember, newMember: GuildMember) {
		if(oldMember.guild.id === this.options.fsGuildId) {
			await this.onFSUpdate(oldMember, newMember);
		}
	}

	async newMember(member: GuildMember) {
		if(member.guild.id !== this.options.fsGuildId) {
			return;
		}

		await this.nickCheck(member);
	}

	async nickCheck(member: GuildMember, oldMember?: GuildMember) {
		if(member.permissions.has(["ADMINISTRATOR"]) || member.permissions.has(["MANAGE_MESSAGES", "BAN_MEMBERS", "KICK_MEMBERS"])) {
			// admin / moderator
			return;
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
				if(!!announceChannel) {
					for(const newSubscriberRole of newSubRoles.keys()) {
						const texts = this.options.texts.filter(r => r.roleId === newSubscriberRole);
						if(texts.length === 0) { continue; }
						const randText: ISubText = random.pick(texts);
						// as we already know - announceChannel has TextChannel type
						(announceChannel as TextChannel).send(randText.text.replace("++", newMember.toString()));
					}
				}
			}
		} else if(subRole.size === 0 && !!oneSubRole) {
			this.log("info", `${newMember.displayName} (ID: ${newMember.id}) - has no subscriber role(s), but has general one, removing`);

			// doesn't has sub role but has onesub role
			await newMember.removeRole(this.options.oneSubRole);
		}
	}

	async unload() {
		this.unhandleEvents();
		return true;
	}
}

module.exports = FanServerThings;