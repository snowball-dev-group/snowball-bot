import * as createLogger from "loggy";
import { Guild, GuildMember } from "discord.js";
import { replaceAll } from "./text";

export function stringifyError(err, filter = null, space = 2) {
	const plainObject = {};
	for(const key of Object.getOwnPropertyNames(err)) {
		plainObject[key] = err[key];
	}
	return JSON.stringify(plainObject, filter, space);
}

export function colorNumberToHex(color) {
	let hex = color.toString(16);
	while(hex.length < 6) { hex = `0${hex}`; }
	return `${hex}`.toUpperCase();
}

export function objectToMap<T>(obj) {
	const map = new Map<string, T>();
	for(const key of Object.keys(obj)) {
		map.set(key, obj[key]);
	}
	return map;
}

export function commandRedirect(content: string, redirects: Map<string, Function>) {
	for(const [key, val] of redirects) {
		const keySpaced = `${key} `;
		const itsStarts = content.startsWith(keySpaced);
		if(itsStarts || content === key) {
			val(itsStarts ? content.slice(keySpaced.length) : content);
		}
	}
}

export function escapeDiscordMarkdown(str: string, usernames: boolean = false) {
	str = replaceAll(str, "`", "'");
	str = replaceAll(str, "*", "\\*");
	str = replaceAll(str, "[", "\\[");
	str = replaceAll(str, "]", "\\]");

	if(usernames) {
		str = replaceAll(str, "_", "\\_");
	} else {
		str = replaceAll(str, " _", " \\_");
		str = replaceAll(str, "_ ", "\\_ ");
	}
	return str;
}

export enum EmbedType {
	Error,
	OK,
	Information,
	Progress,
	Empty,
	Tada,
	Question,
	Warning
}
// customFooter?:string

export interface IEmbedOptionsField {
	name: string;
	value: string;
	inline?: boolean;
}

export interface IEmbedOptions {
	/**
	 * Text to show in footer
	 */
	footerText?: string;
	/**
	 * Footer options
	 * Overrides `footerText` option
	 */
	footer?: {
		/**
		 * Text to show in footer
		 */
		text: string;
		/**
		 * Icon to show in footer
		 */
		icon_url?: string;
	};
	/**
	 * Color of embed border
	 */
	color?: number;
	/**
	 * Author to show in embed
	 * Replaces `author` provided by selected `EmbedType`
	 */
	author?: {
		/**
		 * Author's name
		 */
		name: string,
		/**
		 * Author's icon URL
		 */
		icon_url?: string;
		/**
		 * Author's URL
		 */
		url?: string;
	};
	/**
	 * Fields in embed
	 */
	fields?: IEmbedOptionsField[];
	/**
	 * Title to show on top of message
	 */
	title?: string;
	/**
	 * If `type` is ` 0`, replaces default "Error" string with this
	 */
	errorTitle?: string;
	/**
	 * If `type` is `1`, replaces default "Success!" string with this
	 */
	okTitle?: string;
	/**
	 * If `type` is `2`, replaces default "Information" string with this
	 */
	informationTitle?: string;
	/**
	 * If `type` is `5`, replaces default "Tada!" string with this
	 */
	tadaTitle?: string;
	/**
	 * If `type` is `3`, replaces default "Loading..." string with this
	 */
	progressTitle?: string;
	/**
	 * If `type` is `6`, replaces default "Confirmation..." string with this
	 */
	questionTitle?: string;
	/**
	 * If `type` is `7`, replaces default "Warning!" string with this
	 */
	warningTitle?: string;
	/**
	 * Replaces default string of any type of embeds with this
	 */
	universalTitle?: string;
	/**
	 * URL of image to show in embed
	 */
	imageUrl?: string;
	/**
	 * Removes footer in embed
	 * Useful while footer provided by selected `EmbedType` doesn't fit your needs :pray:
	 */
	clearFooter?: boolean;
	/**
	 * URL of thumbnail to show in embed
	 */
	thumbUrl?: string;
	/**
	 * Thumbnail's width
	 */
	thumbWidth?: number;
	/**
	 * Thumbnail's height
	 */
	thumbHeight?: number;
	/**
	 * Timestamp
	 */
	ts?: Date;
}

