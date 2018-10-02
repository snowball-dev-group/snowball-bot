import StreamingDBController from "./StreamingDBController";
import SharedSubscriptionData from "./Subscriptions/SubscriptionData";

const sharedController = new StreamingDBController("streamNotifications");

const subscription: SharedSubscriptionData = {
	guildId: "user_sub",
	alternativeChannel: "133145125122605057",
	platform: "my_best_streaming_platform",
	streamerId: "1234567980"
};

(async () => {
	const guild = await sharedController.getGuildController("417734993398464513");

	guild.getGuildId(); // "417734993398464513"
	guild.resolveDefaultChannel(); // undefined

	guild.setMatureBehavior("Banner");
	guild.setDefaultChannelId("417735852341592074");

	guild.post();

	await sharedController.subscriptions.createSubscription(subscription);

	// Modifying settings

	const settings = await sharedController.getSettingsController(subscription);

	settings.setMessageText("Heya {everyone}, {username} has started the stream!");

	settings.setPlatformData(
		JSON.stringify({
			displayGame: false
		})
	);

	await settings.post();

	const notifications = await sharedController.getNotificationController(
		subscription
	);

	notifications.isCreated(); // false

	notifications
		.setMessageId("495223776934363136")
		.setPayload(
			JSON.stringify({
				startedAt: Date.now()
			})
		)
		.setStreamId("1234567890");

	notifications.post(); // true
})();
