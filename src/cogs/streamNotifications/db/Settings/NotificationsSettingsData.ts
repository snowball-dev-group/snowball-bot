import { SharedSubscriptionData, fulfillmentCheck as subFulfillmentCheck } from "@cogs/streamNotifications/db/Subscriptions/SubscriptionData";
import { TableBuilder } from "knex";

export type NotificationsSettingsData = SharedSubscriptionData & {
	/**
	 * Text for the message with embed
	 */
	messageText?: string | null;
	/**
	 * The platform data
	 */
	platformData?: string | null;
};

export function addNotificationSettingsColumns(tableBuilder: TableBuilder) {
	tableBuilder.string("messageText").nullable();
	tableBuilder.string("platformData").nullable();
}

export function fulfillmentCheck(data: Partial<NotificationsSettingsData>) : data is NotificationsSettingsData {
	return subFulfillmentCheck(data);
}

export default NotificationsSettingsData;