export interface IEmbed {
	title?: string;
	description?: string;
	url?: string;
	timestamp?: string | number;
	color?: number;
	footer?: {
		text: string;
		icon_url?: string;
	};
	image?: {
		url: string;
		height?: number;
		width?: number;
	};
	thumbnail?: {
		url: string;
		height?: number;
		width?: number;
	};
	video?: {
		url: string;
		height?: number;
		width?: number;
	};
	provider?: {
		name: string;
		url?: string;
	};
	author?: {
		icon_url?: string;
		name: string;
		url?: string;
	};
	fields?: IEmbedOptionsField[];
}

export const ICONS = {
	ERROR: "https://i.imgur.com/9IwsjHS.png",
	INFO: "https://i.imgur.com/cztrSSi.png",
	OK: "https://i.imgur.com/FcnCpHL.png",
	PROGRESS: "https://i.imgur.com/Lb04Jg0.gif",
	CONFIRMATION: "https://i.imgur.com/CFzVpVt.png",
	WARNING: "https://i.imgur.com/Lhq89ac.png",
	TADA: "https://i.imgur.com/EkYEqfC.png"
};

export const COLORS = {
	ERROR: 0xe53935,
	INFO: 0x2196F3,
	OK: 0x43A047,
	PROGRESS: 0x546E7A,
	CONFIRMATION: 0x4DB6AC,
	WARNING: 0xFF9800
};

export function generateEmbed(type: EmbedType, description: string, options?: IEmbedOptions) {
	let embed: any = {};
	// embed pre-fill 
	embed.author = {};
	embed.description = description;
	switch(type) {
		case EmbedType.Error: {
			embed.author.name = "Error";
			embed.author.icon_url = ICONS.ERROR;
			embed.color = COLORS.ERROR;
		} break;
		case EmbedType.Information: {
			embed.author.name = "Information";
			embed.author.icon_url = ICONS.INFO;
			embed.color = COLORS.INFO;
		} break;
		case EmbedType.OK: {
			embed.author.name = "Success!";
			embed.author.icon_url = ICONS.OK;
			embed.color = COLORS.OK;
		} break;
		case EmbedType.Tada: {
			embed.author.name = "Tada!";
			embed.author.icon_url = ICONS.OK;
			embed.thumbnail = {
				url: ICONS.TADA
			};
			embed.color = COLORS.OK;
		} break;
		case EmbedType.Progress: {
			embed.author.name = "Loading...";
			embed.author.icon_url = ICONS.PROGRESS;
			embed.color = COLORS.PROGRESS;
		} break;
		case EmbedType.Question: {
			embed.author.name = "Confirmation...";
			embed.author.icon_url = ICONS.CONFIRMATION;
			embed.color = COLORS.CONFIRMATION;
		} break;
		case EmbedType.Warning: {
			embed.author.name = "Warning!";
			embed.author.icon_url = ICONS.WARNING;
			embed.thumbnail = {
				url: ICONS.WARNING
			};
			embed.colors = COLORS.WARNING;
		} break;
		case EmbedType.Empty: break;
	}
	if(options) {
		if(options.title) {
			embed.title = options.title;
		}
		if(options.fields) {
			embed.fields = options.fields;
		}
		// that's fine
		if(type === EmbedType.Error && options.errorTitle) {
			embed.author.name = options.errorTitle;
		} else if(type === EmbedType.Information && options.informationTitle) {
			embed.author.name = options.informationTitle;
		} else if(type === EmbedType.OK && options.okTitle) {
			embed.author.name = options.okTitle;
		} else if(type === EmbedType.Tada && options.tadaTitle) {
			embed.author.name = options.tadaTitle;
		} else if(type === EmbedType.Progress && options.progressTitle) {
			embed.author.name = options.progressTitle;
		} else if(type === EmbedType.Question && options.questionTitle) {
			embed.author.name = options.questionTitle;
		} else if(type === EmbedType.Warning && options.warningTitle) {
			embed.author.name = options.warningTitle;
		}
		if(options.universalTitle && embed.author) {
			embed.author.name = options.universalTitle;
		}
		if(options.author) {
			// full override
			embed.author = options.author;
		}
		if(options.footer) {
			embed.footer = options.footer;
			if(options.footerText) {
				embed.footer.text = options.footerText;
			}
		} else if(options.footerText) {
			embed.footer = {
				text: options.footerText
			};
		} else {
			if(type !== EmbedType.Empty) {
				embed.footer = {
					text: $discordBot.user.username,
					icon_url: $discordBot.user.displayAvatarURL
				};
			}
		}
		if(options.clearFooter) {
			embed.footer = undefined;
		}
		if(options.imageUrl) {
			embed.image = {
				url: options.imageUrl
			};
		}
		if(options.thumbUrl) {
			embed.thumbnail = {
				url: options.thumbUrl
			};
			if(options.thumbWidth && options.thumbWidth > 0) {
				embed.thumbnail.width = options.thumbWidth;
			}
			if(options.thumbHeight && options.thumbHeight > 0) {
				embed.thumbnail.height = options.thumbHeight;
			}
		}
		if(options.color) {
			embed.color = options.color;
		}
		if(options.ts) {
			embed.timestamp = options.ts.toISOString();
		}
	}
	return embed;
}

