import { TableBuilder } from "knex";
import { MissingPropertyError, ValueError } from "../SubscriptionBasedController";
import { canBeSnowflake } from "@utils/text";

export type SharedSubscriptionData = {
	/**
	 * Guild ID or "user_sub"
	 */
	readonly guildId: string | "user_sub";
	/**
	 * Alternative Channel ID for notifications or User ID
	 */
	readonly alternativeChannel?: string;
	/**
	 * Platform of the streams
	 */
	readonly platform: string;
	/**
	 * Streamer ID for the platform
	 */
	readonly streamerId: string;
};

export type SubscriptionData = SharedSubscriptionData & {
	/**
	 * Display name for the streamer set by platform
	 */
	displayName?: string;
};

export function addSharedSubscriptionColumns(tableBuilder: TableBuilder) {
	tableBuilder.string("guildId").notNullable();
	tableBuilder.string("alternativeChannel").nullable();
	tableBuilder.string("platform").notNullable();
	tableBuilder.string("streamerId").notNullable();
}

export function addSubscriptionColumns(tableBuilder: TableBuilder) {
	addSharedSubscriptionColumns(tableBuilder);

	tableBuilder.string("displayName").nullable();
}

export function getSelection(data: SharedSubscriptionData) {
	const {
		guildId,
		alternativeChannel,
		platform,
		streamerId
	} = data;

	return {
		guildId,
		alternativeChannel,
		platform,
		streamerId
	};
}

export function fulfillmentCheck(data: Partial<SharedSubscriptionData>) : data is SharedSubscriptionData {
	type D = SharedSubscriptionData;

	if (!data.platform) {
		throw new MissingPropertyError<D>("platform");
	}

	if (!data.streamerId) {
		throw new MissingPropertyError<D>("streamerId");
	}

	const { guildId, alternativeChannel } = data;

	if (!guildId) {
		throw new MissingPropertyError<D>("guildId");
	} else if (guildId === "user_sub" && !alternativeChannel) {
		throw new MissingPropertyError<D>("alternativeChannel");
	}

	if (!canBeSnowflake(guildId)) {
		throw new ValueError<D>(
			"guildId",
			"guild ID must be valid Snowflake"
		);
	}

	if (alternativeChannel) {
		if (!canBeSnowflake(alternativeChannel)) {
			throw new ValueError<D>(
				"alternativeChannel",
				"for user subscription `alternativeChannel` must be their ID"
			);
		}
	}

	return true;
}

export default SharedSubscriptionData;
