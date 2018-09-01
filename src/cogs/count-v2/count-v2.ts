import { IModule } from "@sb-types/ModuleLoader/Interfaces";
import { Plugin } from "../plugin";
import { Message, TextChannel, GuildMember } from "discord.js";
import { getDB } from "@utils/db";
import { generateEmbed, EmbedType } from "@utils/utils";
import * as knex from "knex";
import * as Random from "random-js";
import * as getLogger from "loggy";

enum DBInitializationState {
	NotInitialized = 2,
	MainTableInitialized = 4,
	ScoreboardInitialized = 6,
	FullyInitialized = NotInitialized | MainTableInitialized | ScoreboardInitialized
}

const enum XPOperation {
	DoNotChange = 0,
	Raise = 1,
	Lower = 2
}

interface ICountOperationRow {
	count: number;
	author: string;
	date: number;
	operation: "-" | "+";
	number: string;
	/**
	 * JSON
	 */
	answered_by: string;
	in_queue: string;
}

interface IScoreboardUserRow {
	user: string;
	exp: number;
	streak: number;
}

interface IScoreboardUserUpdateInfo {
	user: string;
	addition: number;
	xp: number;
	streak: number;
	member: GuildMember;
	operation: XPOperation;
}

const TABLENAME_MAIN = "countv2";
const TABLENAME_SCOREBOARD = `${TABLENAME_MAIN}_scoreboard`;
const CHANNELID_MAIN = "302128461600784384";
const CHANNELID_SCOREBOARD = "302129535913164803";
const POINTS_GAIN = 2;
const POINTS_RAISED = 1;
const POINTS_LOWERED = 2;

const STRINGS = {
	TOP_10: "🏆 Топ-10",
	LATEST_CHANGES: "📈 Последние изменения",
	LOADING: "**Загрузка...**"
};


class CountV2 extends Plugin implements IModule {
	public get signature() {
		return "dafri.interactive.count-v2";
	}

	private static readonly _countRegex = /^\d{0,}$/i;
	private readonly _log = getLogger("CountV2Channel");
	private readonly _db: knex;
	private _dbInitialized: DBInitializationState = DBInitializationState.NotInitialized;
	private readonly _scoreboardMessages: {
		top10?: Message,
		latestChanges?: Message
	} = {
		top10: undefined,
		latestChanges: undefined
	};
	// private _latestScoreboardUpdate = new Date();

	constructor() {
		super({
			"message": (msg: Message) => this._onMessage(msg)
		});
		this._db = getDB();

		this._db.schema.hasTable(TABLENAME_MAIN).then(itHas => {
			if (itHas) {
				this._log("ok", `DB: we have table '${TABLENAME_MAIN}', can safely continue work...`);
				this._dbInitialized = this._dbInitialized | DBInitializationState.MainTableInitialized;

				return;
			}
			this._log("warn", `DB: seems we doesn't have table '${TABLENAME_MAIN}' in database, going to create it right now`);
			this._db.schema.createTable(TABLENAME_MAIN, (tb) => {
				tb.integer("count").notNullable();
				tb.string("author").notNullable();
				tb.string("date").notNullable();
				tb.string("operation").notNullable();
				tb.string("number").notNullable(); // next number
				tb.string("answered_by").notNullable();
				tb.string("in_queue").notNullable().defaultTo("-1");
			}).catch(err => {
				this._log("err", "DB: we can't prepare DB", err);
			}).then(() => {
				this._log("ok", "DB: we successfully prepared our DB and checking for existing elements");
				// this.dbInitialized = this.dbInitialized | DBInitializationState.MainTableInitialized;
				this._db(TABLENAME_MAIN).first().then((elem) => {
					if (!elem) {
						this._firstTimeBoot();
					}
				});
			});
		});

		this._db.schema.hasTable(TABLENAME_SCOREBOARD).then(itHas => {
			if (itHas) {
				this._log("ok", `DB: we have table '${TABLENAME_SCOREBOARD}', can safely continue working with players scores`);
				this._dbInitialized = this._dbInitialized | DBInitializationState.ScoreboardInitialized;

				return;
			}
			this._log("warn", `DB: seems we don't have table '${TABLENAME_SCOREBOARD}' in database, going to create it right now`);
			this._db.schema.createTable(TABLENAME_SCOREBOARD, (tb) => {
				tb.string("user").notNullable();
				tb.integer("exp").notNullable();
				tb.integer("streak").notNullable();
			}).catch(err => {
				this._log("err", "DB: we can't prepare DB", err);
			}).then(() => {
				this._log("ok", "DB: we successfully prepared our scoreboard table");
				this._dbInitialized = this._dbInitialized | DBInitializationState.ScoreboardInitialized;
			});
		});

		let runs = 0;

		const cid: NodeJS.Timer = setInterval(() => {
			runs++;
			if (this._dbInitialized === DBInitializationState.FullyInitialized) {
				this._log("ok", "DB is initialized");
				clearInterval(cid);
			} else {
				if (runs >= 10) {
					clearInterval(cid);
					this._log("err", "Timeout: waiting for DB initialization");
				}

				return;
			}
			this._log("info", "Updating scoreboard messages");
			this._updateScoreboardMessages();
		}, 1000);
	}

