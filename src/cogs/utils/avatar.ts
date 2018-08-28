import { GuildMember, User, AvatarOptions, Guild } from "discord.js";
import * as getLogger from "loggy";

const LOG = getLogger("Utils:Avatar");

export function getProfilePicture(
	user: GuildMember | User,
	format: ProfilePictureFormat,
	animated: ProfilePictureAnimatedBehavior
) {
	if (user instanceof GuildMember) {
		user = user.user;
	}

	return user.avatarURL(
		createFormatFunction(
			format, animated
		)(user)
	);
}

export function profilePicture(
	format = ProfilePictureFormat.SMALL,
	animated = ProfilePictureAnimatedBehavior.BY_FORMAT
) {
	const createFormat = createFormatFunction(
		format, animated
	);

	return (user: GuildMember | User) => {
		if (user instanceof GuildMember) { user = user.user; }

		return user.avatarURL(
			createFormat(user)
		);
	};
}

export function guildIcon(format = ProfilePictureFormat.SMALL) {
	const predefinedFmt = 
		predefineOptionsByFormat(format);

	return (guild: Guild) => {
		return guild.iconURL(
			predefinedFmt
		);
	};
}

export function hasAnimatedAvatar(user: User) {
	// All animated avatars do start with `a_`
	// at the begining of avatar hash
	return user.avatar.startsWith("a_");
}

function createFormatFunction(format: ProfilePictureFormat, animated: ProfilePictureAnimatedBehavior) {
	switch (animated) {
		case ProfilePictureAnimatedBehavior.NO_ANIMATED:
			return generatorNoAnimated(format);
		case ProfilePictureAnimatedBehavior.LAST_RESORT:
			return generatorLastResort(format);
		case ProfilePictureAnimatedBehavior.PREFER_ANIMATED:
			return generatorPreferAnimated(format);
		case ProfilePictureAnimatedBehavior.BY_FORMAT:
			return generatorByFormat(format);
	}
}

function generatorNoAnimated(format: ProfilePictureFormat) {
	const defaultFormat = predefineOptionsByFormat(format);

	return () => {
		return { ...defaultFormat };
	};
}

function generatorLastResort(format: ProfilePictureFormat) {
	if (format === ProfilePictureFormat.SUPER_HQ_OK_HAND) {
		// We show that warning because the behavior will be the same
		// as it would be with prefer animated, no matter what.
		LOG(
			"warn_trace",
			"Selected \"Super HQ :ok_hand:\" format. " +
			"Fallback to \"Prefer Animated\" behavior..."
		);

		return generatorPreferAnimated(format);
	}

	LOG(
		"warn_trace",
		`Selected "${format.toUpperCase()}" format. ` + 
		"Fallback to \"No animated\" behavior..."
	);

	return generatorNoAnimated(format);
}

function generatorByFormat(format: ProfilePictureFormat) {
	if (
		format === ProfilePictureFormat.SMALL ||
		format === ProfilePictureFormat.TINY
	) {
		LOG(
			"warn_trace",
			`Selected "${format.toUpperCase()}" format. ` +
			"Fallback to \"No animated\" behavior..."
		);

		return generatorNoAnimated(format);
	}

	LOG(
		"warn_trace",
		`Selected "${format.toUpperCase()}" format. ` + 
		"Fallback to \"Prefer animated\" behavior..."
	);

	return generatorPreferAnimated(format);
}

function generatorPreferAnimated(format: ProfilePictureFormat) {
	const defaultOpts = predefineOptionsByFormat(format);

	return (user: User) => {
		const opts = { ...defaultOpts };

		if (hasAnimatedAvatar(user)) {
			opts.format = "gif";
		}

		return opts;
	};
}

function predefineOptionsByFormat(format: ProfilePictureFormat) : AvatarOptions {
	switch (format) {
		case ProfilePictureFormat.TINY:
			return {
				format: "webp",
				size: 128
			};
		case ProfilePictureFormat.SMALL: 
			return {
				format: "jpg",
				size: 256
			};
		case ProfilePictureFormat.MEDIUM:
			return {
				format: "png",
				size: 512
			};
		case ProfilePictureFormat.LARGE:
			return {
				format: "png",
				size: 1024
			};
		case ProfilePictureFormat.SUPER_HQ_OK_HAND:
			return {
				format: "png",
				size: 2048
			};
	}
}

export const enum ProfilePictureFormat {
	TINY = "tiny",
	SMALL = "small",
	MEDIUM = "medium",
	LARGE = "large",
	SUPER_HQ_OK_HAND = "super_hq_ok_hand"
}

export const enum ProfilePictureAnimatedBehavior {
	BY_FORMAT = 0,
	PREFER_ANIMATED = 1,
	LAST_RESORT = 2,
	NO_ANIMATED = 3
}
