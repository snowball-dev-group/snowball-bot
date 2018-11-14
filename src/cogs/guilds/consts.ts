const BANNED_HOSTS = [
	"goo.gl",
	"grabify.link",
	"bit.ly"
];

export function isHostBanned(host: string) {
	if (host.startsWith("www.")) {
		host = host.slice("www.".length);
	}

	return BANNED_HOSTS.includes(host);
}

export const enum GUILD_HELP_KEYS {
	// -- Commands --
	// Join / Leave command
	joinLeaveDesc = "loc:GUILDS_META_JOINLEAVE",
	joinLeaveArg0Desc = "loc:GUILDS_META_JOINLEAVE_ARG0_DESC",
	// Create command
	createDesc = "loc:GUILDS_META_CREATE",
	createArg0Desc = "loc:GUILDS_META_CREATE_ARG0_DESC",
	createArg1 = "loc:GUILDS_META_CREATE_ARG1",
	createArg1Desc = "loc:GUILDS_META_CREATE_ARG1_DESC",
	// Edit command
	editDesc = "loc:GUILDS_META_EDIT",
	editArg0Desc = "loc:GUILDS_META_EDIT_ARG0_DESC",
	editArg1 = "loc:GUILDS_META_EDIT_ARG1",
	editArg1Desc = "loc:GUILDS_META_EDIT_ARG1_DESC",
	editArg2 = "loc:GUILDS_META_EDIT_ARG2",
	editArg2Desc = "loc:GUILDS_META_EDIT_ARG2_DESC",
	// Invite command
	inviteDesc = "loc:GUILDS_META_INVITE",
	inviteArg0Desc = "loc:GUILDS_META_INVITE_ARG0_DESC",
	inviteArg1 = "loc:GUILDS_META_INVITE_ARG1",
	inviteArg1Desc = "loc:GUILDS_META_INVITE_ARG1_DESC",
	inviteArg2 = "loc:GUILDS_META_INVITE_ARG2",
	inviteArg2Desc = "loc:GUILDS_META_INVITE_ARG2_DESC",
	// Delete command
	deleteDesc = "loc:GUILDS_META_DELETE",
	deleteArg0Desc = "loc:GUILDS_META_DELETE_ARG0_DESC",
	// List command
	listDesc = "loc:GUILDS_META_LIST",
	listArg0 = "loc:GUILDS_META_LIST_ARG0",
	listArg0Desc = "loc:GUILDS_META_LIST_ARG0_DESC",
	// Info command
	infoDesc = "loc:GUILDS_META_INFO",
	infoArg0Desc = "loc:GUILDS_META_INFO_ARG0_DESC",
	// -- Shared metas --
	guildNameArg = "loc:GUILDS_META_GUILDNAME"
}

export const enum SHARDING_MESSAGE_TYPE {
	BASE_PREFIX = "guilds:",
	RULES_ACCEPTED = "guilds:rules:accept",
	RULES_REJECTED = "guilds:rules:reject",
	PENDING_INVITE_CLEAR = "guilds:rules:pending_clear",
	PENDING_INVITE_CREATE = "guilds:rules:pending"
}

export const EDITABLE_PARAMS = [
	"image",
	"description",
	"rules",
	"welcome_msg_channel",
	"welcome_msg",
	"icon",
	"owner",
	"private",
	"invite_only",
	"invite_only_msg",
	"add_admin",
	"add_adm",
	"remove_admin",
	"rm_admin",
	"delete_admin",
	"add_emoji"
];

export const RESERVER_GUILD_NAMES = [
	"create",
	"edit",
	"invite",
	"delete",
	"list",
	"info"
];

export const GUILDS_PER_PAGE = 10;
