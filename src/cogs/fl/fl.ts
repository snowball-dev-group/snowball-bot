import { IModule } from "../../types/ModuleLoader";
import { Plugin } from ".././plugin";
import { Message, GuildMember, TextChannel } from "discord.js";
import { EmbedType, generateEmbed, getMessageMemberOrAuthor } from "../utils/utils";
import { command } from "../utils/help";
import { generateLocalizedEmbed, localizeForUser } from "../utils/ez-i18n";
import * as getLogger from "loggy";

const FL_COLOR = 0x1E88E5;

@command("UTILITES", "fl", "loc:FL_META_NAME")
class ReverseLayout extends Plugin implements IModule {
	public get signature() {
		return "walpy.reverse_layout";
	}

	private static readonly _log = getLogger("ReverseLayout");

	constructor() {
		super({
			"message": (msg: Message) => this._onMessage(msg)
		});
	}

	private static _reverse(content: string, firstLine: string, secondLine: string): string {
		if (!content) { return ""; }
		let result = "";
		const lineFrom = firstLine + secondLine;
		const lineTo = secondLine + firstLine;
		for (let i = 0, cl = content.length; i < cl; i++) {
			const pos = lineFrom.indexOf(content[i]);
			result = result + ((pos < 0) ? content[i] : lineTo[pos]);
		}
		return result;
	}

	private async _onMessage(msg: Message) {
		if (!msg.content) { return; }
		if (msg.content !== "!fl") { return; }

		const author = await getMessageMemberOrAuthor(msg);

		if (!author) { return; }

		// delete msg with command
		if (!(msg.channel instanceof TextChannel)) { return; }

		try {
			await msg.delete();
		} catch (err) {
			ReverseLayout._log("warn", "Failed to delete the command message", err);
		}

		if (await localizeForUser(author, "+FL_SUPPORTED") === "false") {
			return msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, author, "FL_ERR_NOTSUPPORTED")
			});
		}

		// fetch last messages in channel
		const messages = await msg.channel.messages.fetch();
		if (!messages) {
			return msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, author, "FL_ERR_CANTFETCH")
			});
		}

		// find last message by this author
		const originalMessage = messages.find(x => (x.member || x.author).id === author.id);
		if (!originalMessage) {
			return msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, author, "FL_ERR_NOMESSAGES")
			});
		}

		if (!originalMessage.content) {
			return msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, author, "FL_ERR_EMPTYMESSAGE")
			});
		}

		let reversed = originalMessage.content;

		// fetch replace lines
		let lineLanguage = await localizeForUser(author, "+FL_REPLACELINE_LOCALIZED");
		let lineEnglish = await localizeForUser(author, "+FL_REPLACELINE_ENGLISH");
		if (lineLanguage.length !== lineEnglish.length) {
			const newLength = Math.min(lineLanguage.length, lineEnglish.length);
			lineLanguage = lineLanguage.substring(0, newLength);
			lineEnglish = lineEnglish.substring(0, newLength);
		}

		// reverse mentions
		reversed = reversed.replace(/<@[!&]{0,1}[0-9]{18}>/g,
			(x) => ReverseLayout._reverse(x, lineLanguage, lineEnglish));
		// reverse emojies
		reversed = reversed.replace(/<:[^<:>]*:[0-9]{18}>/g,
			(x) => ReverseLayout._reverse(x, lineLanguage, lineEnglish));
		// reverse whole message
		reversed = ReverseLayout._reverse(reversed, lineLanguage, lineEnglish);

		// send reversed message
		try {
			await msg.channel.send("", {
				embed: await generateEmbed(EmbedType.Empty, reversed, {
					author: {
						name: author instanceof GuildMember ? author.displayName : author.username,
						icon_url: (author instanceof GuildMember ? author.user : author).displayAvatarURL({ format: "webp", size: 128 })
					},
					footer: {
						icon_url: $discordBot.user.displayAvatarURL({ format: "webp", size: 128 }),
						text: await localizeForUser(author, "FL_MESSAGE_INREPLY", {
							botname: $discordBot.user.username
						})
					},
					color: FL_COLOR,
					ts: msg.createdAt
				})
			});
		} catch (err) {
			ReverseLayout._log("err", "Failed to send message with changed layout", err);
			return;
		}

		try {
			await originalMessage.delete();
		} catch (err) {
			ReverseLayout._log("err", "Failed to delete original message", err);
		}
	}

	public async unload() {
		this.unhandleEvents();
		return true;
	}
}

module.exports = ReverseLayout;