	private async _firstTimeBoot() {
		const elem = {
			date: Date.now(),
			count: 1322,
			number: 1337,
			author: $botConfig.botOwner,
			operation: "+"
		};

		let ch: TextChannel | null = null;

		if (!(ch = <TextChannel | null> $discordBot.channels.get(CHANNELID_MAIN))) {
			return false;
		}

		try {
			await this._db(TABLENAME_MAIN).insert(elem);
		} catch (err) {
			this._log("err", "First start: Can't but element into database", err);
		}

		ch.send("**Первый запуск!**\n__Число__: 1322.\n__Далее__: **+15**");

		return true;
	}

	private async _onMessage(msg: Message) {
		if (this._dbInitialized !== DBInitializationState.FullyInitialized) { return undefined; }
		if (msg.channel.type === "dm") { return undefined; } // never reply in direct messages
		if (msg.channel.id !== CHANNELID_MAIN) { return undefined; }

		if (!msg.author || !msg.content) {
			await msg.delete();

			return undefined;
		}

		if (msg.author.id === $discordBot.user.id) { return undefined; }

		const override = msg.content.startsWith("!");
		if (!CountV2._countRegex.test(override ? msg.content.slice(1) : msg.content)) { return msg.delete(); }

		if (override && msg.author.id === $botConfig.botOwner) {
			await msg.react("⏳");
			const nNumber = parseInt(msg.content.slice("!".length), 10);
			try {
				await this._db(TABLENAME_MAIN).insert({
					date: Date.now(),
					count: nNumber,
					number: nNumber,
					author: msg.author.id,
					operation: "+",
					answered_by: "[]",
					in_queue: "-1"
				});
				msg.react("✅");

				return msg.channel.send("✅ Перезапись числа завершена. Теперь введите это число.");
			} catch (err) {
				await msg.react("❌");
				await msg.channel.send(`❌ Ошибка перезаписи числа: \`${err.message}\`.`);
				this._log("err", "Can't insert new number into database", err);
			}

			return;
		} else if (override) {
			return msg.delete();
		}

		const nNumber = parseInt(msg.content, 10);

		let latestRow: ICountOperationRow | undefined = undefined;
		try {
			latestRow = await this._db(TABLENAME_MAIN).orderBy("date", "DESC").first("count", "author", "date", "operation", "number", "answered_by", "in_queue");
		} catch (err) {
			this._log("err", "Can't get latest row from database", err);
			latestRow = undefined;
		}

		if (!latestRow) { return undefined; }

		const rRowNumber = parseInt(latestRow.number, 10);
		const rRowQueueTime = parseInt(latestRow.in_queue, 10);

		let rRowAnsweredBy: string[] | undefined;

		if (latestRow.answered_by !== "null") {
			try {
				rRowAnsweredBy = JSON.parse(latestRow.answered_by);
			} catch (err) {
				this._log("err", "Can't parse latest row `answered_by` column");

				return undefined;
			}
		} else {
			rRowAnsweredBy = [];
		}

		if (!rRowAnsweredBy) {
			this._log("err", "No value for `rRowAnsweredBy` variable, returning...");

			return;
		}

		let messageDeleted = false;

		const secondsSinceTimerAdded = (Date.now() - rRowQueueTime) / 1000;

		const answerTimeOK = rRowQueueTime === -1 ? true : secondsSinceTimerAdded < 10;

		const alreadyAnswered = rRowAnsweredBy.includes(msg.author.id);

		if (alreadyAnswered && answerTimeOK) {
			return msg.delete();
		} else if (!alreadyAnswered) {
			rRowAnsweredBy.push(msg.author.id);
			latestRow.answered_by = JSON.stringify(rRowAnsweredBy);
		}

		if (!answerTimeOK) {
			messageDeleted = true;

			return msg.delete();
		} else {
			const qTime = answerTimeOK && rRowQueueTime !== -1 ? 10000 - (Date.now() - rRowQueueTime) : 10000;

			if (nNumber !== rRowNumber) {
				setTimeout(async () => {
					const r = await this._giveXP(msg.member, XPOperation.Lower);
					await msg.react("❌");
					if (r) { this._updateScoreboardMessages(r); }
				}, qTime);
			} else {
				setTimeout(async () => {
					const r = await this._giveXP(msg.member, XPOperation.Raise);
					await msg.react("✅");
					if (r) { this._updateScoreboardMessages(r); }
				}, qTime);
			}
		}

		let t: NodeJS.Timer | undefined = undefined;
		if (rRowQueueTime === -1 || (secondsSinceTimerAdded > 15)) { // more than 15 seconds, timer died?
			const deadTimer = (rRowQueueTime !== -1 && (secondsSinceTimerAdded > 15));
			t = setTimeout(async () => {
				const random = new Random(Random.engines.mt19937().autoSeed());

				const operation = random.pick(["+", "-", "+", "+", "+", "-", "+", "-", "-", "+"]);

				let nextNumber = rRowNumber;
				const diffNumber = random.integer(1, 50);

				nextNumber += operation === "+" ? diffNumber : -Math.abs(diffNumber);

				try {
					await this._db(TABLENAME_MAIN).insert({
						date: Date.now(),
						count: rRowNumber,
						number: nextNumber,
						author: msg.author.id,
						operation,
						answered_by: "[]",
						in_queue: "-1"
					});
				} catch (err) {
					this._log("err", "Can't put element into database", err);
					msg.channel.send(":frowning: К сожалению, возникли проблемы с базой данных.");

					return;
				}

				if (!deadTimer) {
					msg.channel.send(`✅ **Ответы приняты**. Правильное число: **${rRowNumber}**. Далее: **${operation}** ${diffNumber}`);
				} else {
					msg.channel.send(`😱 **Ой!** Я случайно заснул... Извиняюсь. Итак, на чем мы остановились?\n*Внимательно читает историю чисел* Ах, вот! Было число **${rRowNumber}**. Далее.. (хмммм) Вот же, чего это я... Далее: **${operation}** ${diffNumber}`);
				}

			}, deadTimer ? 500 : 10000);
			latestRow.in_queue = `${Date.now()}`;
		}

		try {
			await this._db(TABLENAME_MAIN).where({
				date: latestRow.date,
				number: latestRow.number
			}).update(latestRow);
			if (!messageDeleted) {
				msg.react("👁");
			}
		} catch (err) {
			this._log("err", "Can't update element in database");
			if (t) {
				this._log("err", "Timer should not be called, clearing...");
				clearTimeout(t);
			}

			return undefined;
		}
	}

