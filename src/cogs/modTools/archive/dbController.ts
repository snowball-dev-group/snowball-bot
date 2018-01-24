import { getDB } from "../../utils/db";
import { getLogger } from "../../utils/utils";
import { Message, MessageAttachment, MessageEmbed } from "discord.js";

const DEFAULT_TABLE_NAME = "messages";
const ERRORS = {
	INIT_NOT_COMPLETE: new Error("Initialization is not complete. Please call `#init` before using controller's functions. This will ensure that database is created and controller is able to manipulate required data"),
	EMPTY_FILTER: new Error("The current passed filter is empty. You must set at lease one property, otherwise results will be always null"),
	INVALID_LIMIT_PASSED: new Error("Invalid `limit` has passed. It's lower than 1. Valid values are >1."),
	INVALID_OFFSET_PASSED: new Error("Invalid `offset` has passed. It's lower than zero. Valid values are >0.")
};

let totalInstances = 0;

export class ArchiveDBController {
	private readonly _tableName: string = DEFAULT_TABLE_NAME;
	private readonly _db = getDB();
	private _initComplete = false;
	private readonly _log = getLogger(`ArchiveDBController:${++totalInstances}`);

	constructor(tableName: string = DEFAULT_TABLE_NAME) {
		this._tableName = tableName;
	}

	/**
	 * Checks if required table is created
	 * If not, creates it using default schema
	 */
	public async init() {
		const tbStatus = await this._db.schema.hasTable(this._tableName);
		if(!tbStatus) {
			this._log("info", "[init] Table not found, creating started");

			await this._db.schema.createTable(this._tableName, (tb) => {
				tb.string("guildId").nullable();
				tb.string("channelId").notNullable();
				tb.string("messageId").notNullable();
				tb.string("authorId").nullable();
				tb.string("content", 4000); // i'm bad at math
				tb.string("other", 10000);  // lol
			});

			this._log("info", `[init] Table '${this._tableName}' successfully created.`);
		}

		this._initComplete = true;
		this._log("ok", "[init] Initialization complete");
	}

	/**
	 * Inserts IDBMessage into the table
	 * @param msg {IDBMessage} Message to insert into the database
	 */
	public async insertMessage(msg: IDBMessage): Promise<IDBMessage> {
		if(!this._initComplete) { throw ERRORS.INIT_NOT_COMPLETE; }
		return this._db(this._tableName).insert(msg, "*");
	}

	/**
	 * Searches for selected messages by passed filter
	 * @param filter {IDBSearchFilter} The search filter. Must contain at least one selector
	 * @param filter.guildId {string|string[]} Selector by Guild ID(s)
	 * @param filter.userId {string|string[]} Selector by User ID(s)
	 * @param filter.channelId {string|string[]} Selector by Channel ID(s)
	 * @param filter.messageId {string|string[]} Selector by Message ID(s)
	 */
	public async search(filter: IDBSearchFilter, limit = 50, offset = 0): Promise<IDBMessage[]> {
		if(!this._initComplete) { throw ERRORS.INIT_NOT_COMPLETE; }
		if(!FILTER_PROPERTIES.find(prop => !isNullOrEmptyArray(filter[prop]))) {
			throw ERRORS.EMPTY_FILTER;
		}
		if(limit < 1) {
			throw ERRORS.INVALID_LIMIT_PASSED;
		} else if(offset < 0) {
			throw ERRORS.INVALID_OFFSET_PASSED;
		}
		let req = this._db(this._tableName).select("*");
		if(filter.messageId) {
			req = Array.isArray(filter.messageId) ? req.where("messageId", "in", filter.messageId) : req.where("messageId", filter.messageId);
		}
		if(filter.guildId) {
			req = Array.isArray(filter.guildId) ? req.where("guildId", "in", filter.guildId) : req.where("guildId", filter.guildId);
		}
		if(filter.channelId) {
			req = Array.isArray(filter.channelId) ? req.where("channelId", "in", filter.channelId) : req.where("channelId", filter.channelId);
		}
		if(filter.authorId) {
			req = Array.isArray(filter.authorId) ? req.where("authorId", "in", filter.authorId) : req.where("authorId", filter.authorId);
		}
		req = req.limit(limit).orderBy("messageId", "desc");
		if(offset > 0) {
			req = req.offset(offset);
		}
		return req;
	}