export interface ILoggerFunction {
	(type: "log" | "info" | "ok" | "warn" | "err" | "error" | "warning" | "trace" | "info_trace" | "warn_trace" | "err_trace", arg, ...args: any[]): ILogger;
}

export interface ILogger {
	name: string;
	log: ILoggerFunction;
}

export function getLogger(name: string): ILoggerFunction {
	if(!name) { throw new Error("No logger name provided"); }
	return createLogger(name);
}

export function resolveGuildRole(nameOrID: string, guild: Guild, strict = true) {
	if(/[0-9]+/.test(nameOrID)) {
		// it's can be ID
		const role = guild.roles.get(nameOrID);
		if(role) { return role; }
	}
	// going to search
	return guild.roles.find((role) => {
		if(strict) { return role.name === nameOrID; }
		else { return role.name.includes(nameOrID); }
	}); // it can return undefined, it's okay
}

export function resolveGuildChannel(nameOrID: string, guild: Guild, strict = true) {
	if(/[0-9]+/.test(nameOrID)) {
		const ch = guild.channels.get(nameOrID);
		if(ch) { return ch; }
	}

	return guild.channels.find((vc) => {
		if(strict) { return vc.name === nameOrID; }
		else { return vc.name.includes(nameOrID); }
	});
}

const caseSwitch = (str: string, sw: boolean) => {
	return sw ? str.toLowerCase() : str;
};

export async function resolveGuildMember(nameOrID: string, guild: Guild, strict = false, caseStrict = false) : Promise<GuildMember|undefined> {
	if(/[0-9]+/.test(nameOrID)) {
		const member = await (async () => {
			try {
				return await guild.fetchMember(nameOrID);
			} catch (err) {
				return undefined;
			}
		})();
		if(member) { return member; }
	}

	// doing some quick conversations
	caseStrict = !caseStrict;
	nameOrID = caseSwitch(nameOrID, caseStrict);

	// tag parts
	const tagParts = nameOrID.includes("#") ? (nameOrID.startsWith("@") ? nameOrID.slice(1) : nameOrID).split("#") : undefined;

	if(tagParts) {
		if(tagParts.length !== 2) {
			throw new Error(`Invalid tag given. Expected "username#discrim", got ${tagParts.length} unknown parts.`);
		} else if(/[0-9]{4}/.test(tagParts[1])) {
			throw new Error("Invalid discrim given.");
		} else if(tagParts[0].includes("@")) {
			throw new Error("Invalid username given.");
		}
	}

	return guild.members.find((member) => {
		if(tagParts) { // tag strict equality check
			const splitdtag = caseSwitch(member.user.tag, caseStrict).split("#");
			if(splitdtag.length !== 2) { return false; } // invalid tag skip

			return (splitdtag[1] === tagParts[1]) && // tag check
				(strict ? ( // strict check
					splitdtag[0] === tagParts[0]
				) : ( // non-strict check
					tagParts[0].length === 0 ? true : splitdtag[0].includes(tagParts[0])
				));
		}

		const nickname = member.nickname ? caseSwitch(member.nickname, caseStrict) : undefined;
		const username = caseSwitch(member.user.username, caseStrict);

		if(strict) {
			return (nickname && nickname === nameOrID) || username === nameOrID;
		} else {
			return (nickname && nickname.includes(nameOrID)) || username.includes(nameOrID);
		}
	});
}

export function sleep<T>(delay: number = 1000, value?: T): Promise<T> {
	return new Promise<T>((resolve) => {
		setTimeout(() => {
			resolve(value);
		}, delay);
	});
}