	private async _giveXP(member: GuildMember, xpOperation: XPOperation): Promise<IScoreboardUserUpdateInfo | undefined> {
		let userRow: IScoreboardUserRow | undefined = undefined;

		try {
			userRow = await this._db(TABLENAME_SCOREBOARD).where({
				user: member.id
			}).first("user", "exp", "streak");
		} catch (err) {
			this._log("warn", "Can't poll user out'a DB", err);
			userRow = undefined;
		}

		if (!userRow) {
			userRow = {
				user: member.id,
				exp: 0,
				streak: 0
			};
			try {
				await this._db(TABLENAME_SCOREBOARD).insert(userRow);
			} catch (err) {
				this._log("err", "Can't insert new user row to database", err);

				return undefined;
			}
		}

		if (!userRow) {
			return undefined;
		}

		if (xpOperation === XPOperation.DoNotChange) {
			return {
				user: userRow.user,
				addition: 0,
				xp: userRow.exp,
				streak: userRow.streak,
				member: member,
				operation: xpOperation
			};
		} else {
			if (userRow.streak < 0 && xpOperation === XPOperation.Raise) {
				userRow.streak = -1;
			} else if (userRow.streak > 4 && xpOperation === XPOperation.Lower) {
				userRow.streak -= 4;
			} else if (userRow.streak > 0 && userRow.streak < 5 && xpOperation === XPOperation.Lower) {
				userRow.streak = 1;
			}

			userRow.streak += (xpOperation === XPOperation.Lower ? -1 : 1);

			let pointsGain = Math.max(Math.min(userRow.streak * POINTS_GAIN, 20), -20);

			userRow.exp += xpOperation === XPOperation.Lower ? -Math.abs(POINTS_LOWERED) : POINTS_RAISED;

			if ((userRow.streak > 0 && xpOperation === XPOperation.Raise) || (userRow.streak < 0 && xpOperation === XPOperation.Lower)) {
				userRow.exp += pointsGain;
			} else { pointsGain = 0; }

			try {
				await this._db(TABLENAME_SCOREBOARD).where({
					user: userRow.user
				}).update(userRow);
			} catch (err) {
				this._log("err", "Can't update element in database", err);

				return undefined;
			}

			return {
				user: userRow.user,
				addition: pointsGain,
				xp: userRow.exp,
				streak: userRow.streak,
				member: member,
				operation: xpOperation
			};
		}
	}

