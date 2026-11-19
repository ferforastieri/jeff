/** The one Jeff: the mascot of the logo. There is no gallery of characters anymore. */
export const BOT_AVATARS = ["jeff-logo"] as const;
export type BotAvatar = (typeof BOT_AVATARS)[number];

export type BotLanguage = "auto" | "pt" | "en" | "es";
