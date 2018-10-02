import { TableBuilder } from "knex";
import { MissingPropertyError, ValueError } from "../SubscriptionBasedController";
import { canBeSnowflake } from "@utils/text";

export type MatureStreamBehavior = "Nothing" | "Ignore" | "Banner";

const MATURE_BEHAVIOR_VALUES: MatureStreamBehavior[] = [
	"Nothing",
	"Ignore",
	"Banner"
];

export type GuildSettingsData = {
	/**
	 * Where notifications will be sent
	 */
	readonly guildId: string;
	/**
	 * Behavior when sending notification about the mature stream
	 */
	matureBehavior?: MatureStreamBehavior;
	/**
	 * Discord ID of the default channel for the notifications
	 */
	defaultChannelId: string;
};

export function addGuildSettingsColumns(tableBuilder: TableBuilder) {
	tableBuilder.string("guildId").notNullable();
	tableBuilder
		.enum(
			"matureBehavior",
			["Nothing", "Banner", "Ignore"]
		)
		.nullable();
}

export function fulfillmentCheck(data: Partial<GuildSettingsData>): data is GuildSettingsData {
	type D = GuildSettingsData;

	const { guildId } = data;

	if (!guildId) {
		throw new MissingPropertyError<D>("guildId");
	}

	if (!canBeSnowflake(guildId)) {
		throw new ValueError<D>(
			"guildId",
			"must be a valid guild ID"
		);
	}

	const { matureBehavior } = data;

	if (matureBehavior != null) {
		if (!MATURE_BEHAVIOR_VALUES.includes(matureBehavior)) {
			throw new ValueError<D>(
				"matureBehavior",
				`"${matureBehavior}" is not valid value, valid values are ${MATURE_BEHAVIOR_VALUES.join("/")}`
			);
		}
	}

	return true;
}