	/**
	 * Gets first message selected by specified ID as is
	 * @param messageId {string} Discord Message ID
	 */
	public async getMessage(messageId: string): Promise<IDBMessage> {
		return this._db(this._tableName).first("*").where("messageId", messageId);
	}
}

// ======================
// PUBLIC FUNCTIONS
// ======================

export function convertAttachment(attachment: MessageAttachment) : IEmulatedAttachment {
	return {
		id: attachment.id,
		file: {
			url: attachment.url,
			name: attachment.name
		}
	};
}

export function convertEmbed(embed: MessageEmbed) : IEmulatedEmbed {
	return {
		author: embed.author ? {
			name: embed.author.name,
			url: embed.author.url,
			icon_url: embed.author.iconURL
		} : undefined,
		title: embed.title,
		description: embed.description,
		fields: (embed.fields && embed.fields.length > 0) ? embed.fields.map((f) => {
			return {
				inline: f.inline,
				name: f.name,
				value: f.value
			};
		}) : undefined,
		footer: embed.footer ? {
			text: embed.footer.text,
			icon_url: embed.footer.iconURL
		} : undefined,
		color: embed.color,
		thumbnail: embed.thumbnail ? {
			height: embed.thumbnail.height,
			width: embed.thumbnail.width,
			url: embed.thumbnail.url
		} : undefined,
		image: embed.image ? {
			width: embed.image.width,
			height: embed.image.height,
			url: embed.image.url
		} : undefined,
		video: embed.video ? {
			width: embed.video.url,
			height: embed.video.height,
			url: embed.video.url
		} : undefined,
		url: embed.url,
		provider: embed.provider ? {
			name: embed.provider.name,
			url: embed.provider.url
		} : undefined,
		timestamp: embed.timestamp
	};
}

export function convertToDBMessage(msg: Message): IDBMessage {
	return {
		guildId: msg.guild ? msg.guild.id : undefined,
		channelId: msg.channel.id,
		messageId: msg.id,
		authorId: msg.author ? msg.author.id : msg.system ? "system" : msg.member ? msg.member.id : "unknown",
		content: msg.content,
		other: (msg.attachments.size > 0 || msg.embeds.length > 0) ? JSON.stringify(<IEmulatedContents>{
			attachments: msg.attachments.size > 0 ? msg.attachments.map(convertAttachment) : undefined,
			embeds: msg.embeds.length > 0 ? msg.embeds.filter(e => e.type === "rich").map(convertEmbed) : undefined
		}) : null
	};
}

// ======================
// PRIVATE FUNCTIONS
// ======================

function isNullOrEmptyArray<T>(obj?: T | T[]) {
	return typeof obj === "undefined" || obj === null || (Array.isArray(obj) && obj.length === 0);
}

// ======================
// INTERFACES
// ======================

export interface IDBMessage {
	guildId?: string;
	channelId: string;
	messageId: string;
	authorId: string;
	content: string;
	other?: string | null;
}

export interface IDBSearchFilter {
	guildId?: string | string[];
	authorId?: string | string[];
	channelId?: string | string[];
	messageId?: string | string[];
}

// filter extension
const FILTER_PROPERTIES = (<Array<"guildId" | "authorId" | "channelId" | "messageId">>["guildId", "authorId", "channelId", "messageId"]);

export interface IEmulatedAttachment {
    id: string;
    file: {
        url: string;
        name: string;
    };
}

export interface IEmulatedEmbed {
    author?: {
        name?: string;
        url?: string;
        icon_url?: string;
    };
    title?: string;
    description?: string;
    fields?: boolean | Array<{
        inline?: boolean;
        name: string;
        value: string;
    }>;
    footer?: {
        text?: string;
        icon_url?: string;
    };
    color?: number;
    thumbnail?: {
        height?: number;
        width?: number;
        url: string;
    };
    image?: {
        width?: number;
        height?: number;
        url: string;
    };
    video?: {
        width?: string;
        height?: number;
        url?: string;
    };
    url: string;
    provider?: {
        name: string;
        url: string;
    };
    timestamp?: number;
}

export interface IEmulatedContents {
	attachments: IEmulatedAttachment[];
	embeds: IEmulatedEmbed[];
}
