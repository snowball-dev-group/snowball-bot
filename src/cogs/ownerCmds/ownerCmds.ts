import { IModule } from "@sb-types/ModuleLoader/Interfaces";
import { Plugin } from "../plugin";
import { Message } from "discord.js";
import { generateLocalizedEmbed } from "@utils/ez-i18n";
import { EmbedType, escapeDiscordMarkdown, getMessageMemberOrAuthor } from "@utils/utils";
import { default as fetch } from "node-fetch";
import { parse, commandRedirect } from "@utils/command";
import * as logger from "loggy";

class OwnerCommands extends Plugin implements IModule {
	public get signature() {
		return "snowball.core_features.ownercmds";
	}

	private readonly _log: Function = logger("OwnerCMDs");

	constructor() {
		super({
			"message": (msg: Message) => this._onMessage(msg)
		});
	}

	private async _onMessage(msg: Message) {
		if (!msg.author) { return; }
		if (msg.author.id !== $botConfig.botOwner) { return; }

		const caller = await getMessageMemberOrAuthor(msg);

		if (!caller) { return; }

		const parsed = parse(msg.content);

		return commandRedirect(parsed, {
			"!change_name": async () => {
				try {
					const oldName = $discordBot.user.username;
					const newUser = await $discordBot.user.setUsername(
						parsed.content
					);
					await msg.react("✅");

					return msg.channel.send({
						embed: await generateLocalizedEmbed(
							EmbedType.OK, caller, {
								key: "OWNERCMDS_CHANGENAME_DONE",
								formatOptions: {
									oldName: escapeDiscordMarkdown(oldName, true),
									newName: escapeDiscordMarkdown(newUser.username, true)
								}
							})
					});
				} catch (err) {
					await msg.react("🚫");

					return msg.channel.send({
						embed: await generateLocalizedEmbed(
							EmbedType.Error, caller, {
								key: "OWNERCMDS_CHANGENAME_FAULT",
								formatOptions: {
									errMessage: err.message
								}
							})
					});
				}
			},
			"!change_pfp": async () => {
				try {
					const attachment = msg.attachments.first();

					if (!attachment) {
						return msg.channel.send({
							embed: await generateLocalizedEmbed(
								EmbedType.Error,
								caller,
								"OWNERCMDS_CHANGEAVY_NOATTACHMENT"
							)
						});
					}

					const resp = await fetch(attachment.url);

					if (resp.status !== 200) {
						return msg.channel.send({
							embed: await generateLocalizedEmbed(
								EmbedType.Progress, caller,
								"OWNERCMDS_CHANGEAVY_FAULT_RESPERR"
							)
						});
					}

					try {
						const newUser = await $discordBot.user.setAvatar(await resp.buffer());

						return msg.channel.send({
							embed: await generateLocalizedEmbed(
								EmbedType.OK, caller, "OWNERCMDS_CHANGEAVY_DONE", {
									imageUrl: newUser.displayAvatarURL({ format: "png", size: 1024 })
								}
							)
						});
					} catch (err) {
						return msg.channel.send({
							embed: await generateLocalizedEmbed(
								EmbedType.Error, caller, {
									key: "OWNERCMDS_CHANGEAVY_FAULT_SETFAILED",
									formatOptions: {
										errMessage: err.message
									}
								})
						});
					}
				} catch (err) {
					this._log("err", "Error changing/downloading profile picture");

					return msg.channel.send({
						embed: await generateLocalizedEmbed(
							EmbedType.Error, caller, {
								key: "OWNERCMDS_CHANGEAVY_FAULT_REQERROR",
								formatOptions: {
									errMsg: err.message
								}
							})
					});
				}
			}
		});
	}

	public async unload() {
		if (!$modLoader.isPendingUnload(this.signature)) {
			throw new Error("This module is not pending unload");
		}

		this.unhandleEvents();

		return true;
	}
}

module.exports = OwnerCommands;
