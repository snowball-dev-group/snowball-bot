import { IModule } from "@sb-types/ModuleLoader/Interfaces";
import { Plugin } from "../plugin";
import { Message } from "discord.js";
import { generateHelpContent, command } from "@utils/help";
import { EmbedType } from "@utils/utils";
import { generateLocalizedEmbed } from "@utils/ez-i18n";
import { messageToExtra } from "@utils/failToDetail";

@command("HELPFUL", "sb_help", "loc:HELPFULCMD_CMDMETA_DESCRIPTION")
class HelpfulCommand extends Plugin implements IModule {
	public get signature() {
		return "snowball.core_features.helpfulcmd";
	}

	constructor() {
		super({
			"message": (msg: Message) => this._onMessage(msg)
		});
	}

	private async _onMessage(msg: Message) {
		if (msg.content !== "!sb_help") {
			return;
		}

		if (msg.channel.type !== "text" && msg.channel.type !== "dm") {
			return;
		}

		let infoMsg: Message | undefined = undefined;
		if (msg.channel.type !== "dm") {
			infoMsg = <Message> await msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Progress, msg.member, "HELPFULCMD_SENDINGTOPM")
			});
		}

		try {
			const hStr = await generateHelpContent(msg);
			await msg.author.send(hStr, {
				split: true,
				code: "md"
			});
			if (infoMsg) {
				infoMsg = await infoMsg.edit({
					embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, "HELPFULCMD_SENTTOPM")
				});
			}
		} catch (err) {
			if (infoMsg) {
				infoMsg = await infoMsg.edit({
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "HELPFULCMD_ERRSENDING")
				});
			}
			$snowball.captureException(err, { extra: messageToExtra(msg) });
		}

	}

	public async unload() {
		this.unhandleEvents();

		return true;
	}
}

module.exports = HelpfulCommand;
