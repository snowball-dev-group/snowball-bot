import { IModule } from "../../types/ModuleLoader";
import { Plugin } from ".././plugin";
import { Message, GuildMember, TextChannel } from "discord.js";
import { EmbedType, generateEmbed } from "../utils/utils";
import { command } from "../utils/help";
import { generateLocalizedEmbed, localizeForUser } from "../utils/ez-i18n";
import * as getLogger from "loggy";

const FL_COLOR = 0x1E88E5;

@command("UTILITES", "fl", "loc:FL_META_NAME")
class ReverseLayout extends Plugin implements IModule {
	public get signature() {
		return "walpy.reverse_layout";
	}

	log = getLogger("fl");

	constructor() {
		super({
			"message": (msg: Message) => this.onMessage(msg)
		});
		this.log("ok", "FL is loaded");
	}

	reverse(content: string, firstLine: string, secondLine: string): string {
		if(!content) { return ""; }
		let result = "";
		const lineFrom = firstLine + secondLine;
		const lineTo = secondLine + firstLine;
		for(let i = 0, cl = content.length; i < cl; i++) {
			const pos = lineFrom.indexOf(content[i]);
			result = result + ((pos < 0) ? content[i] : lineTo[pos]);
		}
		return result;
	}

	async onMessage(msg: Message) {
		if(!msg.content) { return; }
		if(msg.content !== "!fl") { return; }
		const user = msg.member || msg.author;

		// delete msg with command
		if(!(msg.channel instanceof TextChannel)) { return; }
		try {
			await msg.delete();
		} catch(err) {
			this.log("err", "Can't delete message with command...", err);
		}

		if(await localizeForUser(user, "+FL_SUPPORTED") === "false") {
			await msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, user, "FL_ERR_NOTSUPPORTED")
			});
			return;
		}

		// fetch last messages in channel
		const messages = await msg.channel.messages.fetch();
		if(!messages) {
			await msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, user, "FL_ERR_CANTFETCH")
			});
			return;
		}

		// find last message by this author
		const originalMessage = messages.find(x => (x.member || x.author).id === user.id);
		if(!originalMessage) {
			await msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, user, "FL_ERR_NOMESSAGES")
			});
			return;
		}
		if(!originalMessage.content) {
			await msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, user, "FL_ERR_EMPTYMESSAGE")
			});
			return;
		}
		let reversed = originalMessage.content;

		// fetch replace lines
		let lineLanguage = await localizeForUser(user, "+FL_REPLACELINE_LOCALIZED");
		let lineEnglish = await localizeForUser(user, "+FL_REPLACELINE_ENGLISH");
		if(lineLanguage.length !== lineEnglish.length) {
			const newLength = Math.min(lineLanguage.length, lineEnglish.length);
			lineLanguage = lineLanguage.substring(0, newLength);
			lineEnglish = lineEnglish.substring(0, newLength);
		}

		// reverse mentions
		reversed = reversed.replace(/<@[!&]{0,1}[0-9]{18}>/g,
			(x) => this.reverse(x, lineLanguage, lineEnglish));
		// reverse emojies
		reversed = reversed.replace(/<:[^<:>]*:[0-9]{18}>/g,
			(x) => this.reverse(x, lineLanguage, lineEnglish));
		// reverse whole message
		reversed = this.reverse(reversed, lineLanguage, lineEnglish);

		// send reversed message
		try {
			await msg.channel.send("", {
				embed: await generateEmbed(EmbedType.Empty, reversed, {
					author: {
						name: user.displayName,
						icon_url: (user instanceof GuildMember ? user.user : user).displayAvatarURL({ format: "webp", size: 128 })
					},
					footer: {
						icon_url: $discordBot.user.displayAvatarURL({ format: "webp", size: 128 }),
						text: await localizeForUser(msg.member, "FL_MESSAGE_INREPLY", {
							botname: $discordBot.user.username
						})
					},
					color: FL_COLOR,
					ts: msg.createdAt
				})
			});
		} catch(err) {
			this.log("err", "Damn! FL can't send message", err);
			return;
		}

		try {
			await originalMessage.delete();
		} catch(err) {
			this.log("err", "Can't delete original message...", err);
		}
	}

	async unload() {
		this.unhandleEvents();
		return true;
	}
}

module.exports = ReverseLayout;
