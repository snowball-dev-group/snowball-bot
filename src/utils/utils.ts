import { Guild, GuildMember, GuildEmojiStore, Message, DiscordAPIError, User } from "discord.js";
import { replaceAll } from "@utils/text";
import { INullableHashMap } from "@sb-types/Types";
import * as getLogger from "loggy";

export function stringifyError(err: Error, filter = null, space = 2) {
	const plainObject = {};
	for (const key of Object.getOwnPropertyNames(err)) {
		plainObject[key] = err[key];
	}

	return JSON.stringify(plainObject, filter, space);
}

export function colorNumberToHex(color) {
	let hex = color.toString(16);
	while (hex.length < 6) { hex = `0${hex}`; }

	return `${hex}`.toUpperCase();
}

export function objectToMap<T>(obj) {
	const map = new Map<string, T>();
	for (const key of Object.keys(obj)) {
		map.set(key, obj[key]);
	}

	return map;
}

export function escapeDiscordMarkdown(str: string, usernames: boolean = false) {
	str = replaceAll(str, "`", "'");
	str = replaceAll(str, "*", "\\*");
	str = replaceAll(str, "[", "\\[");
	str = replaceAll(str, "]", "\\]");

	if (usernames) {
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
	ERROR: "https://i.imgur.com/tNDFOYI.png",
	INFO: "https://i.imgur.com/AUIYOy6.png",
	OK: "https://i.imgur.com/MX3EPo8.png",
	PROGRESS: "https://i.imgur.com/Lb04Jg0.gif",
	CONFIRMATION: "https://i.imgur.com/lujOhUw.png",
	WARNING: "https://i.imgur.com/Ga60TCT.png",
	TADA: "https://i.imgur.com/ijm8BHV.png"
};

export const enum COLORS {
	ERROR = 0xDD2E44,
	INFO = 0x3B88C3,
	OK = 0x77B255,
	PROGRESS = 0x546E7A,
	CONFIRMATION = 0x3B88C3,
	WARNING = 0xFFCC4D
}

export function generateEmbed(type: EmbedType, description: string | undefined, options?: IEmbedOptions) {
	const embed: any = {};

	// embed pre-fill 
	embed.author = {};
	embed.description = description;

	switch (type) {
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

	if (options) {
		if (options.title) {
			embed.title = options.title;
		}

		if (options.fields) {
			embed.fields = options.fields;
		}

		// this is fine
		// https://media.giphy.com/media/3o6UBpHgaXFDNAuttm/giphy.gif

		if (type === EmbedType.Error && options.errorTitle) {
			embed.author.name = options.errorTitle;
		} else if (type === EmbedType.Information && options.informationTitle) {
			embed.author.name = options.informationTitle;
		} else if (type === EmbedType.OK && options.okTitle) {
			embed.author.name = options.okTitle;
		} else if (type === EmbedType.Tada && options.tadaTitle) {
			embed.author.name = options.tadaTitle;
		} else if (type === EmbedType.Progress && options.progressTitle) {
			embed.author.name = options.progressTitle;
		} else if (type === EmbedType.Question && options.questionTitle) {
			embed.author.name = options.questionTitle;
		} else if (type === EmbedType.Warning && options.warningTitle) {
			embed.author.name = options.warningTitle;
		}

		if (options.universalTitle && embed.author) {
			embed.author.name = options.universalTitle;
		}

		if (options.author) {
			// full override
			embed.author = options.author;
		}

		if (options.footer) {
			embed.footer = options.footer;
			if (options.footerText) {
				embed.footer.text = options.footerText;
			}
		} else if (options.footerText) {
			embed.footer = {
				text: options.footerText
			};
		} else if (type !== EmbedType.Empty) {
			embed.footer = {
				text: $discordBot.user.username,
				icon_url: $discordBot.user.displayAvatarURL({ format: "webp", size: 128 })
			};
		}

		if (options.clearFooter) {
			embed.footer = undefined;
		}

		if (options.imageUrl) {
			embed.image = {
				url: options.imageUrl
			};
		}

		if (options.thumbUrl) {
			embed.thumbnail = {
				url: options.thumbUrl
			};
			if (options.thumbWidth && options.thumbWidth > 0) {
				embed.thumbnail.width = options.thumbWidth;
			}
			if (options.thumbHeight && options.thumbHeight > 0) {
				embed.thumbnail.height = options.thumbHeight;
			}
		}

		if (options.color) {
			embed.color = options.color;
		}

		if (options.ts) {
			embed.timestamp = options.ts.toISOString();
		}
	}

	return embed;
}

/**
 * Default options for resolving
 */
interface IResolveOptions {
	/**
	 * Should name strictly equal to search
	 */
	strict: boolean;
	/**
	 * Is search case-sensetive
	 */
	caseStrict: boolean;
}

const DEFAULT_ROLE_RESOLVE_OPTIONS: IResolveOptions = {
	strict: true,
	caseStrict: false
};

export const SNOWFLAKE_REGEXP = /^[0-9]{16,20}$/;

export function resolveGuildRole(nameOrId: string, guild: Guild, options: Partial<IResolveOptions>) {
	if (SNOWFLAKE_REGEXP.test(nameOrId)) {
		// can be ID
		const role = guild.roles.get(nameOrId);
		if (role) { return role; }
	}

	const {
		strict,
		caseStrict
	} = {
		...DEFAULT_ROLE_RESOLVE_OPTIONS,
		...options
	};

	if (!caseStrict) {
		nameOrId = nameOrId.toLowerCase();
	}

	const roles = guild.roles.array();

	// going to search
	for (let i = 0, l = roles.length; i < l; i++) {
		const role = roles[i];
		const roleName = (caseStrict ? role.name : role.name.toLowerCase());

		if (strict) {
			if (roleName === nameOrId) {
				return role;
			}

			continue;
		}

		if (roleName.includes(nameOrId)) {
			return role;
		}
	}

	return undefined;
}

type ChannelType = "text" | "voice" | "category";

/**
 * Options for channel resolving
 */
interface IGuildChannelResolveOptions extends IResolveOptions {
	/**
	 * Can search contain channel mention to parse
	 */
	possibleMention: boolean;
	/**
	 * Which channel types to match
	 */
	types: ChannelType[];
}

const DEFAULT_CHANNEL_RESOLVE_OPTIONS: IGuildChannelResolveOptions = {
	strict: true,
	caseStrict: false,
	possibleMention: false,
	types: ["text", "voice"]
};

const CHANNEL_MENTION_SNOWFLAKE = /^\<\#([0-9]{16,20})\>$/;

export function resolveGuildChannel(nameOrID: string, guild: Guild, options: Partial<IGuildChannelResolveOptions>) {
	const {
		strict,
		caseStrict,
		possibleMention,
		types
	} = {
		...DEFAULT_CHANNEL_RESOLVE_OPTIONS,
		...options
	};

	if (possibleMention) {
		const res = CHANNEL_MENTION_SNOWFLAKE.exec(nameOrID);
		if (res && res[1]) {
			const channel = guild.channels.get(res[1]);
			if (channel) { return channel; }
		}
	}

	if (SNOWFLAKE_REGEXP.test(nameOrID)) {
		const ch = guild.channels.get(nameOrID);
		if (ch) { return ch; }
	}

	if (!caseStrict) {
		nameOrID = nameOrID.toLowerCase();
	}

	const channels = guild.channels.array();

	for (let i = 0, l = channels.length; i < l; i++) {
		const channel = channels[i];

		if (!types.includes(<any> channel.type)) { continue; }

		const channelName = caseStrict ? channel.name : channel.name.toLowerCase();

		if (strict) {
			if (channelName === nameOrID) {
				return channel;
			}

			continue;
		}

		if (channelName.includes(nameOrID)) {
			return channel;
		}
	}

	return undefined;
}

const USER_MENTION_SNOWFLAKE = /^\<\@\!?([0-9]{16,20})\>$/;

/**
 * It's not actually that safe, just returns undefined on error
 * @param guild Guild from where member comes
 * @param id ID of member
 * @param errCallback Callback to call on error
 */
export async function safeMemberFetch(guild: Guild, id: string, errCallback?: (err) => void) {
	try {
		return guild.members.get(id) || await guild.members.fetch(id);
	} catch (err) {
		if (errCallback) { errCallback(err); }

		return undefined;
	}
}

/**
 * Options for member resolving
 */
interface IGuildMemberResolveOptions extends IResolveOptions {
	/**
	 * Can search contain user mention to parse
	 */
	possibleMention: boolean;
	/**
	 * Fetch members list before the search?
	 */
	fetch: boolean;
}

const DEFAULT_MEMBER_RESOLVE_OPTIONS: IGuildMemberResolveOptions = {
	strict: false,
	caseStrict: false,
	possibleMention: false,
	fetch: false
};

export async function resolveGuildMember(nameOrID: string, guild: Guild, options: Partial<IGuildMemberResolveOptions>): Promise<GuildMember | undefined> {
	const {
		strict,
		caseStrict,
		possibleMention,
		fetch
	} = {
		...DEFAULT_MEMBER_RESOLVE_OPTIONS,
		...options
	};

	if (possibleMention) {
		const res = USER_MENTION_SNOWFLAKE.exec(nameOrID);
		if (res && res[1]) {
			const member = await safeMemberFetch(guild, res[1]);
			if (member) { return member; }
		}
	}

	if (SNOWFLAKE_REGEXP.test(nameOrID)) {
		const member = safeMemberFetch(guild, nameOrID);
		if (member) { return member; }
	}

	if (!caseStrict) {
		nameOrID = nameOrID.toLowerCase();
	}

	let tagParts_discrim: undefined | string = undefined;
	let tagParts_username: undefined | string = undefined;

	// tag parts
	let isTag = false;

	{
		const hashIndex = nameOrID.lastIndexOf("#");
		if (hashIndex !== -1) {
			const username = nameOrID.slice(0, hashIndex).replace(/\@/g, "");
			if (username.length > 0) { tagParts_username = username; }
			tagParts_discrim = nameOrID.slice(hashIndex + 1);
			isTag = true;
		}
	}

	const membersArray = fetch ? (await guild.members.fetch()).array() : guild.members.array();

	for (let i = 0, l = membersArray.length; i < l; i++) {
		const member = membersArray[i];
		const username = caseStrict ? member.user.username : member.user.username.toLowerCase();

		if (isTag) { // tag strict equality check
			if (tagParts_discrim !== member.user.discriminator) {
				continue;
			}

			if (tagParts_username) {
				if (strict && username !== tagParts_username) {
					continue;
				} else if (username.indexOf(tagParts_username) === -1) {
					continue;
				}
			}

			return member;
		}

		const nickname = member.nickname ? (caseStrict ? member.nickname : member.nickname.toLowerCase()) : undefined;

		switch (strict) {
			case true: {
				if ((nickname && nickname === nameOrID) || username === nameOrID) {
					return member;
				}
			} break;
			case false: {
				if ((nickname && (nickname.indexOf(nameOrID) !== -1)) || (username.indexOf(nameOrID) !== -1)) {
					return member;
				}
			} break;
		}
	}

	return undefined;
}


export function getUserDisplayName(user: GuildMember | User, includeTag = false, includeAt = false) : string {
	let displayName: string;

	if (user instanceof GuildMember) {
		displayName = user.displayName;
		if (includeTag) {
			displayName += `#${user.user.tag}`;
		}
	} else {
		displayName = user.username;
		if (includeTag) {
			displayName += `#${user.tag}`;
		}
	}

	if (includeAt) {
		displayName = `@${displayName}`;
	}

	return displayName;
}

export function sleep<T>(delay: number = 1000, value?: T): Promise<T> {
	return new Promise<T>((resolve) => {
		setTimeout(() => {
			resolve(value);
		}, delay);
	});
}

export function resolveEmojiMap(emojis: INullableHashMap<string>, store: GuildEmojiStore, strict = true): INullableHashMap<string> {
	const resolvedEmojisMap = Object.create(null);
	for (const emojiKey in emojis) {
		const emojiId = emojis[emojiKey]!;

		// raw cases
		if (emojiId.startsWith("raw:")) {
			resolvedEmojisMap[emojiKey] = emojiId.slice(3); // 3 - length
			continue;
		}

		if (!SNOWFLAKE_REGEXP.test(emojiId)) {
			if (strict) {
				throw new Error(`Invalid Emoji ID provided by key "${emojiKey}" - "${emojiId}"`);
			}
			continue;
		}

		const resolvedEmoji = store.get(emojiId);

		if (strict && !resolvedEmoji) {
			throw new Error(`Emoji with ID "${emojiId}" by key "${emojiKey}" not found`);
		}

		resolvedEmojisMap[emojiKey] = resolvedEmoji ? resolvedEmoji.toString() : null;
	}

	return resolvedEmojisMap;
}

const MESSAGES_LOG = getLogger("Utils:Utils#getMessageMember");

export async function getMessageMember(msg: Message): Promise<GuildMember | undefined> {
	if (msg.channel.type !== "text") { return undefined; }
	if (msg.webhookID) { return undefined; } // webhooks

	let member = msg.member;

	if (!member) {
		if (msg.author) {
			MESSAGES_LOG("warn", `Detected uncached member with ID "${msg.author.id}", trying to fetch them...`);
			try {
				member = await msg.guild.members.fetch(msg.author);
			} catch (err) {
				if (err instanceof DiscordAPIError) {
					switch (err.code) {
						case 10007: 
							MESSAGES_LOG("err", `User with ID "${msg.author.id}" is not member of the server`);
						case 10013: 
							MESSAGES_LOG("err", `User with ID "${msg.author.id}" is not real Discord user`);
					}

					return undefined;
				}

				MESSAGES_LOG("err", "Unknown error while fetching", err);

				return undefined;
			}
			MESSAGES_LOG("ok", `Found member with ID "${msg.author.id}"`);
		} else { return undefined; }
	}

	return member;
}

export async function getMessageMemberOrAuthor(msg: Message): Promise<GuildMember | User | undefined> {
	if (msg.channel.type !== "text") { return msg.author; }
	else if (msg.webhookID) { return undefined; }

	return getMessageMember(msg);
}
