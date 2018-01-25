import { IModule } from "../../types/ModuleLoader";
import { Plugin } from "../plugin";
import { Message, GuildMember, User } from "discord.js";
import { Context } from "vm";
import { EmbedType, getLogger } from "../utils/utils";
import { generateLocalizedEmbed, localizeForUser, UserIdentify } from "../utils/ez-i18n";
import { replaceAll } from "../utils/text";
import * as util from "util";
import * as VM from "vm";
import * as Bluebird from "bluebird";

const PREFIX = "``";
const PREFIX_LENGTH = PREFIX.length;

class EvalJS extends Plugin implements IModule {
	public get signature() {
		return "snowball.core_features.eval";
	}

	log = getLogger("EvalJS");

	constructor() {
		super({
			"message": (msg: Message) => this.onMessage(msg)
		});
	}

	safeEval(script: string, context: Context) {
		const vmScript = new VM.Script(script);
		const vmContext = VM.createContext(context);
		return vmScript.runInContext(vmContext, {
			timeout: 5000,
			displayErrors: true
		});
	}

	/**
	 * Making our function a bit safe
	 * @param cb Function that will be called
	 */
	makeSafe(cb) {
		return () => {
			try {
				cb();
			} catch(err) {
				this.log("err", "Safe function calling thrown an error", err);
			}
		};
	}

	async onMessage(message: Message) {
		if(!message.author) { return; }
		if(message.author.id !== $botConfig.botOwner) { return; }
		if(!message.content) { return; }

		const i18nTarget = message.member || message.author;

		const usedPrefix = ["!eval", "!e", "!ev"].find(prefix => message.content.startsWith(prefix));
		if(!usedPrefix) { return; }

		const afterCmd = message.content.slice(`${usedPrefix} `.length).trim();
		if(!afterCmd.startsWith(PREFIX) || !afterCmd.endsWith(PREFIX)) { return; }

		// Parsing our script
		const script = afterCmd.substring(PREFIX_LENGTH, afterCmd.length - PREFIX_LENGTH);

		const user = message.member || message.author;

		let resultMsg: Message;
		try {
			resultMsg = await message.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Information, user, "EVAL_EXECUTION_PROGRESS_TEXT", {
						informationTitle: await localizeForUser(i18nTarget, "EVAL_EXECUTION_PROGRESS_TITLE")
				})
			}) as Message;
		} catch(err) {
			this.log("err", "Can't send message with output:", err);
			return;
		}

		let startTime = Date.now();
		let totalExecutionTime = 0;

		try {
			// Trying to run it
			// Actually, it named `safeEval` but it's absolutely not safe
			// For example, if you set timer and throw error there

			const output = this.safeEval(script, {
				...global,
				$bot: $discordBot,
				$msg: message,
				setTimeout: (handler, ms) => setTimeout(this.makeSafe(handler), ms),
				setInterval: (handler, ms) => setInterval(this.makeSafe(handler), ms),
				require: require,
				process: undefined
			});

			// should been avoid this..
			// but, leh it be so
			const isPromise = typeof output === "object" && typeof output.then === "function";

			totalExecutionTime += Date.now() - startTime;

			if(isPromise) {
				await this._outputEdit(resultMsg, user, totalExecutionTime, output, await localizeForUser(i18nTarget, "EVAL_PROMISE_WAITING"), EmbedType.Progress, i18nTarget);
				try {
					startTime = Date.now();

					// nothing bad happens if someone hacky created element using specially made promise-like object
					// it's just waste of time lul
					const resolvedValue = await Bluebird.resolve(output).timeout(5000);

					totalExecutionTime += Date.now() - startTime;

					this._outputEdit(resultMsg, user, totalExecutionTime, resolvedValue, await localizeForUser(i18nTarget, "EVAL_EXECUTION_DONE"), EmbedType.OK, i18nTarget);
				} catch(err) {
					this._outputEdit(resultMsg, user, totalExecutionTime, err, await localizeForUser(i18nTarget, "EVAL_EXECUTION_DONE_ERR"), EmbedType.Warning, i18nTarget);
				}
			} else {
				this._outputEdit(resultMsg, user, totalExecutionTime, output, await localizeForUser(i18nTarget, "EVAL_EXECUTION_DONE"), EmbedType.OK, i18nTarget);
			}
		} catch(err) {
			this._outputEdit(resultMsg, user, totalExecutionTime, err, await localizeForUser(i18nTarget, "EVAL_EXECUTION_FAILED"), EmbedType.Error, i18nTarget);
		}
	}

	async _outputEdit(resultMsg: Message, member: GuildMember | User, totalExecutionTime: number, output: any, text : string, type: EmbedType, i18nTarget: UserIdentify) {
		try {
			const outputInsp = this.outputToString(output);

			await resultMsg.edit(undefined, {
				embed: await generateLocalizedEmbed(type, member, {
					custom: true,
					string: `\`\`\`js\n${outputInsp}\n\`\`\``
				}, {
					fields: [{
						inline: false,
						name: await localizeForUser(i18nTarget, "EVAL_EXECUTION_TIME"),
						value: await localizeForUser(i18nTarget, "EVAL_EXECUTION_TIME_VALUE", {
							time: totalExecutionTime
						})
					}],
					universalTitle: text
				})
			});
		} catch(err) {
			await resultMsg.edit(undefined, {
				embed: await generateLocalizedEmbed(EmbedType.Error, member, "EVAL_EXECUTION_LONGTEXT_DESC", { errorTitle: await localizeForUser(i18nTarget, "EVAL_EXECUTION_LONGTEXT_TITLE") })
			});
			return;
		}
	}

	outputToString(output: any) {
		let depth = 5;
		let outputInsp: string = replaceAll(util.inspect(output, false, depth), "`", "'");
		while(outputInsp.length > 2000 && depth > 0) {
			outputInsp = replaceAll(util.inspect(output, false, --depth), "`", "'");
		}
		if(outputInsp.length > 2000) {
			throw new Error("Large output");
		}
		return outputInsp;
	}

	async unload() {
		this.unhandleEvents();
		return true;
	}
}

module.exports = EvalJS;
