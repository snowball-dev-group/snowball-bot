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
		let fsGuild = $discordBot.guilds.get(options.fsGuildId);
		if(!fsGuild) {
			this.log("err", "Fan Server's guild not found");
			return;
		}
		this.handleEvents();
	}

	async init() {
		let fsGuild = $discordBot.guilds.get(this.options.fsGuildId);
		if(!fsGuild) {
			this.log("err", "Fan Server's guild not found, skipping init cycle");
			return;
		}
		this.log("info", "Synchronization started");
		const startedAt = Date.now();
		for(let member of fsGuild.members.values()) {
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
		if(member.hasPermission(["ADMINISTRATOR"]) || member.hasPermission(["MANAGE_MESSAGES", "BAN_MEMBERS", "KICK_MEMBERS"])) {
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

		// checking if member has atleast one sub role
		let subRole = newMember.roles.find((r) => this.options.subRoles.includes(r.id));
		let oneSubRole = newMember.roles.find((r) => this.options.oneSubRole === r.id);

		// let removedRoles = oldMember.roles.filter((r) => !newMember.roles.has(r.id));
		let newRoles = newMember.roles.filter((r) => !oldMember.roles.has(r.id));

		if(!!subRole && !oneSubRole) {
			let newSubRoles = newRoles.filter((r) => this.options.subRoles.includes(r.id));

			// has subrole but not onesub role
			await newMember.addRole(this.options.oneSubRole);

			let random = new Random(Random.engines.mt19937().autoSeed());

			let ancChannel = newMember.guild.channels.find("id", this.options.subAncChannel);
			if(!!ancChannel) {
				for(let nSubRole of newSubRoles.keys()) {
					let texts = this.options.texts.filter(r => r.roleId === nSubRole);
					if(texts.length === 0) { continue; }
					let randText: ISubText = random.pick(texts);
					(ancChannel as TextChannel).send(randText.text.replace("++", newMember.toString()));
				}
			}
		} else if(!subRole && !!oneSubRole) {
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