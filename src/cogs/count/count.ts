import { IModule } from "../../types/ModuleLoader";
import { Plugin } from "../plugin";
import { Message, TextChannel } from "discord.js";
import { getDB } from "../utils/db";
import { convertNumbers } from "../utils/letters";
import { getMessageMember, resolveEmojiMap } from "@cogs/utils/utils";
import { localizeForGuild, extendAndBind } from "@cogs/utils/ez-i18n";
import * as logger from "loggy";

const DEFAULT_TABLE_NAME = "count";
const DEFAULT_COOLDOWN = 180; // seconds
const DEFAULT_EMOJI: ICountEmoji = {
	channelTopicError: "raw:\u26A0", // :warning:
	channelTopicLatestNumber: "raw:\uD83D\uDDD2", // :notepad_spiral:
	reactionError: "raw:\u274C" // :x:
};

interface ICountOptions {
	tableName?: string;
	channelId: string;
	userCooldown?: number;
	emoji?: ICountEmoji;
}

export default class Count extends Plugin implements IModule {
	public get signature() {
		return `dafri.interactive.count{${this._channelId}}`;
	}

	private static readonly _countRegex = /^\d{0,}$/i;
	private readonly _log: Function = logger("CountChannel");
	private readonly _db = getDB();
	private readonly _tableName: string;
	private readonly _channelId: string;
	private readonly _emoji: ICountEmoji;
	private readonly _cooldown: number;
	private _pruneI18nFunc: () => string[];

	constructor(options?: ICountOptions) {
		super({
			"message": (msg: Message) => this._onMessage(msg)
		}, true);

		if (!options) {
			throw new Error("No options have been found. Options are required to use this plugin");
		}

		if (!options.channelId) {
			throw new Error("No `channelId` have been found set in options. `channelId` is required to use this plugin");
		}

		this._channelId = options.channelId;

		const _tableName = options.tableName;
		if (_tableName) {
			this._log(`Using "${_tableName}" as table name`);
			this._tableName = _tableName;
		} else {
			this._log(`No table name set. Using default value ("${DEFAULT_TABLE_NAME}")`);
		}

		if (options.emoji) {
			this._emoji = { ...DEFAULT_EMOJI, ...options.emoji };
		} else {
			this._emoji = { ...DEFAULT_EMOJI };
		}

		this._cooldown = options.userCooldown != null ? options.userCooldown : DEFAULT_COOLDOWN;

		this._emoji = <any> resolveEmojiMap(<any> this._emoji, $discordBot.emojis);
	}

	public async init() {
		if (!$modLoader.isPendingInitialization(this.signature)) {
			throw new Error("This module doesn't pending initialization");
		}

		const _channelId = this._channelId;

		this._log("info", `[init] Searching for channel with ID "${_channelId}"`);

		const channel = $discordBot.channels.get(_channelId);

		if (!channel) {
			throw new Error(`Channel with ID "${_channelId}" haven't been found`);
		} else if (channel.type !== "text") {
			throw new Error(`Channel with ID "${_channelId}" has type ${channel.type}, only "text" channels could be used with this plugin`);
		}

		const _tableName = this._tableName;

		this._log("info", "[init] Preparing the table");

		const isTableReady = await this._db.schema.hasTable(_tableName);
		if (!isTableReady) {
			this._log("warn", `[init] We don't have table "${_tableName}" in the database. Creating the table...`);

			await this._db.schema.createTable(_tableName, (tb) => {
				tb.integer("count").notNullable();
				tb.string("author").notNullable();
				tb.string("date").notNullable();
			});

			this._log("ok", "[init] Table was successfully created");
		}

		this._log("info", "[init] Extending locales and binding ownership...");

		this._pruneI18nFunc = await extendAndBind(
			[__dirname, "i18n"],
			this.signature
		);

		this._log("info", "[init] Handling the events...");

		this.handleEvents();
	}

	private async _onMessage(msg: Message) {
		if (msg.channel.id !== this._channelId) { return; }

		const member = await getMessageMember(msg);
		if (!member) { return; }

		if (msg.channel.type !== "text") { return; }

		if (!msg.content) { return msg.delete(); }

		const isOverride = msg.content.startsWith("!");

		if (!Count._countRegex.test(isOverride ? msg.content.slice(1) : msg.content)) {
			return msg.delete();
		}

		if (isOverride) {
			if (member.id === $botConfig.botOwner) {
				const mNumber = parseInt(msg.content.slice(1), 10);

				if (isNaN(mNumber)) {
					return msg.delete();
				}
		
				await this._db("count").insert({
					author: member.id,
					count: mNumber,
					date: `${Date.now()}`
				});

				return;
			} else {
				return msg.delete();
			}
		}

		const row = await this._db("count").orderBy("count", "DESC").first();

		if (!row) {
			return this._log("err", "Not found element");
		}

		const rowDate = parseInt(row.date, 10);

		if (row.author === member.id && ((Date.now() - rowDate) / 1000) < this._cooldown) {
			return msg.delete();
		}

		const newNumber = parseInt(msg.content, 10);
		if (isNaN(newNumber)) {
			return msg.delete();
		}

		if ((row.count + 1) !== newNumber) {
			return msg.delete();
		}

		try {
			await this._db("count").insert({
				author: member.id,
				count: newNumber,
				date: `${Date.now()}`
			});
		} catch (err) {
			this._log("err", "Can't push number to DB", err);
			try {
				await msg.react(this._emoji.reactionError);
				await (<TextChannel> msg.channel).edit({
					topic: await localizeForGuild(
						msg.guild, 
						"COUNT_TOPIC_DBERROR", {
							emoji: this._emoji.channelTopicError
						}
					)
				});
				this._log("ok", "Successfully written error message to description and reacted to message");
			} catch (err) {
				this._log("err", "Cannot react to message or edit description of channel: ", err);
			}
		}

		try {
			await (<TextChannel> msg.channel).edit({
				topic: await localizeForGuild(
					msg.guild,
					"COUNT_TOPIC_LATEST", {
						numbers: convertNumbers(newNumber),
						emoji: this._emoji.channelTopicLatestNumber
					}
				)
			});
		} catch (err) {
			this._log("err", "Can't change description of channel", err);
		}

		if (row.author !== msg.client.user.id && Math.floor(Math.random() * 6) > 4) {
			return msg.channel.send((newNumber + 1).toString());
		}
	}

	public async unload() {
		if (!$modLoader.isPendingUnload(this.signature)) {
			throw new Error("This module doesn't pending unload");
		}

		this._log("[unload] Unhandling all the events...");

		this.unhandleEvents();

		this._log("[unload] Events are unhandled, pruning locales");

		this._pruneI18nFunc();

		return true;
	}
}

interface ICountEmoji {
	channelTopicError: string;
	channelTopicLatestNumber: string;
	reactionError: string;
}