	private async _newScoreboardMessage() {
		if (!$discordBot.channels.has(CHANNELID_SCOREBOARD)) {
			throw new Error("Scoreboard channel not found");
		}
		const ch = <TextChannel> $discordBot.channels.get(CHANNELID_SCOREBOARD);

		const messages = await ch.messages.fetch();
		for (const message of messages.values()) {
			if (message.embeds.length === 0 && message.author.id !== $botConfig.botOwner) {
				message.delete();
				continue;
			}
			const puprose = message.embeds[0].footer.text;
			switch (puprose) {
				case STRINGS.TOP_10: {
					this._scoreboardMessages.top10 = message;
				} break;
				case STRINGS.LATEST_CHANGES: {
					this._scoreboardMessages.latestChanges = message;
				} break;
				default: break;
			}
		}

		if (!this._scoreboardMessages.top10) {
			const msg = <Message> await ch.send({
				embed: generateEmbed(EmbedType.Empty, STRINGS.LOADING, {
					footerText: STRINGS.TOP_10
				})
			});
			this._scoreboardMessages.top10 = msg;
		}

		if (this._scoreboardMessages.latestChanges) { return; }

		const msg = <Message> await ch.send({
			embed: generateEmbed(EmbedType.Empty, STRINGS.LOADING, {
				footerText: STRINGS.LATEST_CHANGES
			})
		});

		this._scoreboardMessages.latestChanges = msg;
	}

	private async _updateScoreboardMessages(playerUpdate?: IScoreboardUserUpdateInfo) {
		if (!this._scoreboardMessages.latestChanges || !this._scoreboardMessages.top10) {
			try {
				this._log("info", "Probably cache was purged or plugin just started working, fetching messages from channel...");
				await this._newScoreboardMessage();
			} catch (err) {
				this._log("err", "Can't update scoreboard messages, can't update scoreboard.", err);

				return;
			}
		}

		if (this._scoreboardMessages.latestChanges && playerUpdate) {
			const lines = this._scoreboardMessages.latestChanges.embeds[0].description.split("\n").filter(l => l !== STRINGS.LOADING);
			if (lines.length === 10) {
				lines.splice(0, 1); // adding one line
			}

			// sorry, sorry... i'm sorry: 
			// https://hydra-media.cursecdn.com/overwatch.gamepedia.com/e/e4/Mei_-_Sorry%2C_Sorry%2C_I%27m_Sorry_Sorry.mp3
			const newLine = `${playerUpdate.operation === XPOperation.Lower ? "🔻" : "🔺"} \`${playerUpdate.member.displayName}\`: ${playerUpdate.operation === XPOperation.Lower ? -Math.abs(POINTS_LOWERED) : `+${POINTS_RAISED}` } | ${playerUpdate.xp} ${playerUpdate.streak !== 0 ? `(**${playerUpdate.addition > 0 ? `+${playerUpdate.addition}` : playerUpdate.addition}** - ${playerUpdate.streak > 0 ? "бонус за правильные ответы" : "штраф за неправильные ответы"})` : ""}`;

			lines.push(newLine);

			const embed: any = {};
			embed.description = lines.join("\n");
			embed.footer = { text: STRINGS.LATEST_CHANGES };

			await this._scoreboardMessages.latestChanges.edit("", {
				embed: embed
			});
		}

		if (!this._scoreboardMessages.top10) { return; } 

		let top10: IScoreboardUserRow[];
		try {
			top10 = await this._db(TABLENAME_SCOREBOARD).orderBy("exp", "DESC").limit(15);
		} catch (err) {
			this._log("err", "Can't get top 10 from database!", err);

			return;
		}

		const lines: string[] = [];
		let pos = 0;
		for (const row of top10) {
			if (row.exp < 10) { continue; }
			if (pos >= 10) { continue; }

			const member = this._scoreboardMessages.top10.guild.members.get(row.user);
			if (!member) { continue; }

			pos++;

			let str = pos === 1 ? "🥇" : pos === 2 ? "🥈" : pos === 3 ? "🥉" : `**${pos}.**`;
			str += ` \`${member.displayName}\`**-** ${row.exp} очков`;
			lines.push(str);
		}

		const embed: any = {};
		embed.description = lines.join("\n");
		embed.footer = { text: STRINGS.TOP_10 };

		await this._scoreboardMessages.top10.edit("", {
			embed: embed
		});
	}

	public async unload() {
		this.unhandleEvents();

		return true;
	}
}

module.exports = CountV2;
