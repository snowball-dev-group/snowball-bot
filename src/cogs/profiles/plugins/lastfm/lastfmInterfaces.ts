export interface IValue {
	"#text": string;
}

export interface IInfo extends IValue {
	mbid: string;
}

export interface IDateValue extends IValue {
	/**
	 * Represents timestamp
	 */
	utc: string;
}

export interface IRecentTrackAttr {
	/**
	 * Is this track playing right now
	 */
	nowplaying: "true" | "false";
}

export interface IImage extends IValue {
	size: "small" | "medium" | "large" | "extralarge";
}

export interface IRecentTrack {
	album: IInfo;
	artist: IInfo;
	name: string;
	date: IValue;
	url: string;
	"@attr": IRecentTrackAttr;
}

export interface IRecentTracksResponse {
	recenttracks: {
		track: IRecentTrack[]
	};
}