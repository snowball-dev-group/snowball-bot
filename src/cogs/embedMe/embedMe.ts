import { IModule } from "../../types/ModuleLoader";
import { Plugin } from "../plugin";
import { Message } from "discord.js";
import { command as docCmd } from "../utils/help";
import { localizeForUser } from "../utils/ez-i18n";
import { getMessageMemberOrAuthor, getUserDisplayName } from "@cogs/utils/utils";

@docCmd("HELPFUL", "embed", "loc:EMBEDME_CMDMETA_DESCRIPTION", {
	"loc:PROFILES_META_SETBIO_ARG0": {
		optional: false,
		description: "loc:EMBEDME_CMDMETA_ARG_DESCRIPTION"
	}
})
class EmbedME extends Plugin implements IModule {
	public get signature() {
		return "snowball.features.embedme";
	}

	constructor() {
		super({
			"message": (msg: Message) => this._onMessage(msg)
		});
	}

	private async _onMessage(msg: Message) {
		if (!msg.content.startsWith("!embed")) { return; }

		const msgAuthor = await getMessageMemberOrAuthor(msg);
		if (!msgAuthor) { return; }

		if (msg.content === "!embed") {
			const str = await localizeForUser(msgAuthor, "EMBEDME_INFO");
			return msg.channel.send(`:information_source: ${str}`);
		}

		let embedContent = msg.content.slice("!embed ".length);

		if (embedContent.startsWith("`") && embedContent.endsWith("`")) {
			embedContent = embedContent.slice(1).substring(0, embedContent.length - 2);
		}

		await msg.channel.send("", {
			embed: {
				author: {
					icon_url: msg.author.avatarURL({ format: "webp", size: 128 }),
					name: getUserDisplayName(msgAuthor)
				},
				description: embedContent,
				timestamp: msg.createdAt,
				footer: {
					icon_url: $discordBot.user.displayAvatarURL({ format: "webp", size: 128 }),
					text: await localizeForUser(msgAuthor, "EMBEDME_EMBED", {
						botName: $discordBot.user.username
					})
				}
			},
		});

		if (msg.channel.type === "text") { await msg.delete(); }
	}

	public async unload() {
		this.unhandleEvents();
		return true;
	}
}

module.exports = EmbedME;
