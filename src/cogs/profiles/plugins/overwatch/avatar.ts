import { IProfilesPlugin, AddedProfilePluginType } from "../plugin";
import { Message, GuildMember } from "discord.js";
import { generateEmbed, EmbedType } from "../../../utils/utils";
import { IRegionalProfile } from "./owApiInterfaces";
import { getProfile, IOverwatchProfilePluginInfo } from "./overwatch";
import { localizeForUser } from "../../../utils/ez-i18n";
import { DetailedError } from "../../../../types/Types";
import * as getLogger from "loggy";

const ACCEPTED_REGIONS = ["eu", "kr", "us"];
const ACCEPTED_PLATFORMS = ["pc", "xbl", "psn"];
const LOG = getLogger("OWImagePlugin");

export class ImageProfilePlugin implements IProfilesPlugin {
	public get signature() {
		return "snowball.features.profile.plugins.overwatch.avatar";
	}

	async getSetupArgs(caller: GuildMember) {
		return localizeForUser(caller, "OWPROFILEPLUGIN_DEFAULT_ARGS");
	}

	async setup(str: string, member: GuildMember, msg: Message) {
		let status = await localizeForUser(member, "OWPROFILEPLUGIN_LOADING");

		let statusMsg = <Message> await msg.channel.send("", {
			embed: generateEmbed(EmbedType.Progress, status)
		});

		const postStatus = async () => {
			statusMsg = await statusMsg.edit("", {
				embed: generateEmbed(EmbedType.Progress, `${statusMsg.content}\n${status}`)
			});
		};

		const args = str.split(";").map(arg => arg.trim());

		if (args.length === 0) {
			await statusMsg.edit("", {
				embed: generateEmbed(EmbedType.Error, await localizeForUser(member, "OWPROFILEPLUGIN_ERR_ARGS"))
			});
			throw new Error("Invalid argumentation");
		}

		const info = {
			platform: (args[2] || "pc").toLowerCase(),
			region: (args[1] || "eu").toLowerCase(),
			battletag: args[0].replace(/\#/i, () => "-")
		};

		if (!ACCEPTED_REGIONS.includes(info.region)) {
			await statusMsg.edit("", {
				embed: generateEmbed(EmbedType.Error, await localizeForUser(member, "OWPROFILEPLUGIN_ERR_WRONGREGION"), {
					fields: [{
						inline: false,
						name: await localizeForUser(member, "OWPROFILEPLUGIN_AVAILABLE_REGIONS"),
						value: ACCEPTED_REGIONS.join("\n")
					}]
				})
			});
			throw new Error("Invalid argumentation");
		}

		if (!ACCEPTED_PLATFORMS.includes(info.platform)) {
			await statusMsg.edit("", {
				embed: generateEmbed(EmbedType.Error, await localizeForUser(member, "OWPROFILEPLUGIN_ERR_WRONGPLATFORM"), {
					fields: [{
						inline: false,
						name: await localizeForUser(member, "OWPROFILEPLUGIN_ERR_WRONGPLATFORM"),
						value: ACCEPTED_PLATFORMS.join("\n")
					}]
				})
			});
			throw new Error("Invalid argumentantion");
		}

		if (!info.battletag) {
			await statusMsg.edit("", {
				embed: generateEmbed(EmbedType.Error, await localizeForUser(member, "OWPROFILEPLUGIN_ERR_NOBTAG"))
			});
			throw new Error("Invalid argumentation");
		}

		status = await localizeForUser(msg.member, "OWPROFILEPLUGIN_FETCHINGPROFILE");
		postStatus();
		try {
			await getProfile(info.battletag, info.region, info.platform);
		} catch (err) {
			if (err instanceof DetailedError) {
				switch (err.code) {
					case "OWAPI_FETCH_ERR_PROFILE_NOTFOUND": {
						await statusMsg.edit("", {
							embed: generateEmbed(EmbedType.Error, await localizeForUser(member, "OWPROFILEPLUGIN_ERR_FETCHINGFAILED"))
						});
					} break;
					default: {
						await statusMsg.edit("", {
							embed: generateEmbed(EmbedType.Error, await localizeForUser(member, "OWPROFILEPLUGIN_ERR_FETCHINGFAILED_API"))
						});
					} break;
				}
			}
			throw new Error("Could not get the profile");
		}

		const json = JSON.stringify(info);

		await statusMsg.delete();

		return {
			json: json,
			type: AddedProfilePluginType.Customs
		};
	}

	async getCustoms(info: string | IOverwatchProfilePluginInfo) {
		if (typeof info === "string") {
			info = <IOverwatchProfilePluginInfo> JSON.parse(info);
		}
		let profile: IRegionalProfile | undefined = undefined;
		try {
			profile = await getProfile(info.battletag, info.region, info.platform);
		} catch (err) {
			LOG("err", "Error during getting profile", err, info);
			throw new Error("Can't get profile");
		}

		if (!profile) {
			LOG("err", "Can't get profile: ", info);
			throw new Error("Exception not catched, but value not present.");
		}

		return {
			thumbnail_url: profile.stats.quickplay.overall_stats.avatar
		};
	}

	async unload() { return true; }
}

module.exports = ImageProfilePlugin;
