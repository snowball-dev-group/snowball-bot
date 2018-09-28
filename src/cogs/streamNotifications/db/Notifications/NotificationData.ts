import { SharedSubscriptionData, fulfillmentCheck as subFulfillmentCheck } from "./Subscriptions/SubscriptionData";
import { TableBuilder } from "knex";
import { MissingPropertyError } from "./SubscriptionBasedController";

export type NotificationData = SharedSubscriptionData & {
	readonly messageId: string;
	streamId?: string;
	platformPayload?: string;
};

export function addNotificationColumns(tableBuilder: TableBuilder) {
	tableBuilder.string("messageId").notNullable();
	tableBuilder.string("streamId").nullable();
	tableBuilder.string("platformPayload").nullable();
}

export function fulfillmentCheck(data: Partial<NotificationData>) : data is NotificationData {
	if (!data.messageId) {
		throw new MissingPropertyError<NotificationData>("streamerId");
	}

	if (!subFulfillmentCheck(data)) {
		return false;
	}

	return true;
}

export default NotificationData;
